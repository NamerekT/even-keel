import { describe, expect, it } from 'vitest'
import type { ImportSource, ImportTask } from './import.js'
import { checkImport, type ImportedTask } from './transfer-check.js'

const task = (number: number): ImportTask => ({
  ref: `r${number}`,
  number,
  id: `ABC-${number}`,
  title: `Task ${number}`,
  description: '',
  images: [],
  status: { name: 'Todo', category: 'ToDo' },
  priority: 'medium',
  milestone: null,
  component: null,
  labels: [],
  estimate: null,
  parent: null,
  blocks: [],
  blockedBy: [],
  related: [],
  createdAt: 0,
  createdBy: null,
  closedAt: null,
  modifiedAt: null,
})

const nothing: ImportedTask = { comments: 0, changes: 0, files: 0, blocks: [], related: [], parent: null, milestone: null, labels: [], component: null }

/** `count` tasks of one comment each; the first tasks answer slowest, so the reads finish out of order. */
function sourceOf(count: number, parallel?: number) {
  const state = { inFlight: 0, most: 0, comments: 0, fail: false }
  const source: ImportSource = {
    tasks: async () => Array.from({ length: count }, (_, index) => task(index + 1)),
    milestones: async () => [],
    async comments(ref) {
      state.comments += 1
      state.inFlight += 1
      state.most = Math.max(state.most, state.inFlight)
      await new Promise((resolve) => setTimeout(resolve, count - Number(ref.slice(1)) + 1))
      state.inFlight -= 1
      if (state.fail) throw new Error('the tracker is down')
      return [{ ref: `c-${ref}`, author: null, at: 0, body: '', images: [], files: [], replyTo: null }]
    },
    files: async () => [],
    ...(parallel === undefined ? {} : { parallel }),
  }
  return { source, state }
}

describe('checkImport', () => {
  it('reads the tasks a few at once, telling how many are through, and keeps their order', async () => {
    const { source, state } = sourceOf(10, 3)
    const heard: [number, number][] = []
    // The even tasks have no comment there: their ids come in the source's order whatever order the reads end in.
    const check = await checkImport(source, async (each) => ({ ...nothing, comments: each.number % 2 }), undefined, { progress: (done, total) => heard.push([done, total]) })
    expect(state.most).toBe(3)
    expect(heard[0]).toEqual([0, 10])
    expect(heard.at(-1)).toEqual([10, 10])
    expect(heard.map(([done]) => done)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(check.rows.find((row) => row.kind === 'comments')).toEqual({ kind: 'comments', source: 10, target: 5, tasks: ['ABC-2', 'ABC-4', 'ABC-6', 'ABC-8', 'ABC-10'] })
  })

  it("takes the plan's number of reads where the source names none", async () => {
    const { source, state } = sourceOf(10)
    await checkImport(source, async () => nothing)
    expect(state.most).toBe(4)
  })

  it('stops at the first failure', async () => {
    const { source, state } = sourceOf(20, 2)
    state.fail = true
    await expect(checkImport(source, async () => nothing)).rejects.toThrow('the tracker is down')
    expect(state.comments).toBeLessThan(20)
  })
})
