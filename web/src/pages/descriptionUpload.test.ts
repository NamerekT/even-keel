import { describe, expect, it } from 'vitest'
import { fileMarkdown, inserted, settled, uploadMark } from './descriptionUpload.js'

describe('the upload of a file into the description', () => {
  it('puts the mark where the caret is, replacing the selection', () => {
    expect(inserted('one two', 4, 7, 'M')).toEqual({ text: 'one M', end: 5 })
    expect(inserted('one two', 3, 3, 'M')).toEqual({ text: 'oneM two', end: 4 })
  })

  it('puts the mark on its own paragraph at the end without a caret', () => {
    expect(inserted('', null, null, 'M')).toEqual({ text: 'M', end: 1 })
    expect(inserted('Text', null, null, 'M')).toEqual({ text: 'Text\n\nM', end: 7 })
    expect(inserted('Text\n', null, null, 'M')).toEqual({ text: 'Text\n\nM', end: 7 })
  })

  it('marks two uploads of one name apart and replaces only its own', () => {
    const first = uploadMark('Uploading a.png…', 1)
    const second = uploadMark('Uploading a.png…', 2)
    expect(first).not.toBe(second)
    const text = `${first} and ${second}`
    expect(settled(text, second, '![a.png](/x)')).toBe(`${first} and ![a.png](/x)`)
    expect(settled(text, first, '')).toBe(` and ${second}`)
  })

  it('leaves a text whose mark the user deleted as it is', () => {
    expect(settled('edited', uploadMark('Uploading a.png…', 1), '![a.png](/x)')).toBe('edited')
  })

  it('makes a picture an image and any other file a link, with brackets of the name escaped', () => {
    expect(fileMarkdown('screen [1].png', 'image/png', '/api/tasks/ABC-1/files/ab')).toBe('![screen \\[1\\].png](/api/tasks/ABC-1/files/ab)')
    expect(fileMarkdown('notes.pdf', 'application/pdf', '/f')).toBe('[notes.pdf](/f)')
    expect(fileMarkdown('logo.svg', 'image/svg+xml', '/f')).toBe('[logo.svg](/f)')
  })
})
