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

  it('shows a picture the browser holds from the chosen file, the transcript has it or not; the rest from the service', () => {
    const local = new Map([['order.png', 'blob:order']])
    const lines: FeedLine[] = [
      { at, kind: 'prompt', text: 'Earlier', files: ['C:\\repos\\example\\.temp\\inbox\\order.png', 'C:\\repos\\example\\.temp\\inbox\\shot.png'] },
      { at, kind: 'answer', text: 'Look', files: ['order.png', 'notes.txt', 'lost.png'] },
    ]

    const media = transcriptMedia(lines, { ...urls, local: (name) => local.get(name) }, 'Picture')

    expect(media.items).toEqual([
      { kind: 'image', name: 'order.png', url: 'blob:order' },
      { kind: 'image', name: 'shot.png', url: 'file:shot.png', inbox: true },
      { kind: 'image', name: 'order.png', url: 'blob:order' },
      { kind: 'image', name: 'lost.png', url: 'file:lost.png', inbox: true },
    ])
    expect(media.byFile.get('order.png')).toBe(2)
  })

  it('keeps the address of a picture the browser holds from the send through the transcript to the read (BTN-1425)', () => {
    const inbox = 'C:\\repos\\example\\.temp\\inbox'
    const local = { ...urls, local: (name: string) => (name === 'paste-1.png' ? 'blob:paste-1' : undefined) }
    const sent: FeedLine = { at, kind: 'prompt', text: 'Look', files: ['paste-1.png'] }
    const landed: FeedLine = { ...sent, files: [`${inbox}\\paste-1.png`] }
    const read: FeedLine[] = [
      { at, kind: 'tool', text: 'Read paste-1.png', tool: 'toolu_a', name: 'Read', subject: `${inbox}\\paste-1.png` },
      { at, kind: 'image', text: 'paste-1.png', tool: 'toolu_a', images: 1 },
    ]

    const stages = [[sent], [landed], [landed, ...read]].map((lines) => transcriptMedia(lines, local, 'Picture'))

    expect(stages.map((media) => media.items)).toEqual(Array(3).fill([{ kind: 'image', name: 'paste-1.png', url: 'blob:paste-1' }]))
    expect(stages.map((media) => media.keys)).toEqual(Array(3).fill(['sent:paste-1.png']))
    expect(stages[2]!.byTool.get('toolu_a')).toEqual([0])
  })

  it('names each picture by what it shows, so a list built again finds the same one', () => {
    const share = { caption: 'Shots', files: ['C:\\repos\\example\\.temp\\dark.png'], folder: 'C:\\repos\\example' }
    const lines: FeedLine[] = [
      { at, kind: 'image', text: '', tool: 'toolu_b', images: 2 },
      { at, kind: 'prompt', text: 'Two', files: ['C:\\repos\\example\\.temp\\inbox\\Shot.png', 'D:\\other\\.temp\\inbox\\shot.png'] },
      { at, kind: 'tool', text: 'SendUserFile Shots', tool: 'toolu_s', share },
    ]

    expect(transcriptMedia(lines, urls, 'Picture').keys).toEqual(['tool:toolu_b/0', 'tool:toolu_b/1', 'sent:shot.png', 'sent:shot.png#2', 'share:toolu_s/0'])
  })

  it('makes a sent picture and the agent reading it one frame at the message, given from the transcript', () => {
    const inbox = 'C:\\repos\\example\\.claude\\worktrees\\abc-5\\.temp\\inbox'
    const lines: FeedLine[] = [
      { at, kind: 'prompt', text: 'Look', files: [`${inbox}\\paste-1.png`, `${inbox}\\paste-2.png`] },
      { at, kind: 'tool', text: 'Read paste-1.png', tool: 'toolu_a', name: 'Read', subject: `${inbox}\\paste-1.png` },
      { at, kind: 'image', text: 'paste-1.png', tool: 'toolu_a', images: 1 },
      { at, kind: 'tool', text: 'Read 3.png', tool: 'toolu_b', name: 'Read', subject: 'C:\\repos\\example\\.temp\\3.png' },
      { at, kind: 'image', text: '3.png', tool: 'toolu_b', images: 1 },
      { at, kind: 'tool', text: 'Read paste-1.png', tool: 'toolu_c', name: 'Read', subject: `${inbox}\\paste-1.png` },
      { at, kind: 'image', text: 'paste-1.png', tool: 'toolu_c', images: 1 },
    ]

    const media = transcriptMedia(lines, { ...urls, local: (name) => (name === 'paste-2.png' ? 'blob:paste-2.png' : undefined) }, 'Picture')

    expect(media.items).toEqual([
      { kind: 'image', name: 'paste-1.png', url: 'img:toolu_a/0' },
      { kind: 'image', name: 'paste-2.png', url: 'blob:paste-2.png' },
      { kind: 'image', name: '3.png', url: 'img:toolu_b/0' },
    ])
    expect(media.byFile.get(`${inbox}\\paste-1.png`)).toBe(0)
    expect(media.byTool.get('toolu_a')).toEqual([0])
    expect(media.byTool.get('toolu_c')).toEqual([0])
  })

  it('matches by the full path where the read knows it, else by the name inside the inbox', () => {
    const lines: FeedLine[] = [
      { at, kind: 'prompt', text: 'Two', files: ['C:\\repos\\example\\.temp\\inbox\\shot.png', '/home/doe/example/.temp/inbox/plan.png'] },
      { at, kind: 'image', text: 'D:/other/.temp/inbox/shot.png', tool: 'call-1', images: 1 },
      { at, kind: 'image', text: 'plan.png', tool: 'toolu_p', images: 1 },
      { at, kind: 'image', text: '/home/doe/example/.temp/plan.png', tool: 'call-2', images: 1 },
      { at, kind: 'image', text: 'c:/repos/example/.temp/inbox/later.png', tool: 'call-3', images: 1 },
      { at, kind: 'answer', text: 'Again', files: ['C:\\repos\\example\\.temp\\inbox\\later.png'] },
    ]

    const media = transcriptMedia(lines, urls, 'Picture')

    expect(media.items).toEqual([
      { kind: 'image', name: 'shot.png', url: 'file:shot.png', inbox: true },
      { kind: 'image', name: 'plan.png', url: 'img:toolu_p/0' },
      { kind: 'image', name: 'D:/other/.temp/inbox/shot.png', url: 'img:call-1/0' },
      { kind: 'image', name: '/home/doe/example/.temp/plan.png', url: 'img:call-2/0' },
      { kind: 'image', name: 'c:/repos/example/.temp/inbox/later.png', url: 'img:call-3/0' },
    ])
    expect(media.byTool.get('toolu_p')).toEqual([1])
    expect(media.byFile.get('C:\\repos\\example\\.temp\\inbox\\later.png')).toBe(4)
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
