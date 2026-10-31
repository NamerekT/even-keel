import { describe, expect, it } from 'vitest'
import { outputError, refusalNotice, withTurnError } from './errors.js'
import { foldEvents } from './transcript.js'

const text = 'Error: Model "missing-model" from --model flag is not available.'

describe('Copilot CLI refusals', () => {
  it('reads terminal errors, leaving progress, warnings and successful results alone', () => {
    expect(outputError(`{"type":"session.start"}\n${text}\n`)).toBe(text)
    expect(outputError('Warning: service slow\n')).toBeUndefined()
    expect(outputError(JSON.stringify({ type: 'session.error', data: { message: text } }))).toBeUndefined()
    expect(outputError(`{"type":"result","exitCode":0}\n${text}`)).toBeUndefined()
    expect(refusalNotice('Error: Permission denied')).toBeUndefined()
  })

  it('reads the sign-in refusal by its first line, whatever list follows it', () => {
    // The plain text CLI 1.0.105 prints and exits with when neither a token nor `gh` signs it in.
    const output = [
      'Copilot can be authenticated with GitHub using an OAuth Token or a Fine-Grained Personal Access Token.',
      '',
      'To authenticate, you can use any of the following methods:',
      "  • Start 'copilot' and run the '/login' command",
      '  • Set the COPILOT_GITHUB_TOKEN, GH_TOKEN, or GITHUB_TOKEN environment variable',
      "  • Run 'gh auth login' to authenticate with the GitHub CLI",
      '',
    ].join('\r\n')
    const error = outputError(output)
    expect(error).toBe('Copilot can be authenticated with GitHub using an OAuth Token or a Fine-Grained Personal Access Token.')
    expect(refusalNotice(error!)).toEqual({ code: 'copilot.notSignedIn', params: {} })
    // A live turn's output also had stderr's own line above it.
    expect(outputError(`Error: No authentication information found.\n\n${output}`)).toBe(error)
    expect(outputError(`{"type":"assistant.message","data":{"content":"${output.split('\r\n')[0]}"}}\n{"type":"result","exitCode":0}`)).toBeUndefined()
    const summary = withTurnError(foldEvents(''), { at: '2026-01-01T00:00:00Z', text: error! })
    expect(summary.apiError).toMatchObject({ kind: 'error', notice: { code: 'copilot.notSignedIn' } })
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
