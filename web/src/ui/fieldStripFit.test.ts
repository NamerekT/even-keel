import { describe, expect, it } from 'vitest'
import { stripFit } from './fieldStripFit.js'

describe('the text a strip under a field shows', () => {
  it('shows the whole text while it fits', () => {
    expect(stripFit(240, 230, 140)).toBe('full')
    expect(stripFit(240, 240, null)).toBe('full')
  })

  it('takes the short text when only that fits', () => {
    expect(stripFit(200, 230, 140)).toBe('short')
    expect(stripFit(140, 230, 140)).toBe('short')
  })

  it('cuts the text when neither fits, or when there is no short one', () => {
    expect(stripFit(120, 230, 140)).toBe('cut')
    expect(stripFit(200, 230, null)).toBe('cut')
  })

  it('takes a fraction of a pixel over the room for a fit: the text is measured, the room is rounded', () => {
    expect(stripFit(240, 240.4, null)).toBe('full')
    expect(stripFit(240, 241.2, null)).toBe('cut')
  })
})
