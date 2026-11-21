import { describe, expect, it } from 'vitest'
import type { TaskEditor } from './editor.js'
import { pacedEditor, WritePace, type PaceClock } from './pace.js'

function clock(): PaceClock & { at: number; slept: number[] } {
  const self = {
    at: 0,
    slept: [] as number[],
    now: () => self.at,
    sleep: async (ms: number) => {
      self.slept.push(ms)
      self.at += ms
    },
  }
  return self
}

describe('WritePace', () => {
  it('lets the writes of a window through at once and holds the next one until the first leaves it', async () => {
    const time = clock()
    const pace = new WritePace([{ count: 3, ms: 60_000 }], time)
    for (let index = 0; index < 3; index += 1) {
      await pace.next()
      time.at += 1_000
    }
    expect(time.slept).toEqual([])
    await pace.next()
    expect(time.slept).toEqual([57_000])
    expect(time.at).toBe(60_000)
  })

  it('keeps every window: the longer one holds once the short ones are through', async () => {
    const time = clock()
    const pace = new WritePace([{ count: 2, ms: 1_000 }, { count: 4, ms: 60_000 }], time)
    for (let index = 0; index < 5; index += 1) await pace.next()
    // Two at 0, two at 1 s, then the minute window waits for the first of them to leave.
    expect(time.slept).toEqual([1_000, 59_000])
    expect(time.at).toBe(60_000)
  })

  it('never waits without windows', async () => {
    const time = clock()
    const pace = new WritePace([], time)
    for (let index = 0; index < 100; index += 1) await pace.next()
    expect(time.slept).toEqual([])
  })
})

describe('pacedEditor', () => {
  it('paces the writes and leaves the reads alone', async () => {
    const calls: string[] = []
    const write = (name: string) => async () => {
      calls.push(name)
      return name === 'create' || name === 'comment' ? 'ABC-1' : true
    }
    const editor = {
      list: async () => (calls.push('list'), []),
      create: write('create'),
      comment: write('comment'),
      link: async () => void calls.push('link'),
      revision: async () => (calls.push('revision'), 1),
      markers: { make: () => 'marker', find: async () => (calls.push('find'), null) },
      files: { attach: async () => void calls.push('attach'), comment: write('comment') },
      writes: [{ count: 1, ms: 10_000 }],
    } as unknown as TaskEditor
    const time = clock()
    const paced = pacedEditor(editor, new WritePace(editor.writes!, time))
    await paced.list('ABC')
    await paced.markers!.find('ABC', 'marker')
    await paced.revision('ABC-1')
    expect(time.slept).toEqual([])
    expect(await paced.create('ABC', { title: 't', description: '', status: null, priority: null, milestone: null, labels: [], parent: null })).toBe('ABC-1')
    await paced.comment('ABC-1', 'body', null)
    await paced.link('ABC-1', 'ABC-2', 'blocks', true)
    await paced.files!.attach('ABC-1', [])
    expect(time.slept).toEqual([10_000, 10_000, 10_000])
    expect(calls).toEqual(['list', 'find', 'revision', 'create', 'comment', 'link', 'attach'])
    expect(paced.markers!.make()).toBe('marker')
    expect(paced.writes).toBe(editor.writes)
  })
})
