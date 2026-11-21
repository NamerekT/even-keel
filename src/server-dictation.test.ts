import { rmSync } from 'node:fs'
import { describe, expect, it, onTestFinished } from 'vitest'
import { serverFixture } from '../test/server.fixture.js'
import { fail } from './notice/notice.js'
import type { ServerDeps } from './server.js'

async function post(dictation: ServerDeps['dictation'], body: unknown) {
  const { server, base, publicDir, close } = await serverFixture(dictation === undefined ? {} : { dictation })
  onTestFinished(async () => {
    server.closeAllConnections()
    await close()
    rmSync(publicDir, { recursive: true, force: true })
  })
  const response = await fetch(`${base}/api/dictation/transcribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: response.status, body: (await response.json()) as { text?: string; notice?: { code: string } } }
}

describe('dictation/transcribe', () => {
  it('answers with the text of the recording', async () => {
    const calls: string[][] = []
    const answer = await post({ transcribe: async (audio, type) => (calls.push([audio, type]), 'Hallo Welt') }, { audio: 'AAAA', type: 'audio/webm' })
    expect(answer).toEqual({ status: 200, body: { text: 'Hallo Welt' } })
    expect(calls).toEqual([['AAAA', 'audio/webm']])
  })

  it('takes a recording bigger than the usual body limit', async () => {
    const audio = 'A'.repeat(1024 * 1024)
    const answer = await post({ transcribe: async (sent) => String(sent.length) }, { audio, type: 'audio/mp4' })
    expect(answer.body.text).toBe(String(audio.length))
  })

  it('passes the reason of a refusal on as a code', async () => {
    expect((await post({ transcribe: async () => { throw fail('dictation.quota', {}) } }, { audio: 'AAAA', type: 'audio/webm' })).body.notice?.code).toBe('dictation.quota')
    expect((await post(undefined, { audio: 'AAAA', type: 'audio/webm' })).body.notice?.code).toBe('dictation.off')
  })
})
