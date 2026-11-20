import { describe, expect, it } from 'vitest'
import { carriesFiles, clipboardPictures, pastedName, takenFiles, type ClipboardEntry, type TransferItem } from './chatFiles.js'

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

describe('clipboardPictures', () => {
  function entry(types: Record<string, string>): ClipboardEntry {
    return { types: Object.keys(types), getType: async (type) => new Blob([types[type]!], { type }) }
  }

  const reading = (items: ClipboardEntry[]) => ({ read: async () => items })

  it('takes the picture of each clipboard item, named as a pasted picture', async () => {
    const read = await clipboardPictures(reading([entry({ 'text/html': '<img>', 'image/png': 'png' }), entry({ 'image/jpeg': 'jpg' })]), NOW)
    expect('files' in read).toBe(true)
    if (!('files' in read)) return
    expect(read.files.map((file) => [file.name, file.type])).toEqual([
      ['paste-20261018-090507.png', 'image/png'],
      ['paste-20261018-090507.jpg', 'image/jpeg'],
    ])
    expect(await read.files[0]!.text()).toBe('png')
  })

  it('answers empty when the clipboard holds no picture', async () => {
    expect(await clipboardPictures(reading([entry({ 'text/plain': 'hello' })]), NOW)).toEqual({ problem: 'empty' })
    expect(await clipboardPictures(reading([]), NOW)).toEqual({ problem: 'empty' })
  })

  it('answers denied when the browser refuses the read', async () => {
    const refusing = { read: () => Promise.reject(new DOMException('Read permission denied.', 'NotAllowedError')) }
    expect(await clipboardPictures(refusing, NOW)).toEqual({ problem: 'denied' })
  })

  it('asks the clipboard within the press itself, before anything awaits', () => {
    let asked = false
    void clipboardPictures({ read: async () => ((asked = true), []) }, NOW)
    expect(asked).toBe(true)
  })
})
