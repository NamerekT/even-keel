import { describe, expect, it } from 'vitest'
import { wholeParts } from './wholeParts.js'

describe('the pieces a value may wrap between', () => {
  it('keeps an e-mail or a name one piece', () => {
    expect(wholeParts('john.doe-example@long-subdomain.example.com', false)).toEqual(['john.doe-example@long-subdomain.example.com'])
  })

  it('cuts a path after each separator, keeping the separator on its piece', () => {
    expect(wholeParts('/home/example/projects/abc', true)).toEqual(['/', 'home/', 'example/', 'projects/', 'abc'])
  })

  it('cuts a Windows path after backslashes and slashes alike', () => {
    expect(wholeParts('D:\\Projects/even-keel\\abc', true)).toEqual(['D:\\', 'Projects/', 'even-keel\\', 'abc'])
  })

  it('gives an empty value as one empty piece', () => {
    expect(wholeParts('', true)).toEqual([''])
  })
})
