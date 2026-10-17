import { describe, expect, it } from 'vitest'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import { transcriptMedia } from './transcriptMedia.js'

const urls = { image: (tool: string, index: number) => `img:${tool}/${index}`, file: (name: string) => `file:${name}` }
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
      { kind: 'image', name: 'order.png', url: 'file:order.png' },
      { kind: 'image', name: 'Picture', url: 'img:toolu_lost/0' },
    ])
    expect(media.byTool.get('toolu_b')).toEqual([1, 2])
    expect(media.byFile.get('C:\\repos\\example\\.temp\\inbox\\order.png')).toBe(3)
    expect(media.byFile.has('C:\\repos\\example\\.temp\\inbox\\notes.txt')).toBe(false)
  })
})
