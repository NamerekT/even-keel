import { describe, expect, it } from 'vitest'
import { carriesFiles, pastedName, takenFiles, type TransferItem } from './chatFiles.js'

const NOW = new Date(2026, 9, 18, 9, 5, 7)

function item(file: File | null, kind = 'file', directory = false): TransferItem {
  return { kind, getAsFile: () => file, webkitGetAsEntry: () => (file === null ? null : { isDirectory: directory }) }
}

describe('pastedName', () => {
  it('names a pasted picture after the moment it was pasted', () => {
    expect(pastedName(new File(['x'], 'image.png', { type: 'image/png' }), NOW)).toBe('paste-20261018-090507.png')
  })

  it('takes the extension from the type', () => {
    expect(pastedName(new File(['x'], 'image.png', { type: 'image/jpeg' }), NOW)).toBe('paste-20261018-090507.jpg')
    expect(pastedName(new File(['x'], 'image.webp', { type: 'image/webp' }), NOW)).toBe('paste-20261018-090507.webp')
    expect(pastedName(new File(['x'], 'image.svg', { type: 'image/svg+xml' }), NOW)).toBe('paste-20261018-090507.svg')
  })

  it('keeps the name of a real file', () => {
    expect(pastedName(new File(['x'], 'screen.png', { type: 'image/png' }), NOW)).toBe('screen.png')
    expect(pastedName(new File(['x'], 'image.txt', { type: 'text/plain' }), NOW)).toBe('image.txt')
  })
})

describe('takenFiles', () => {
  it('takes the files and skips folders and other kinds', () => {
    const a = new File(['a'], 'a.txt')
    const b = new File(['b'], 'b.log')
    const folder = new File([], 'docs')
    const items = [item(a), item(null, 'string'), item(folder, 'file', true), item(b)]
    expect(takenFiles(items, NOW)).toEqual([a, b])
  })

  it('renames a pasted picture', () => {
    const [file] = takenFiles([item(new File(['x'], 'image.png', { type: 'image/png' }))], NOW)
    expect(file?.name).toBe('paste-20261018-090507.png')
    expect(file?.type).toBe('image/png')
  })

  it('keeps the name of a dropped picture', () => {
    const file = new File(['x'], 'image.png', { type: 'image/png' })
    expect(takenFiles([item(file)], null)).toEqual([file])
  })

  it('takes a file whose entry is unknown', () => {
    const a = new File(['a'], 'a.txt')
    expect(takenFiles([{ kind: 'file', getAsFile: () => a }], NOW)).toEqual([a])
  })

  it('gives nothing for a link', () => {
    expect(takenFiles([item(null, 'string'), item(null, 'string')], NOW)).toEqual([])
  })
})

describe('carriesFiles', () => {
  it('sees files among the types of a drag', () => {
    expect(carriesFiles(['Files'])).toBe(true)
    expect(carriesFiles(['text/uri-list', 'text/html'])).toBe(false)
  })
})
