import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OpenCodeLog, streamError } from './log.js'
import { foldSession } from './transcript.js'

const at = Date.parse('2026-10-27T08:28:34Z')
const line = (message: string, session = 'ses_demo') =>
  `ERROR 2026-10-27T08:28:34 +15ms service=llm session.id=${session} error.error=${JSON.stringify(message)} message="stream error"\n`

describe('streamError', () => {
  it.each([
    ['AI_APICallError: Free usage limit reached. Subscribe to keep going', 'limit'],
    ['FreeUsageLimitError: unavailable', 'limit'],
    ['rate limit exceeded', 'limit'],
    ['credit balance is too low', 'credit'],
    ['connection closed', 'error'],
  ])('folds %s through the existing error classification', (message, kind) => {
    const found = streamError(line(message), 'ses_demo', at - 1000)!
    expect(found.at).toBe(at)
    expect(foldSession([], [], undefined, false, [found]).apiError?.kind).toBe(kind)
  })

  it('rejects another session, an older error, a different level or a different message', () => {
    expect(streamError(line('limit', 'ses_other'), 'ses_demo', at - 1)).toBeUndefined()
    expect(streamError(line('limit'), 'ses_demo', at)).toBeUndefined()
    expect(streamError(line('limit').replace('ERROR ', 'INFO '), 'ses_demo', at - 1)).toBeUndefined()
    expect(streamError(line('limit').replace('message="stream error"', 'message="retry"'), 'ses_demo', at - 1)).toBeUndefined()
    expect(streamError('ERROR invalid session.id=ses_demo message="stream error"', 'ses_demo', 0)).toBeUndefined()
  })

  it('accepts explicit logfmt level and time, and escaped error text', () => {
    const found = streamError('time=2026-10-27T08:28:34Z level=ERROR session.id=ses_demo message="stream error" error.error="connection \\"closed\\""', 'ses_demo', at - 1)
    expect(found?.error).toMatchObject({ data: { message: 'connection "closed"' } })
  })
})

describe('OpenCodeLog', () => {
  it('reads appended bytes once, keeps partial lines and isolates accounts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ek-opencode-log-'))
    try {
      const file = join(root, 'one.log')
      const other = join(root, 'two.log')
      const logs = new OpenCodeLog()
      expect(await logs.error(file, 'ses_demo', 0)).toBeUndefined()
      writeFileSync(file, `${'x'.repeat(70_000)}\n${line('Free usage limit reached').trimEnd()}`)
      expect(await logs.error(file, 'ses_demo', 0)).toBeUndefined()
      appendFileSync(file, '\n')
      expect((await logs.error(file, 'ses_demo', at - 1))?.at).toBe(at)
      // Replacing already-read bytes must not reparse them on an unchanged-size file.
      writeFileSync(file, `${'x'.repeat(70_000)}\n${line('Free usage limit reached').replace('ses_demo', 'ses_else')}`)
      expect(await logs.error(file, 'ses_else', 0)).toBeUndefined()
      writeFileSync(other, line('connection closed'))
      expect((await logs.error(other, 'ses_demo', 0))?.error).toMatchObject({ data: { message: 'connection closed' } })
      expect(await logs.error(file, 'ses_demo', at)).toBeUndefined()
      writeFileSync(file, line('shorter replacement'))
      expect((await logs.error(file, 'ses_demo', 0))?.error).toMatchObject({ data: { message: 'shorter replacement' } })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 15_000)
})
