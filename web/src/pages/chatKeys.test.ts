import { describe, expect, it } from 'vitest'
import { sendsReply } from './chatKeys.js'

const enter = { key: 'Enter', shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, keyCode: 13 }

describe('sendsReply', () => {
  it('sends Enter, Ctrl+Enter and Cmd+Enter on a fine pointer', () => {
    expect(sendsReply(enter, false)).toBe(true)
    expect(sendsReply({ ...enter, ctrlKey: true }, false)).toBe(true)
    expect(sendsReply({ ...enter, metaKey: true }, false)).toBe(true)
  })

  it('leaves Shift+Enter as a newline, including with Ctrl or Cmd', () => {
    expect(sendsReply({ ...enter, shiftKey: true }, false)).toBe(false)
    expect(sendsReply({ ...enter, shiftKey: true, ctrlKey: true }, false)).toBe(false)
    expect(sendsReply({ ...enter, shiftKey: true, metaKey: true }, false)).toBe(false)
  })

  it('does not send the Enter that confirms IME composition', () => {
    expect(sendsReply({ ...enter, isComposing: true }, false)).toBe(false)
    expect(sendsReply({ ...enter, keyCode: 229 }, false)).toBe(false)
    expect(sendsReply({ ...enter, ctrlKey: true, isComposing: true }, false)).toBe(false)
  })

  it('leaves every Enter to the field on a coarse pointer', () => {
    expect(sendsReply(enter, true)).toBe(false)
    expect(sendsReply({ ...enter, ctrlKey: true }, true)).toBe(false)
    expect(sendsReply({ ...enter, metaKey: true }, true)).toBe(false)
    expect(sendsReply({ ...enter, shiftKey: true }, true)).toBe(false)
  })

  it('leaves other keys alone', () => {
    expect(sendsReply({ ...enter, key: 'a' }, false)).toBe(false)
  })
})
