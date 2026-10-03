import { describe, expect, it } from 'vitest'
import { compact, STRING_LIMIT } from './compact.js'

describe('compact', () => {
  it('drops the top level copies of tool results, tool inputs and rendered attachments', () => {
    expect(compact({ type: 'user', toolUseResult: { stdout: 'x' }, wireToolInputs: { t: {} }, rendered: [], uuid: 'u1' })).toEqual({
      type: 'user',
      uuid: 'u1',
    })
  })

  it('keeps fields with those names deeper in the line', () => {
    const line = { message: { content: [{ type: 'tool_use', input: { rendered: 'yes' } }] } }
    expect(compact(line)).toEqual(line)
  })

  it('keeps only the length of thinking signatures and image data', () => {
    const line = {
      message: {
        content: [
          { type: 'thinking', thinking: '', signature: 'a'.repeat(5000) },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'b'.repeat(3000) } },
        ],
      },
    }
    expect(compact(line)).toEqual({
      message: {
        content: [
          { type: 'thinking', thinking: '', signature: 5000 },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 3000 } },
        ],
      },
    })
  })

  it('cuts long strings to the limit and says how much is gone', () => {
    const text = 'x'.repeat(STRING_LIMIT + 123)
    expect(compact({ content: text })).toEqual({ content: `${'x'.repeat(STRING_LIMIT)}…[+123]` })
    expect(compact({ content: 'short' })).toEqual({ content: 'short' })
  })

  it('does not split a surrogate pair at the cut', () => {
    const text = `${'x'.repeat(STRING_LIMIT - 1)}😀tail`
    const cut = compact({ content: text }) as { content: string }
    expect(cut.content.startsWith(`${'x'.repeat(STRING_LIMIT - 1)}…`)).toBe(true)
    expect(cut.content.isWellFormed()).toBe(true)
  })

  it('removes what Postgres jsonb rejects', () => {
    expect(compact({ content: 'a\u0000b\ud800c' })).toEqual({ content: 'ab�c' })
  })
})
