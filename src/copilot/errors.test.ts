import { describe, expect, it } from 'vitest'
import { modelRefusal, outputError, withTurnError } from './errors.js'
import { foldEvents } from './transcript.js'

const text = 'Error: Model "missing-model" from --model flag is not available.'

describe('Copilot CLI refusals', () => {
  it('reads terminal errors, leaving progress, warnings and successful results alone', () => {
    expect(outputError(`{"type":"session.start"}\n${text}\n`)).toBe(text)
    expect(outputError('Warning: service slow\n')).toBeUndefined()
    expect(outputError(JSON.stringify({ type: 'session.error', data: { message: text } }))).toBeUndefined()
    expect(outputError(`{"type":"result","exitCode":0}\n${text}`)).toBeUndefined()
    expect(modelRefusal('Error: Permission denied')).toBeUndefined()
  })

  it('does not override later transcript activity or mutate the original summary', () => {
    const summary = foldEvents(JSON.stringify({ type: 'assistant.message', timestamp: '2026-01-02T00:00:00Z', data: { content: 'Recovered' } }))
    expect(withTurnError(summary, { at: '2026-01-01T00:00:00Z', text })).toBe(summary)
    const empty = foldEvents('')
    expect(withTurnError(empty, { at: '2026-01-01T00:00:00Z', text }).apiError?.kind).toBe('error')
    expect(empty.apiError).toBeNull()
    expect(empty.feed).toEqual([])
  })
})
