import { describe, expect, it } from 'vitest'
import { secretInput } from './secret.js'

describe('secretInput', () => {
  it('masks a secret through CSS in a text field, so the password manager has no password to save', () => {
    const props = secretInput(true, true)
    expect(props.type).toBe('text')
    expect(props['data-secret']).toBe('')
    expect(props.autoComplete).toBe('off')
    expect(props.spellCheck).toBe(false)
    expect(props['data-1p-ignore']).toBe('')
    expect(props['data-lpignore']).toBe('true')
    expect(props['data-bwignore']).toBe('')
  })

  it('keeps a password field where the browser cannot mask text, rather than show the secret', () => {
    const props = secretInput(true, false)
    expect(props.type).toBe('password')
    expect(props['data-secret']).toBeUndefined()
    expect(props.autoComplete).toBe('off')
  })

  it('leaves a field that is not secret a plain text field', () => {
    expect(secretInput(false, true)).toEqual({ type: 'text' })
  })

  it('falls back to a password field outside a browser', () => {
    expect(secretInput().type).toBe('password')
  })
})
