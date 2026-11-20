import { describe, expect, it } from 'vitest'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import { sharedKind, transcriptMedia } from './transcriptMedia.js'

const urls = {
  image: (tool: string, index: number) => `img:${tool}/${index}`,
  file: (name: string) => `file:${name}`,
  shared: (tool: string, index: number) => `shared:${tool}/${index}`,
}
const at = '2026-01-01T12:00:00.000Z'

describe('transcriptMedia', () => {
  it('lists the pictures of tool results and of sent files in the order of the transcript', () => {
    const lines: FeedLine[] = [
      { at, kind: 'tool', text: 'Read .temp/a.png', tool: 'toolu_a' },
      { at, kind: 'tool', text: 'mcp playwright screenshot', tool: 'toolu_b' },
      { at, kind: 'image', text: 'a.png', tool: 'toolu_a', images: 1 },
      { at, kind: 'image', text: '', tool: 'toolu_b', images: 2 },
      { at, kind: 'prompt', text: 'Look', files: ['C:\\repos\\example\\.temp\\inbox\\order.png', 'C:\\repos\\example\\.temp\\inbox\\notes.txt'] },
      { at, kind: 'image', text: '', tool: 'toolu_lost', images: 1 },
    ]

    const media = transcriptMedia(lines, urls, 'Picture')

    expect(media.items).toEqual([
      { kind: 'image', name: 'a.png', url: 'img:toolu_a/0' },
      { kind: 'image', name: 'mcp playwright screenshot', url: 'img:toolu_b/0' },
      { kind: 'image', name: 'mcp playwright screenshot', url: 'img:toolu_b/1' },
      { kind: 'image', name: 'order.png', url: 'file:order.png', inbox: true },
      { kind: 'image', name: 'Picture', url: 'img:toolu_lost/0' },
    ])
    expect(media.byTool.get('toolu_b')).toEqual([1, 2])
    expect(media.byFile.get('C:\\repos\\example\\.temp\\inbox\\order.png')).toBe(3)
    expect(media.byFile.has('C:\\repos\\example\\.temp\\inbox\\notes.txt')).toBe(false)
  })

  it('shows a picture of a reply the transcript has not got yet from the chosen file, then the service with it behind', () => {
    const local = new Map([['order.png', 'blob:order']])
    const lines: FeedLine[] = [
      { at, kind: 'prompt', text: 'Earlier', files: ['C:\\repos\\example\\.temp\\inbox\\order.png', 'C:\\repos\\example\\.temp\\inbox\\shot.png'] },
      { at, kind: 'answer', text: 'Look', files: ['order.png', 'notes.txt', 'lost.png'] },
    ]

    const media = transcriptMedia(lines, { ...urls, local: (name) => local.get(name) }, 'Picture')

    expect(media.items).toEqual([
      { kind: 'image', name: 'order.png', url: 'file:order.png', inbox: true, fallback: 'blob:order' },
      { kind: 'image', name: 'shot.png', url: 'file:shot.png', inbox: true },
      { kind: 'image', name: 'order.png', url: 'blob:order' },
      { kind: 'image', name: 'lost.png', url: 'file:lost.png', inbox: true },
    ])
    expect(media.byFile.get('order.png')).toBe(2)
  })

  it('adds the pictures a session sent the user, by the call and the place of the file', () => {
    const share = { caption: 'Shots', files: ['C:\\repos\\example\\.temp\\audit.md', 'C:\\repos\\example\\.temp\\dark.PNG'], folder: 'C:\\repos\\example' }
    const lines: FeedLine[] = [{ at, kind: 'tool', text: 'SendUserFile Shots', tool: 'toolu_s', share }]

    const media = transcriptMedia(lines, urls, 'Picture')

    expect(media.items).toEqual([{ kind: 'image', name: 'dark.PNG', url: 'shared:toolu_s/1' }])
    expect(media.byShare.get('toolu_s/1')).toBe(0)
    expect(media.byShare.has('toolu_s/0')).toBe(false)
  })
})

describe('sharedKind', () => {
  it('renders markdown, shows pictures and offers the rest for download', () => {
    expect(['a/b/audit.md', 'notes.MARKDOWN', 'shot.webp', 'C:\\x\\y.jpeg', 'dump.zip', 'README'].map(sharedKind)).toEqual([
      'markdown',
      'markdown',
      'image',
      'image',
      'file',
      'file',
    ])
  })
})
