import { describe, expect, it } from 'vitest'
import { fakeFetch, issue, note } from './fixture.js'
import { ProjectMap, toCard } from './model.js'
import { connectGitlab } from './source.js'

const SECRET = 'a'.repeat(32)
const FILE = `${SECRET}/card%20check.png`
const UPLOAD = `/uploads/${FILE}`
const WEB = 'https://gitlab.example.com/gitlab'
const PATH = 'group/subgroup/app'
const SETTINGS = { web: WEB, token: 'example-token', projects: { project: { key: 'APP', value: PATH } } }
const PROJECTS = new ProjectMap(SETTINGS.projects, WEB)
const uploaded = () => issue({ web_url: `${WEB}/${PATH}/-/issues/1`, description: `![card](${UPLOAD})` })
const local = `/api/tasks/APP-1/files/${encodeURIComponent(FILE)}`

describe('GitLab uploads', () => {
  it('collects distinct uploads from the description and human notes, rewriting them in place', () => {
    const card = toCard(uploaded(), [], [
      note(1, { body: `[download](${WEB}/${PATH}${UPLOAD})` }),
      note(2, { body: `[report](/gitlab/-/project/10/uploads/${SECRET}/report.pdf)` }),
      note(3, { body: `[system](/uploads/${SECRET}/system.txt)`, system: true }),
    ], PROJECTS)
    expect(card.attachments).toEqual([
      { file: FILE, name: 'card check.png', type: '', size: 0, url: null },
      { file: `${SECRET}/report.pdf`, name: 'report.pdf', type: '', size: 0, url: null },
    ])
    expect(card.description).toBe(`![card](${local})`)
    expect(card.comments[0]!.text).toBe(`[download](${local})`)
    expect(card.comments[1]!.text).toContain('/api/tasks/APP-1/files/')
  })

  it('leaves foreign hosts, projects and malformed filenames untouched', () => {
    const description = [
      `![external](https://elsewhere.example.com${UPLOAD})`,
      `[other](${WEB}/other/app${UPLOAD})`,
      `[other id](/gitlab/-/project/99${UPLOAD})`,
      `[bad](/uploads/${SECRET}/%2e%2e)`,
      `[slash](/uploads/${SECRET}/%2fsecret.txt)`,
      `[invalid](/uploads/invalid/file.txt)`,
      `[escape](/uploads/${SECRET}/%00file.txt)`,
    ].join('\n')
    const card = toCard({ ...uploaded(), description }, [], [], PROJECTS)
    expect(card.attachments).toEqual([])
    expect(card.description).toBe(description)
  })

  it('passes upload files only from trusted answers without changing their text', async () => {
    const body = `Answer\n![card](${UPLOAD})\n[again](${UPLOAD})`
    const fake = fakeFetch([
      { body: { id: 9 } }, { body: [note(1), note(2, { body }), note(3, { body, author: { id: 20, username: 'guest' } })] },
      { body: { access_level: 10 } }, { body: uploaded() },
    ])
    const source = await connectGitlab(SETTINGS, 1000, fake.fetch, () => {})
    expect(await source.commentsAfter!('APP-1', '1')).toEqual([{ id: '2', body, files: [{ file: FILE, name: 'card check.png' }] }])
  })

  it('streams a referenced upload through the prefixed REST endpoint with the profile token', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const responses = [
      Response.json({ id: 9 }), Response.json(uploaded()), Response.json([]),
      new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'application/octet-stream', 'content-length': '3' } }),
    ]
    const source = await connectGitlab(SETTINGS, 1000, (async (url, init) => {
      calls.push({ url: String(url), init })
      return responses.shift()!
    }) as typeof fetch)
    expect(source.file).toBeTypeOf('function')
    const file = await source.file!('APP-1', FILE)
    expect(file).toMatchObject({ type: 'image/png', size: 3 })
    expect([...new Uint8Array(await new Response(file!.body).arrayBuffer())]).toEqual([1, 2, 3])
    expect(calls.at(-1)!.url).toBe(`${WEB}/api/v4/projects/group%2Fsubgroup%2Fapp/uploads/${FILE}`)
    expect(new Headers(calls.at(-1)!.init!.headers).get('private-token')).toBe('example-token')
    expect(calls.at(-1)!.init!.redirect).toBe('error')
  })

  it('refuses unreferenced uploads and handles a deleted upload as missing', async () => {
    const fake = fakeFetch([
      { body: { id: 9 } }, { body: uploaded() }, { body: [] },
      { body: uploaded() }, { body: [] }, { status: 404, body: {} },
    ])
    const source = await connectGitlab(SETTINGS, 1000, fake.fetch)
    expect(source.file).toBeTypeOf('function')
    expect(await source.file!('APP-1', `${SECRET}/other.png`)).toBeNull()
    expect(await source.file!('APP-1', FILE)).toBeNull()
    expect(fake.remaining()).toBe(0)
  })

  it('keeps encoded punctuation and Unicode filenames safe in Markdown and file routes', () => {
    const card = toCard({ ...uploaded(), description: `![photo](/uploads/${SECRET}/%D1%84%D0%BE%D1%82%D0%BE%281%29.png)` }, [], [], PROJECTS)
    expect(card.attachments[0]!.name).toBe('фото(1).png')
    expect(card.attachments[0]!.file).toBe(`${SECRET}/%D1%84%D0%BE%D1%82%D0%BE%281%29.png`)
  })
})
