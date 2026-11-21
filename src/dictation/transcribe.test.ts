import { describe, expect, it, vi } from 'vitest'
import { readTranslationSpend } from '../badge/translate.js'
import { NoticeError } from '../notice/notice.js'
import { memoryDatabase } from '../storage/memory.js'
import { DICTATION_MODEL, Dictation, MAX_AUDIO_BYTES } from './transcribe.js'

const env = { TALLY_LLM_URL: 'https://llm.example.com/', TALLY_LLM_KEY: 'fake-key' }
const audio = Buffer.from('fake opus bytes').toString('base64')
const answer = (content: unknown = 'Нужно поправить pull request.') => new Response(JSON.stringify({
  id: 'chat-1', model: 'google-gemini-test', choices: [{ message: { content } }],
  usage: { prompt_tokens: 172, completion_tokens: 16 },
}))

async function failureOf(work: Promise<unknown>): Promise<string> {
  const error = await work.then(() => undefined, (caught: unknown) => caught)
  expect(error).toBeInstanceOf(NoticeError)
  return (error as NoticeError).notice.code
}

describe('dictation through LiteLLM', () => {
  it('is available only with an address and a key, read live', () => {
    let current: NodeJS.ProcessEnv = {}
    const dictation = new Dictation(async () => memoryDatabase(), { env: () => current })
    expect(dictation.available()).toBe(false)
    current = env
    expect(dictation.available()).toBe(true)
  })

  it('sends the recording as a file of its type to its own model and keeps the key on the service', async () => {
    const db = await memoryDatabase()
    const request = vi.fn(async () => answer())
    const dictation = new Dictation(async () => db, { env: () => env, request })
    expect(await dictation.transcribe(audio, 'audio/webm;codecs=opus')).toBe('Нужно поправить pull request.')
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://llm.example.com/chat/completions')
    expect(init.headers).toMatchObject({ authorization: 'Bearer fake-key' })
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe(DICTATION_MODEL)
    expect(body.model).not.toBe('google-gemini-3.1-flash-lite')
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[1].content).toEqual([{ type: 'file', file: { file_data: `data:audio/webm;base64,${audio}` } }])
  })

  it('takes the model of its own variable', async () => {
    const request = vi.fn(async () => answer())
    const dictation = new Dictation(async () => memoryDatabase(), { env: () => ({ ...env, TALLY_LLM_MODEL: 'classifier-model', TALLY_LLM_DICTATION_MODEL: 'dictation-model' }), request })
    await dictation.transcribe(audio, 'audio/mp4')
    const [, init] = request.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string).model).toBe('dictation-model')
  })

  it('writes the spend of each recording, an empty one too, for Tally', async () => {
    const db = await memoryDatabase()
    const dictation = new Dictation(async () => db, { env: () => env, request: async () => answer(''), now: () => Date.parse('2026-11-21T10:00:00Z') })
    expect(await dictation.transcribe(audio, 'audio/mp4')).toBe('')
    const rows = await readTranslationSpend(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ account: 'litellm', entrypoint: 'chat-dictation', model: 'google-gemini-test', input: 172, output: 16, at: '2026-11-21T10:00:00.000Z' })
    expect(rows[0]!.messageId).toMatch(/^chat-dictation:.+:google-gemini-test$/)
  })

  it('gives the text even when its spend cannot be written', async () => {
    const log = vi.fn()
    const dictation = new Dictation(async () => { throw new Error('storage gone') }, { env: () => env, request: async () => answer('Hallo'), log })
    expect(await dictation.transcribe(audio, 'audio/webm')).toBe('Hallo')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('spend'))
  })

  it('tells the page why a recording was not transcribed', async () => {
    const dictation = (request: () => Promise<Response>, current: NodeJS.ProcessEnv = env) => new Dictation(async () => memoryDatabase(), { env: () => current, request, log: () => {} })
    expect(await failureOf(dictation(async () => answer(), {}).transcribe(audio, 'audio/webm'))).toBe('dictation.off')
    expect(await failureOf(dictation(async () => new Response('{"error":{"message":"quota"}}', { status: 429 })).transcribe(audio, 'audio/webm'))).toBe('dictation.quota')
    expect(await failureOf(dictation(async () => new Response('boom', { status: 500 })).transcribe(audio, 'audio/webm'))).toBe('dictation.failed')
    expect(await failureOf(dictation(async () => { throw new TypeError('fetch failed') }).transcribe(audio, 'audio/webm'))).toBe('dictation.failed')
    expect(await failureOf(dictation(async () => new Response('not json')).transcribe(audio, 'audio/webm'))).toBe('dictation.failed')
    expect(await failureOf(dictation(async () => answer({ parts: [] })).transcribe(audio, 'audio/webm'))).toBe('dictation.failed')
  })

  it('refuses what is not a recording it can send', async () => {
    const request = vi.fn(async () => answer())
    const dictation = new Dictation(async () => memoryDatabase(), { env: () => env, request })
    expect(await failureOf(dictation.transcribe(audio, 'video/webm'))).toBe('dictation.format')
    expect(await failureOf(dictation.transcribe('', 'audio/webm'))).toBe('dictation.empty')
    const long = Buffer.alloc(MAX_AUDIO_BYTES + 1).toString('base64')
    expect(await failureOf(dictation.transcribe(long, 'audio/webm'))).toBe('dictation.tooLong')
    expect(request).not.toHaveBeenCalled()
  })
})
