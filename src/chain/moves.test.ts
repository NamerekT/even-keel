import { describe, expect, it } from 'vitest'
import { defaultMoves, doneMove, doneNamed, moveVerdict, movesOf, movesProblem, statusMovesOf } from './moves.js'
import { DEFAULT_RULES, isDone } from './rules.js'

const TODO = { name: 'Todo', category: 'ToDo' } as const
const PROGRESS = { name: 'In Progress', category: 'Active' } as const
const REVIEW = { name: 'In Review', category: 'Active' } as const
const DONE = { name: 'Done', category: 'Won' } as const
const CANCELED = { name: 'Canceled', category: 'Lost' } as const
const BACKLOG = { name: 'Backlog', category: 'UnStarted' } as const

describe('moveVerdict', () => {
  it('moves a ready task on its start and leaves a started one where it is', () => {
    expect(moveVerdict('start', DEFAULT_RULES, TODO, PROGRESS)).toBe('move')
    expect(moveVerdict('start', DEFAULT_RULES, PROGRESS, REVIEW)).toBe('stay')
    expect(moveVerdict('start', DEFAULT_RULES, REVIEW, PROGRESS)).toBe('stay')
    expect(moveVerdict('start', DEFAULT_RULES, BACKLOG, PROGRESS)).toBe('stay')
  })

  it('moves any open task on its pull request', () => {
    expect(moveVerdict('review', DEFAULT_RULES, TODO, REVIEW)).toBe('move')
    expect(moveVerdict('review', DEFAULT_RULES, PROGRESS, REVIEW)).toBe('move')
    expect(moveVerdict('review', DEFAULT_RULES, DONE, REVIEW)).toBe('stay')
    expect(moveVerdict('review', DEFAULT_RULES, CANCELED, REVIEW)).toBe('stay')
  })

  it('does nothing for a task already in the status, whatever the case', () => {
    expect(moveVerdict('start', DEFAULT_RULES, TODO, { name: ' todo ', category: 'ToDo' })).toBe('stay')
    expect(moveVerdict('review', DEFAULT_RULES, REVIEW, { name: 'in review', category: 'Active' })).toBe('stay')
  })

  it('refuses a status out of the chain, which would release the task at once', () => {
    expect(moveVerdict('start', DEFAULT_RULES, TODO, BACKLOG)).toBe('outside')
    expect(moveVerdict('review', { ...DEFAULT_RULES, active: ['Todo', 'In Progress'] }, PROGRESS, REVIEW)).toBe('outside')
    expect(moveVerdict('review', { ...DEFAULT_RULES, terminal: ['In Review'] }, PROGRESS, REVIEW)).toBe('outside')
  })

  it('tries a status the tracker did not list: the tracker answers for it', () => {
    expect(moveVerdict('start', DEFAULT_RULES, TODO, null)).toBe('move')
    expect(moveVerdict('start', DEFAULT_RULES, PROGRESS, null)).toBe('stay')
  })
})

describe('the done status', () => {
  it('fits only a Won status the rules take for terminal', () => {
    expect(isDone(DEFAULT_RULES, DONE)).toBe(true)
    expect(isDone(DEFAULT_RULES, CANCELED)).toBe(false)
    expect(isDone({ ...DEFAULT_RULES, terminal: ['Shipped'] }, DONE)).toBe(false)
    expect(isDone({ ...DEFAULT_RULES, terminal: ['In Review'] }, REVIEW)).toBe(false)
  })

  it('is checked by name where the rules list the terminal statuses', () => {
    expect(doneNamed(DEFAULT_RULES, 'Anything')).toBe(true)
    expect(doneNamed({ ...DEFAULT_RULES, terminal: ['Done', 'Canceled'] }, 'done')).toBe(true)
    expect(doneNamed({ ...DEFAULT_RULES, terminal: ['Shipped'] }, 'Done')).toBe(false)
  })
})

describe('movesOf', () => {
  it('takes the source’s own value, its null included, over the profile’s', () => {
    expect(movesOf({ start: 'In Progress', review: 'In Review', done: 'Done' }, { start: 'Doing', review: null, done: 'Shipped' })).toEqual({
      start: 'Doing',
      review: null,
      done: 'Shipped',
    })
  })

  it('falls back to the profile, then to leaving the status and the automatic close', () => {
    expect(movesOf({ start: 'In Progress', done: 'Done' }, {})).toEqual({ start: 'In Progress', review: null, done: 'Done' })
    expect(movesOf(undefined, undefined)).toEqual({ start: null, review: null, done: null })
    expect(movesOf({ start: null }, { review: undefined })).toEqual({ start: null, review: null, done: null })
  })
})

