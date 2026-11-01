import { describe, expect, it } from 'vitest'
import { leadingComments, parseJsonc } from './jsonc.js'

describe('parseJsonc', () => {
  it('reads comments and trailing commas, keeping slashes inside strings', () => {
    const text = '{\n  // servers\n  "mcp": { "a": { "url": "http://example.com/x" }, /* b */ },\n}'
    expect(parseJsonc(text)).toEqual({ mcp: { a: { url: 'http://example.com/x' } } })
    expect(parseJsonc('[1]')).toBeUndefined()
    expect(parseJsonc('{')).toBeUndefined()
  })
})

describe('leadingComments', () => {
  it('takes only the comment lines before the body', () => {
    expect(leadingComments('// a\r\n// b\r\n{ "x": 1 // c\n}')).toBe('// a\n// b\n')
    expect(leadingComments('{}')).toBe('')
  })
})
