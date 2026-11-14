import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { attachmentLines } from '../taskmcp/downloads.js'
import { issue } from './fixture.js'
import { connectLinear } from './source.js'

const shot = 'https://uploads.linear.app/org/shot.png'
const note = 'https://uploads.linear.app/org/note.txt'
const page = (nodes: unknown[], endCursor: string | null = null) => ({ nodes, pageInfo: { hasNextPage: endCursor !== null, endCursor } })

async function connect(status = 200) {
  const calls: { url: string; init?: RequestInit; query?: string; variables?: Record<string, unknown> }[] = []
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input)
    if (url !== 'https://api.linear.app/graphql') {
      calls.push({ url, init })
      return new Response(url === shot ? 'png' : 'ok', { status, headers: { 'content-type': 'application/octet-stream' } })
    }
    const { query, variables } = JSON.parse(String(init?.body)) as { query: string; variables: Record<string, unknown> }
    calls.push({ url, init, query, variables })
    if (query.includes('organization {')) return Response.json({ data: { organization: { urlKey: 'example' } } })
    // The card's children, asked alongside it (BTN-1152): none here.
    if (query.includes('includeArchived: true')) return Response.json({ data: { issues: page([]) } })
    const attachments = variables.after === 'next' ? page([{ title: 'External reference', url: 'https://example.com/reference' }]) : page([{ title: 'shot.png', url: shot }], 'next')
    return Response.json({ data: { issues: { nodes: [{
      ...issue('ENG-1'), description: `![Description name](${shot})`, relations: { nodes: [] },
      attachments,
      comments: { nodes: [{ user: null, createdAt: '2026-11-01T00:00:00Z', body: `[note.txt](${note})` }] },
    }] } } })
  }
  return { source: await connectLinear({ token: 'lin_api_example', projects: {} }, 1_000, fetcher), calls }
}

describe('Linear task files', () => {
  it('lists paginated attachments and comment uploads once, downloads private uploads and leaves external links alone', async () => {
    const { source, calls } = await connect()
    const card = await source.card!('ENG-1')
    expect(card.attachments).toEqual([
      { file: shot, name: 'shot.png', size: 0, type: '', url: null },
      { file: 'https://example.com/reference', name: 'External reference', size: 0, type: '', url: 'https://example.com/reference' },
      { file: note, name: 'note.txt', size: 0, type: '', url: null },
    ])
    const asked = calls.filter((call) => call.query?.includes('attachments(') === true)
    expect(asked[0]!.query).toMatch(/attachments\(first: \d+/)
    expect(asked[1]!.variables).toMatchObject({ after: 'next' })
    const scratch = resolve('.temp')
    await mkdir(scratch, { recursive: true })
    const folder = await mkdtemp(join(scratch, 'linear-files-'))
    try {
      const lines = await attachmentLines('ENG-1', card.attachments, source, folder, 100)
      expect(lines[0]).toBe(`- shot.png — ${join(folder, '.temp', 'task-files', 'ENG-1', 'shot.png')}`)
      expect(lines[1]).toBe('- External reference — https://example.com/reference')
      expect(await readFile(join(folder, '.temp', 'task-files', 'ENG-1', 'note.txt'), 'utf8')).toBe('ok')
      expect(await readFile(join(folder, '.temp', 'task-files', 'ENG-1', 'shot.png'), 'utf8')).toBe('png')
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
    const downloads = calls.filter((call) => call.url.startsWith('https://uploads.linear.app/'))
    expect(downloads).toHaveLength(2)
    expect(downloads.every((call) => new Headers(call.init?.headers).get('authorization') === 'lin_api_example')).toBe(true)
    expect(downloads.every((call) => call.init?.redirect === 'error')).toBe(true)
    expect(calls.some((call) => call.url.startsWith('https://example.com/'))).toBe(false)
  })

  it('serves a Linear upload with unknown size and rejects other hosts', async () => {
    const { source, calls } = await connect()
    expect(await source.file!('ENG-1', note)).toMatchObject({ size: null, type: 'application/octet-stream' })
    expect(await source.file!('ENG-1', 'https://uploads.linear.app.example.com/steal')).toBeNull()
    expect(calls).toHaveLength(2)
  })

  it.each([403, 404, 500])('keeps the card when an upload fails (%s)', async (status) => {
    const { source } = await connect(status)
    const lines = await attachmentLines('ENG-1', [{ file: shot, name: 'shot.png', size: 0, type: '', url: null }], source, resolve('.temp'), 100)
    expect(lines).toEqual(['- shot.png — file unavailable'])
  })
})
