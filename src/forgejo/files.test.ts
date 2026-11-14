import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { attachmentLines } from '../taskmcp/downloads.js'
import { comment, issue, WEB } from './fixture.js'
import { connectForgejo } from './source.js'

const shot = { uuid: '11111111-1111-4111-8111-111111111111', name: 'shot.png', size: 3 }
const note = { uuid: '22222222-2222-4222-8222-222222222222', name: 'note.txt', size: 2 }

async function connect(status = 200) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input)
    calls.push({ url, init })
    if (url.includes('/attachments/')) return new Response(url.endsWith(shot.uuid) ? 'png' : 'ok', { status, headers: { 'content-type': 'application/octet-stream' } })
    const path = new URL(url).pathname.replace('/prefix/api/v1', '')
    const body = path === '/user' ? { login: 'bot' }
      : path.endsWith('/comments') ? [comment(1, { assets: [note, shot] })]
      : path.endsWith('/dependencies') || path.endsWith('/blocks') ? []
      : issue({ assets: [shot] })
    return Response.json(body)
  }
  const source = await connectForgejo({ web: `${WEB}/prefix`, token: 'example-token', projects: { app: { key: 'APP', value: 'example-org/app' } } }, 1_000, fetcher)
  return { source, calls }
}

describe('Forgejo task files', () => {
  it('lists issue and comment assets once, with their sizes, and downloads them through task_read', async () => {
    const { source, calls } = await connect()
    const card = await source.card!('APP-1')
    expect(card.attachments).toEqual([
      { file: shot.uuid, name: 'shot.png', size: 3, type: '', url: null },
      { file: note.uuid, name: 'note.txt', size: 2, type: '', url: null },
    ])
    const scratch = resolve('.temp')
    await mkdir(scratch, { recursive: true })
    const folder = await mkdtemp(join(scratch, 'forgejo-files-'))
    try {
      const lines = await attachmentLines('APP-1', card.attachments, source, folder, 100)
      expect(lines).toEqual(card.attachments.map((file) => `- ${file.name} (${file.size} B) — ${join(folder, '.temp', 'task-files', 'APP-1', file.name)}`))
      expect(await readFile(join(folder, '.temp', 'task-files', 'APP-1', 'shot.png'), 'utf8')).toBe('png')
      expect(await readFile(join(folder, '.temp', 'task-files', 'APP-1', 'note.txt'), 'utf8')).toBe('ok')
      const before = calls.length
      await attachmentLines('APP-1', card.attachments, source, folder, 100)
      expect(calls).toHaveLength(before)
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
    const downloads = calls.filter((call) => call.url.includes('/attachments/'))
    // Both files download at once and their requests go in whichever order the disk answers the copies' checks.
    expect(downloads.map((call) => call.url).sort()).toEqual([shot, note].map((file) => `${WEB}/prefix/attachments/${file.uuid}`).sort())
    expect(downloads.every((call) => new Headers(call.init?.headers).get('authorization') === 'token example-token')).toBe(true)
    expect(downloads.every((call) => call.init?.redirect === 'error')).toBe(true)
  })

  it('uses the asset size even without content-length and supplies a known media type', async () => {
    const { source } = await connect()
    const file = await source.file!('APP-1', shot.uuid)
    expect(file).toMatchObject({ size: 3, type: 'image/png' })
  })

  it('refuses files outside the task without fetching their bytes', async () => {
    const { source, calls } = await connect()
    expect(await source.file!('APP-1', '33333333-3333-4333-8333-333333333333')).toBeNull()
    expect(calls.some((call) => call.url.includes('/attachments/'))).toBe(false)
  })

  it.each([403, 404, 500])('reports a failed download (%s) as unavailable', async (status) => {
    const { source } = await connect(status)
    const lines = await attachmentLines('APP-1', [{ file: shot.uuid, name: 'missing.png', size: 0, type: '', url: null }], source, resolve('.temp'), 100)
    expect(lines).toEqual(['- missing.png — file unavailable'])
  })
})
