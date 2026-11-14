import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES } from '../chain/rules.js'
import { noticeOf } from '../notice/notice.js'
import { PendingCloses } from '../tracker/close.js'
import type { TrackerLink } from '../tracker/link.js'
import type { TaskTracker } from '../tracker/source.js'
import { wireClosing, type ClosingContext } from './closing.js'

const RULES = { ...DEFAULT_RULES, terminal: ['Done', 'Released'] }

function setup(done: string | null, refuse = false) {
  const calls: string[] = []
  const tracker = {
    complete: async (task: string, status?: string) => {
      calls.push(`complete ${task} ${status ?? '-'}`)
      if (refuse) throw new Error('tracker: archived')
      return true
    },
    comment: async (task: string, text: string) => void calls.push(`comment ${task} ${text}`),
  } as unknown as TaskTracker
  const link = { run: (call: (tracker: TaskTracker) => Promise<unknown>) => call(tracker) } as unknown as TrackerLink
  const pending = new PendingCloses()
  const ctx = {
    linkFor: () => link,
    readerFor: () => 'ABC',
    readerMoves: (reader: string) => ({ reader, rules: RULES, ...(done !== null && { source: { done } }) }),
    pendingCloses: pending,
  } as unknown as ClosingContext
  return { closing: wireClosing(ctx), calls, pending }
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise
  } catch (error) {
    return noticeOf(error)
  }
  throw new Error('expected a refusal')
}

describe('wireClosing', () => {
  it('closes a merged pull request, a NO CHANGES mark and an accepted answer into the chosen done status', async () => {
    const { closing, calls } = setup('Released')
    await closing.review('ABC', 'ABC-1', true)
    await closing.review('ABC', 'ABC-2', false)
    await closing.unchanged('ABC', 'ABC-3', 'no change')
    await closing.accept('ABC', 'ABC-4', 'the answer')
    expect(calls).toEqual([
      'complete ABC-1 Released',
      'complete ABC-2 Released',
      'complete ABC-3 Released',
      'comment ABC-3 no change',
      'comment ABC-4 the answer',
      'complete ABC-4 Released',
    ])
  })

  it('closes into the tracker first done status when none is chosen', async () => {
    const { closing, calls } = setup(null)
    await closing.unchanged('ABC', 'ABC-1', 'no change')
    expect(calls[0]).toBe('complete ABC-1 -')
  })

  it('does not close on any path into a status the rules do not take for done, and says so', async () => {
    const { closing, calls, pending } = setup('In Review')
    const notDone = (held: boolean) => ({ code: 'statusMove.notDone', params: { task: 'ABC-1', status: 'In Review', level: 'source', ...(held && { held: true }) } })
    expect(await refusal(closing.review('ABC', 'ABC-1', true))).toEqual(notDone(false))
    expect(pending.failures('ABC')).toEqual([notDone(false)])
    expect(await refusal(closing.review('ABC', 'ABC-1', false))).toEqual(notDone(true))
    expect(await refusal(closing.unchanged('ABC', 'ABC-1', 'no change'))).toEqual(notDone(true))
    expect(await refusal(closing.accept('ABC', 'ABC-1', 'the answer'))).toEqual(notDone(true))
    expect(calls).toEqual([])
  })

  it('names the status and the level of a refused close, and keeps only a merged pull request for the closer', async () => {
    const { closing, pending } = setup('Released', true)
    const refused = (held: boolean) => ({
      code: 'tracker.completeRefused',
      params: { task: 'ABC-1', status: 'Released', level: 'source', ...(held && { held: true }) },
      detail: 'tracker: archived',
    })
    expect(await refusal(closing.review('ABC', 'ABC-1', false))).toEqual(refused(true))
    expect(pending.has('ABC', 'ABC-1')).toBe(false)
    expect(await refusal(closing.unchanged('ABC', 'ABC-1', 'no change'))).toEqual(refused(true))
    expect(await refusal(closing.accept('ABC', 'ABC-1', 'the answer'))).toEqual(refused(true))
    expect(await refusal(closing.review('ABC', 'ABC-1', true))).toEqual(refused(false))
    expect(pending.failures('ABC')).toEqual([refused(false)])
  })
})
