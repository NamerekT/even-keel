import { describe, expect, it } from 'vitest'
import { withExtension } from './file-names.js'

describe('withExtension', () => {
  it('adds the extension of the type to a name without one', () => {
    expect(withExtension('49220cf1-be66-497e-93c8-faea8d99da11', 'image/png')).toBe('49220cf1-be66-497e-93c8-faea8d99da11.png')
    expect(withExtension('clip', 'video/mp4')).toBe('clip.mp4')
    expect(withExtension('notes', 'text/plain; charset=utf-8')).toBe('notes.txt')
  })

  it('keeps a name that already ends with an extension of its type, in any case', () => {
    expect(withExtension('shot.PNG', 'image/png')).toBe('shot.PNG')
    expect(withExtension('photo.jpg', 'image/jpeg')).toBe('photo.jpg')
    expect(withExtension('report.pdf', 'application/pdf')).toBe('report.pdf')
  })

  it('adds the extension after a dot that is no extension of the type', () => {
    expect(withExtension('Screenshot 10.30.15', 'image/png')).toBe('Screenshot 10.30.15.png')
  })

  it('leaves the name alone for a type it has no extension of', () => {
    expect(withExtension('logs', '')).toBe('logs')
    expect(withExtension('logs', 'application/octet-stream')).toBe('logs')
  })
})
