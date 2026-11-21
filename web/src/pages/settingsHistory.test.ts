import { describe, expect, it } from 'vitest'
import type { Draft } from './settingsDraft.js'
import { EMPTY_HISTORY, historyAfter, redone, undone, type History } from './settingsHistory.js'
import { redoDraft, storedDraft, undoDraft, writeDraft } from './settingsStore.js'

const draft = (edit: Record<string, string | boolean>, base: Record<string, string | boolean> = { a: '', b: '', c: false }): Draft => ({ base, edit: { ...base, ...edit } })
const start = draft({})

/** The history after a run of drafts, each the next edit of the one before. */
function run(...edits: Draft[]): History {
  let history = EMPTY_HISTORY
  let before = start
  edits.forEach((next, at) => {
    history = historyAfter(history, before, next, at + 1)
    before = next
  })
  return history
}

describe('historyAfter', () => {
  it('records the changed fields with their values before and after', () => {
    expect(run(draft({ c: true })).back).toEqual([{ seq: 1, before: { c: false }, after: { c: true } }])
  })

  it('glues a run of edits of one field into one step: typing is one step, not a letter each', () => {
    const history = run(draft({ a: 'x' }), draft({ a: 'xy' }), draft({ a: 'xyz' }))
    expect(history.back).toEqual([{ seq: 3, before: { a: '' }, after: { a: 'xyz' } }])
  })

  it('keeps edits of different fields apart, and the same field again after another one', () => {
    const history = run(draft({ a: 'x' }), draft({ a: 'x', c: true }), draft({ a: 'xy', c: true }))
    expect(history.back.map((step) => step.after)).toEqual([{ a: 'x' }, { c: true }, { a: 'xy' }])
  })

  it('records an edit of several fields at once as one step', () => {
    expect(run(draft({ a: 'x', b: 'y' })).back).toEqual([{ seq: 1, before: { a: '', b: '' }, after: { a: 'x', b: 'y' } }])
  })

  it('drops a glued step that came back to where it started', () => {
    expect(run(draft({ c: true }), draft({ c: false })).back).toEqual([])
  })

  it('leaves the history alone for a draft whose fields did not change', () => {
    const history = run(draft({ a: 'x' }))
    expect(historyAfter(history, draft({ a: 'x' }), { ...draft({ a: 'x' }), adding: { b: { cells: [], value: 'r', valid: true } } }, 9)).toBe(history)
  })

  it('clears what was undone once a new edit comes', () => {
    const [, back] = undone(run(draft({ a: 'x' }), draft({ a: 'x', c: true })), null, 3)!
    expect(back.forward).toHaveLength(1)
    expect(historyAfter(back, draft({ a: 'x' }), draft({ a: 'x', b: 'y' }), 5).forward).toEqual([])
  })

  it('starts over when the values under the draft change: a save or the file changed by someone else', () => {
    const history = run(draft({ a: 'x' }))
    const saved = { a: 'x', b: '', c: false }
    expect(historyAfter(history, draft({ a: 'x' }), { base: saved, edit: saved }, 2)).toEqual(EMPTY_HISTORY)
  })
})

describe('undone and redone', () => {
  const history = run(draft({ a: 'x' }), draft({ a: 'x', c: true }))

  it('steps back the last edit and keeps it for a step forward', () => {
    const [step, next] = undone(history, null, 3)!
    expect(step.before).toEqual({ c: false })
    expect(next.back).toHaveLength(1)
    expect(next.forward).toEqual([{ ...step, seq: 3 }])
    const [again, after] = redone(next, null, 4)!
    expect(again.after).toEqual({ c: true })
    expect(after).toEqual({ back: [history.back[0], { ...step, seq: 4 }], forward: [] })
  })

  it('steps back only within the open section and leaves the other sections’ steps in place', () => {
    const [step, next] = undone(history, ['a', 'b'], 3)!
    expect(step.after).toEqual({ a: 'x' })
    expect(next.back.map((each) => each.after)).toEqual([{ c: true }])
    expect(redone(next, ['c'], 4)).toBeNull()
    expect(redone(next, ['a'], 4)![0].after).toEqual({ a: 'x' })
  })

  it('gives nothing when there is nothing to step', () => {
    expect(undone(EMPTY_HISTORY, null, 3)).toBeNull()
    expect(redone(history, null, 3)).toBeNull()
    expect(undone(history, ['b'], 3)).toBeNull()
  })
})

describe('undoDraft and redoDraft', () => {
  const rules = { a: '', b: '' }
  const moves = { m: '' }

  it('step the latest edit across the drafts of a form and write it into the draft', () => {
    writeDraft('test:rules', { base: rules, edit: rules }, { base: rules, edit: { ...rules, a: 'x' } })
    writeDraft('test:moves', { base: moves, edit: moves }, { base: moves, edit: { m: 'y' } })
    const parts = [{ scope: 'test:rules', keys: ['a', 'b'] }, { scope: 'test:moves' }]
    expect(undoDraft(parts)).toBe(true)
    expect(storedDraft('test:moves')?.edit).toEqual({ m: '' })
    expect(storedDraft('test:rules')?.edit).toEqual({ a: 'x', b: '' })
    expect(undoDraft(parts)).toBe(true)
    expect(storedDraft('test:rules')?.edit).toEqual({ a: '', b: '' })
    expect(undoDraft(parts)).toBe(false)
    expect(redoDraft(parts)).toBe(true)
    expect(storedDraft('test:rules')?.edit).toEqual({ a: 'x', b: '' })
  })

  it('leave a section that is not open alone', () => {
    writeDraft('test:tabs', { base: rules, edit: rules }, { base: rules, edit: { ...rules, b: 'z' } })
    expect(undoDraft([{ scope: 'test:tabs', keys: ['a'] }])).toBe(false)
    expect(storedDraft('test:tabs')?.edit).toEqual({ a: '', b: 'z' })
  })
})
