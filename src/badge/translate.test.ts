import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { memoryDatabase } from '../storage/memory.js'
import { BadgeTranslations, cleanTitle, TRANSLATION_RETRY_MS } from './translate.js'

const task = { tracker: 'example', id: 'ABC-1', title: 'Починить `src/file.ts`' }
const env = { TALLY_LLM_URL: 'https://llm.example.com/', TALLY_LLM_KEY: 'fake-key' }
const response = (content = 'Fix `src/file.ts`') => new Response(JSON.stringify({
  id: 'chat-1', model: 'gemini/google-gemini-test', choices: [{ message: { content } }],
  usage: { prompt_tokens: 100, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 20 } },
}))

// Each case opens its own PGlite database: ~0.5 s alone, past vitest's default 5 s under a loaded full run (BTN-1681).
describe('badge title translations', { timeout: 30_000 }, () => {
  it('cleans markup, quotes, control characters and newlines and limits Unicode characters', () => {
    expect(cleanTitle('  "**Fix** `src/file.ts`\n[panel](https://example.com)\u0000\u202E" ')).toBe('Fix src/file.ts panel')
    expect(cleanTitle('😀'.repeat(100))).toBe('😀'.repeat(90))
    expect(cleanTitle('```\n```')).toBe('')
    expect(cleanTitle('```text\nFix `src/my_file.ts` and **the panel**\n```')).toBe('Fix src/my_file.ts and the panel')
    expect(cleanTitle('# _Fix_ the [panel](https://example.com)')).toBe('Fix the panel')
    expect(cleanTitle('> **Fix\nthe panel**')).toBe('Fix the panel')
    expect(cleanTitle('**Fix** `src/**/my_file.ts` and `<Task>`')).toBe('Fix src/**/my_file.ts and <Task>')
  })

  it('deduplicates in-flight calls, persists the cache over a restart and translates a changed title', async () => {
    const db = await memoryDatabase()
    const request = vi.fn(async () => response())
    const translations = new BadgeTranslations(db, { env: () => env, request })
    expect(translations.title(task, true)).toBeUndefined()
    translations.title(task, true)
    await translations.settle()
    expect(translations.title(task, true)).toBe('Fix src/file.ts')
    expect(request).toHaveBeenCalledTimes(1)
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://llm.example.com/chat/completions')
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ temperature: 0, model: 'google-gemini-3.1-flash-lite' })
    expect(body.messages[1]).toEqual({ role: 'user', content: task.title })
    expect(init.headers).toMatchObject({ authorization: 'Bearer fake-key' })
    const restarted = new BadgeTranslations(db, { env: () => env, request })
    restarted.title(task, true)
    await restarted.settle()
    expect(restarted.title(task, true)).toBe('Fix src/file.ts')
    expect(request).toHaveBeenCalledTimes(1)
    restarted.title({ ...task, title: 'Изменённый заголовок' }, true)
    await restarted.settle()
    expect(request).toHaveBeenCalledTimes(2)
    restarted.title({ ...task, tracker: 'another' }, true)
    await restarted.settle()
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('asks to replace names and addresses, and keeps a NONE answer as no title without asking again', async () => {
    const db = await memoryDatabase()
    let now = 1_800_000
    const lines: string[] = []
    const request = vi.fn(async () => response(' "None." '))
    const options = { env: () => env, request, now: () => now, log: (line: string) => lines.push(line) }
    const translations = new BadgeTranslations(db, options)
    translations.title(task, true)
    await translations.settle()
    const [, init] = request.mock.calls[0] as unknown as [string, RequestInit]
    const prompt = JSON.parse(init.body as string).messages[0].content as string
    expect(prompt).toContain('Replace names of people, companies and clients, addresses and e-mails with general words')
    expect(prompt).toContain('answer NONE')
    expect(translations.title(task, true)).toBeUndefined()
    expect(lines).toEqual(['badge: English title unavailable (the model answered NONE)'])
    now += TRANSLATION_RETRY_MS
    translations.title(task, true)
    await translations.settle()
    const restarted = new BadgeTranslations(db, options)
    restarted.title(task, true)
    await restarted.settle()
    expect(restarted.title(task, true)).toBeUndefined()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('keeps an English title word for word when the model answers KEEP (BTN-1784)', async () => {
    const db = await memoryDatabase()
    const request = vi.fn(async () => response(' Keep. '))
    const translations = new BadgeTranslations(db, { env: () => env, request })
    const english = { ...task, title: "A merged task's session shows as a question while its merge lands" }
    translations.title(english, true)
    await translations.settle()
    const [, init] = request.mock.calls[0] as unknown as [string, RequestInit]
    const prompt = JSON.parse(init.body as string).messages[0].content as string
    expect(prompt).toContain('already in English')
    expect(prompt).toContain('answer KEEP')
    expect(prompt).not.toContain('concise')
    expect(translations.title(english, true)).toBe(english.title)
    const marked = { ...task, id: 'ABC-2', title: 'Project chat: ··· menu with **Archive** now — `chats.ts`' }
    translations.title(marked, true)
    await translations.settle()
    expect(translations.title(marked, true)).toBe('Project chat: ··· menu with Archive now — chats.ts')
  })

  it('takes no title from KEEP for a title not in English and asks again after the pause', async () => {
    const db = await memoryDatabase()
    let now = 1_800_000
    const lines: string[] = []
    const request = vi.fn(async () => response('KEEP'))
    const translations = new BadgeTranslations(db, { env: () => env, request, now: () => now, log: (line) => lines.push(line) })
    translations.title(task, true)
    await translations.settle()
    expect(translations.title(task, true)).toBeUndefined()
    expect(lines).toEqual(['badge: English title unavailable (KEEP for a title not in English)'])
    now += TRANSLATION_RETRY_MS
    translations.title(task, true)
    await translations.settle()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('asks again for a title translated by an older prompt, showing the old one until then, but not for NONE', async () => {
    const db = await memoryDatabase()
    const old = { ...task, id: 'ABC-2', title: 'Old title' }
    const none = { ...task, id: 'ABC-3', title: 'Client title' }
    const hash = (title: string) => createHash('sha256').update(title).digest('hex')
    await db.query(`insert into badge_translations (tracker, task, title_hash, attempted_at, title_en) values
      ('example', 'ABC-2', $1, 0, 'Retold title'), ('example', 'ABC-3', $2, 0, '')`, [hash(old.title), hash(none.title)])
    let fail = true
    const request = vi.fn(async () => fail ? new Response('', { status: 500 }) : response('KEEP'))
    let now = 1_800_000
    const options = { env: () => env, request, now: () => now, log: () => undefined }
    const translations = new BadgeTranslations(db, options)
    translations.title(old, true)
    translations.title(none, true)
    await translations.settle()
    expect(request).toHaveBeenCalledTimes(1)
    expect(translations.title(old, true)).toBe('Retold title')
    expect(translations.title(none, true)).toBeUndefined()
    const restarted = new BadgeTranslations(db, options)
    restarted.title(old, true)
    await restarted.settle()
    expect(restarted.title(old, true)).toBe('Retold title')
    expect(request).toHaveBeenCalledTimes(1)
    fail = false
    now += TRANSLATION_RETRY_MS
    restarted.title(old, true)
    await restarted.settle()
    expect(restarted.title(old, true)).toBe('Old title')
    const again = new BadgeTranslations(db, options)
    again.title(old, true)
    await again.settle()
    expect(again.title(old, true)).toBe('Old title')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it.each(['network', 'empty', 'http', 'json', 'settings'])('keeps %s failures through a restart for 30 minutes and logs each reason once', async (failure) => {
    const db = await memoryDatabase()
    let now = 1_800_000
    const lines: string[] = []
    const request = vi.fn(async () => {
      if (failure === 'network') throw new Error('secret response data')
      if (failure === 'empty') return response('** **')
      if (failure === 'http') return new Response('secret response data', { status: 429 })
      if (failure === 'json') return new Response('bad json')
      return response()
    })
    const options = { env: () => failure === 'settings' ? {} : env, now: () => now, request, log: (line: string) => lines.push(line) }
    let translations = new BadgeTranslations(db, options)
    translations.title(task, true)
    await translations.settle()
    expect(translations.title(task, true)).toBeUndefined()
    translations = new BadgeTranslations(db, options)
    translations.title(task, true)
    await translations.settle()
    expect(request).toHaveBeenCalledTimes(failure === 'settings' ? 0 : 1)
    now += TRANSLATION_RETRY_MS
    translations.title(task, true)
    await translations.settle()
    expect(request).toHaveBeenCalledTimes(failure === 'settings' ? 0 : 2)
    now += TRANSLATION_RETRY_MS
    translations.title(task, true)
    await translations.settle()
    expect(lines).toHaveLength(2) // One line per service lifetime, even across repeated attempts.
    expect(lines.join()).not.toContain('secret response data')
  })

  it.each(['TALLY_LLM_URL', 'TALLY_LLM_KEY', 'TALLY_LLM_MODEL'])('retries a failed title at once when %s changes, and keeps ready ones', async (name) => {
    const db = await memoryDatabase()
    const current: NodeJS.ProcessEnv = { ...env }
    const lines: string[] = []
    const ready = { ...task, id: 'ABC-2' }
    const request = vi.fn(async (_url: unknown, init?: RequestInit) =>
      (init!.body as string).includes('ABC-2 title') || current[name] === 'changed' ? response() : new Response('', { status: 401 }))
    const translations = new BadgeTranslations(db, { env: () => current, now: () => 1_800_000, request, log: (line) => lines.push(line) })
    translations.title(task, true)
    translations.title({ ...ready, title: 'ABC-2 title' }, true)
    await translations.settle()
    translations.title(task, true)
    await translations.settle()
    expect(request).toHaveBeenCalledTimes(2)
    current[name] = 'changed'
    translations.title({ ...ready, title: 'ABC-2 title' }, true)
    translations.title(task, true)
    await translations.settle()
    expect(request).toHaveBeenCalledTimes(3)
    expect(translations.title(task, true)).toBe('Fix src/file.ts')
    current[name] = 'broken'
    const another = { ...task, id: 'ABC-3' }
    translations.title(another, true)
    await translations.settle()
    expect(lines).toHaveLength(2) // The same reason is logged again after a change of settings.
    translations.title(another, true)
    await translations.settle()
    expect(request).toHaveBeenCalledTimes(4)
  })

  it('retries at once when missing settings appear, also for a failure saved before a restart', async () => {
    const db = await memoryDatabase()
    const current: NodeJS.ProcessEnv = {}
    const request = vi.fn(async () => response())
    const options = { env: () => current, now: () => 1_800_000, request, log: () => undefined }
    const before = new BadgeTranslations(db, options)
    before.title({ ...task, id: 'ABC-2' }, true)
    await before.settle()
    const translations = new BadgeTranslations(db, options)
    translations.title(task, true)
    await translations.settle()
    Object.assign(current, env)
    translations.title(task, true)
    translations.title({ ...task, id: 'ABC-2' }, true)
    await translations.settle()
    expect(request).toHaveBeenCalledTimes(2)
    expect(translations.title(task, true)).toBe('Fix src/file.ts')
  })

  it('does not hold a request answered after a change of settings to the pause', async () => {
    const db = await memoryDatabase()
    const current: NodeJS.ProcessEnv = { ...env }
    let release = (_response: Response): void => undefined
    const request = vi.fn(async () => request.mock.calls.length === 1 ? new Promise<Response>((resolve) => { release = resolve }) : response())
    const translations = new BadgeTranslations(db, { env: () => current, now: () => 1_800_000, request, log: () => undefined })
    translations.title(task, true)
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1))
    current.TALLY_LLM_KEY = 'another-fake-key'
    translations.title(task, true)
    release(new Response('', { status: 401 }))
    await translations.settle()
    translations.title(task, true)
    await translations.settle()
    expect(request).toHaveBeenCalledTimes(2)
    expect(translations.title(task, true)).toBe('Fix src/file.ts')
  })

  it('reads a cached title with requests disabled, and sends neither missing nor empty titles', async () => {
    const db = await memoryDatabase()
    const request = vi.fn(async () => response())
    const translations = new BadgeTranslations(db, { env: () => env, request })
    translations.title(task, false)
    translations.title({ ...task, title: '  ' }, true)
    await translations.settle()
    expect(request).not.toHaveBeenCalled()
    translations.title(task, true)
    await translations.settle()
    const restarted = new BadgeTranslations(db, { env: () => env, request })
    restarted.title(task, false)
    await restarted.settle()
    expect(restarted.title(task, false)).toBe('Fix src/file.ts')
  })
})