describe('defaultMoves', () => {
  it('offers the first started status and the review one, the close left automatic', () => {
    expect(defaultMoves(DEFAULT_RULES, [BACKLOG, TODO, PROGRESS, REVIEW, DONE, CANCELED])).toEqual({ start: 'In Progress', review: 'In Review' })
    expect(defaultMoves(DEFAULT_RULES, [TODO, { name: 'В работе', category: 'Active' }, { name: 'На ревью', category: 'Active' }])).toEqual({
      start: 'В работе',
      review: 'На ревью',
    })
  })

  it('leaves the status where nothing fits', () => {
    expect(defaultMoves(DEFAULT_RULES, [TODO, PROGRESS, DONE])).toEqual({ start: 'In Progress', review: null })
    expect(defaultMoves(DEFAULT_RULES, [TODO, DONE])).toEqual({ start: null, review: null })
    expect(defaultMoves(DEFAULT_RULES, [])).toEqual({ start: null, review: null })
  })

  it('offers only statuses in the chain', () => {
    expect(defaultMoves({ ...DEFAULT_RULES, active: ['Todo', 'In Review'] }, [TODO, PROGRESS, REVIEW])).toEqual({ start: 'In Review', review: 'In Review' })
  })
})

describe('movesProblem', () => {
  const statuses = [BACKLOG, TODO, PROGRESS, REVIEW, DONE, CANCELED]

  it('passes statuses in the chain and a done one', () => {
    expect(movesProblem(DEFAULT_RULES, { start: 'In Progress', review: 'in review', done: 'Done' }, statuses)).toBeNull()
    expect(movesProblem(DEFAULT_RULES, { start: null, review: null }, statuses)).toBeNull()
  })

  it('names the first status out of the chain, or one the chain does not take for done', () => {
    expect(movesProblem(DEFAULT_RULES, { start: 'Backlog' }, statuses)).toEqual({ code: 'statusMoves.outside', params: { status: 'Backlog', setting: 'start' } })
    expect(movesProblem({ ...DEFAULT_RULES, active: ['Todo', 'In Progress'] }, { review: 'In Review' }, statuses)).toEqual({
      code: 'statusMoves.outside',
      params: { status: 'In Review', setting: 'review' },
    })
    expect(movesProblem(DEFAULT_RULES, { done: 'Canceled' }, statuses)).toEqual({ code: 'statusMoves.notDone', params: { status: 'Canceled' } })
    expect(movesProblem({ ...DEFAULT_RULES, terminal: ['Canceled'] }, { done: 'Done' }, statuses)).toEqual({ code: 'statusMoves.notDone', params: { status: 'Done' } })
  })

  it('lets a status the tracker did not list through by name only', () => {
    expect(movesProblem(DEFAULT_RULES, { start: 'Unknown', done: 'Unknown' }, statuses)).toBeNull()
    expect(movesProblem({ ...DEFAULT_RULES, terminal: ['Done'] }, { done: 'Unknown' }, statuses)).toEqual({ code: 'statusMoves.notDone', params: { status: 'Unknown' } })
  })
})

describe('statusMovesOf', () => {
  it('keeps names trimmed and null of start and review, and drops blanks as not set', () => {
    expect(statusMovesOf({ start: ' In Progress ', review: null, done: '' }, 'x')).toEqual({ start: 'In Progress', review: null })
  })

  it('refuses another key, a null done and a value of another type', () => {
    for (const raw of [[], { other: 'x' }, { done: null }, { start: 3 }]) {
      expect(() => statusMovesOf(raw, 'ABC.statusMoves')).toThrow('config: ABC.statusMoves must be an object of status names')
    }
  })
})

describe('doneMove', () => {
  it('says where the done status is set and whether the rules take it for done; none set — automatic', () => {
    const rules = { ...DEFAULT_RULES, terminal: ['Done', 'Canceled'] }
    expect(doneMove(rules, undefined, {})).toBeUndefined()
    expect(doneMove(rules, { done: 'Done' }, {})).toEqual({ status: 'Done', level: 'profile', fits: true })
    expect(doneMove(rules, { done: 'Done' }, { done: 'In Review' })).toEqual({ status: 'In Review', level: 'source', fits: false })
  })
})
