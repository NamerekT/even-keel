import { describe, expect, it } from 'vitest'
import { EditRefused, patchText } from './editor.js'

const refusal = (work: () => unknown): string => {
  try {
    work()
  } catch (error) {
    if (error instanceof EditRefused) return error.message
    throw error
  }
  throw new Error('no refusal')
}

describe('patchText', () => {
  it('replaces the one occurrence of old', () => {
    expect(patchText('one two three', [{ old: 'two', new: '2' }], null)).toBe('one 2 three')
  })

  it('refuses old found nowhere and shows the current text', () => {
    expect(refusal(() => patchText('one two', [{ old: 'four', new: '4' }], null))).toMatch(/not in the description[\s\S]*one two$/)
  })

  it('refuses old found twice and asks for a longer piece', () => {
    expect(refusal(() => patchText('a b a', [{ old: 'a', new: 'c' }], null))).toMatch(/found 2 times; take a longer piece/)
  })

  it('applies a batch in order and refuses it whole when one patch fails', () => {
    expect(patchText('x y z', [{ old: 'x', new: 'X' }, { old: 'X y', new: 'XY' }], null)).toBe('XY z')
    expect(refusal(() => patchText('x y z', [{ old: 'x', new: 'X' }, { old: 'w', new: 'W' }], null))).toMatch(/^patch 2:/)
  })

  it('compares literally: case and blanks matter', () => {
    expect(refusal(() => patchText('Hello  world', [{ old: 'hello world', new: 'hi' }], null))).toMatch(/not in the description/)
  })

  it('takes \\r\\n and \\n for one line end and keeps the text\'s own', () => {
    expect(patchText('a\r\nb\r\nc', [{ old: 'a\nb', new: 'A\nB' }], null)).toBe('A\r\nB\r\nc')
    expect(patchText('a\nb', [{ old: 'a\r\nb', new: 'ab' }], null)).toBe('ab')
  })

  it('skips a patch applied already, so a repeated call is no error', () => {
    expect(patchText('one 2 three', [{ old: 'two', new: '2' }], null)).toBeNull()
    expect(patchText('see foo bar', [{ old: 'foo', new: 'foo bar' }], null)).toBeNull()
  })

  it('appends a section after a blank line, once', () => {
    expect(patchText('Text.', [], '## Notes\n\nmore')).toBe('Text.\n\n## Notes\n\nmore')
    expect(patchText('Text.\n\n## Notes\n\nmore\n', [], '## Notes\n\nmore')).toBeNull()
    expect(patchText('', [], 'first')).toBe('first')
  })

  it('refuses an empty old', () => {
    expect(refusal(() => patchText('a', [{ old: '', new: 'b' }], null))).toMatch(/"old" is empty/)
  })
})
