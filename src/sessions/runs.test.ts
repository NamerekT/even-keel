import { describe, expect, it } from 'vitest'
import { NoticeError } from '../notice/notice.js'
import { fakeTask as task } from '../tracker/fixture.js'
import { effortFor, patchedRun, sameRun, taskRunOf, taskRunText, TaskRuns, type StoredRun } from './runs.js'

const codeOf = (run: () => unknown): string | undefined => {
  try {
    run()
  } catch (error) {
    return error instanceof NoticeError ? error.notice.code : String(error)
  }
  return undefined
}

describe('taskRunOf', () => {
  it('normalizes the provider and the effort and keeps the model as written', () => {
    expect(taskRunOf({ provider: ' Claude ', model: ' Opus[1m] ', effort: 'HIGH' })).toEqual({ provider: 'claude', model: 'Opus[1m]', effort: 'high' })
    expect(taskRunOf({ provider: 'codex' })).toEqual({ provider: 'codex', model: null, effort: null })
    expect(taskRunOf({ effort: 'low' })).toEqual({ provider: null, model: null, effort: 'low' })
  })

  it('nothing set is no run', () => {
    expect(taskRunOf({})).toBeNull()
    expect(taskRunOf({ provider: '', model: null, effort: ' ' })).toBeNull()
  })

  it('refuses an unknown provider, a model without a provider and an effort the provider does not take', () => {
    expect(codeOf(() => taskRunOf({ provider: 'gemini' }))).toBe('run.unknownProvider')
    expect(codeOf(() => taskRunOf({ model: 'opus' }))).toBe('run.modelWithoutProvider')
    expect(codeOf(() => taskRunOf({ provider: 'claude', effort: 'minimal' }))).toBe('run.unknownEffort')
    expect(codeOf(() => taskRunOf({ provider: 'opencode', effort: 'extreme' }))).toBe('run.unknownEffort')
    expect(codeOf(() => taskRunOf({ effort: 'extreme' }))).toBe('run.unknownEffort')
    expect(codeOf(() => taskRunOf({ provider: 7 }))).toBe('request.required')
  })
})

describe('patchedRun', () => {
  const current = { provider: 'claude', model: 'opus', effort: 'high' }

  it('changes the fields named and keeps the rest', () => {
    expect(patchedRun(current, { effort: 'max' })).toEqual({ ...current, effort: 'max' })
    expect(patchedRun(current, { model: null })).toEqual({ ...current, model: null })
    expect(patchedRun(undefined, { effort: 'low' })).toEqual({ provider: null, model: null, effort: 'low' })
  })

  it('a new provider drops the model the change does not name; the same one, however written, keeps it', () => {
    expect(patchedRun({ ...current, effort: null }, { provider: 'codex' })).toEqual({ provider: 'codex', model: null, effort: null })
    expect(patchedRun(current, { provider: 'codex', model: 'gpt-example', effort: null })).toEqual({ provider: 'codex', model: 'gpt-example', effort: null })
    expect(patchedRun(current, { provider: ' Claude ' })).toEqual(current)
  })

  it('checks the result as a whole and gives no run when nothing is left', () => {
    expect(codeOf(() => patchedRun({ ...current, effort: 'max' }, { provider: 'codex' }))).toBe('run.unknownEffort')
    expect(codeOf(() => patchedRun(current, { provider: null, model: 'opus' }))).toBe('run.modelWithoutProvider')
    expect(patchedRun(current, { provider: null })).toEqual({ provider: null, model: null, effort: 'high' })
    expect(patchedRun(current, { provider: null, model: null, effort: null })).toBeNull()
  })
})

describe('sameRun', () => {
  it('compares field by field, no run being every field empty', () => {
    const run = { provider: 'claude', model: null, effort: null }
    expect(sameRun(run, { ...run })).toBe(true)
    expect(sameRun(run, { ...run, effort: 'high' })).toBe(false)
    expect(sameRun(undefined, null)).toBe(true)
    expect(sameRun(undefined, run)).toBe(false)
  })
})

describe('effortFor', () => {
  it('gives the effort only to a provider that takes the level', () => {
    const run = { provider: null, model: null, effort: 'max' }
    expect(effortFor(run, 'claude')).toBe('max')
    expect(effortFor(run, 'codex')).toBeNull()
    expect(effortFor(run, 'copilot')).toBe('max')
    expect(effortFor(run, 'opencode')).toBe('max')
    expect(effortFor({ ...run, effort: 'none' }, 'claude')).toBeNull()
    expect(effortFor({ ...run, effort: 'none' }, 'opencode')).toBe('none')
    expect(effortFor(undefined, 'claude')).toBeNull()
  })
})

describe('taskRunText', () => {
  it('names what is set', () => {
    expect(taskRunText({ provider: 'claude', model: 'opus', effort: 'high' })).toBe('Claude | opus · high')
    expect(taskRunText({ provider: 'codex', model: null, effort: null })).toBe('Codex')
    expect(taskRunText({ provider: null, model: null, effort: 'low' })).toBe('low')
  })
})

describe('TaskRuns', () => {
  const store = () => {
    const calls: string[] = []
    return {
      calls,
      save: (run: StoredRun) => calls.push(`save ${run.task} ${run.provider}|${run.model}|${run.effort}`),
      drop: (_project: string, id: string) => calls.push(`drop ${id}`),
      imported: (project: string) => calls.push(`imported ${project}`),
    }
  }

  it('keeps a run by project and task and writes each change behind', () => {
    const kept = store()
    const runs = new TaskRuns([{ project: 'p1', task: 'ABC-1', provider: 'claude', model: 'opus', effort: null }], [], kept)
    expect(runs.of('p1', 'ABC-1')).toEqual({ provider: 'claude', model: 'opus', effort: null })
    expect(runs.of('p2', 'ABC-1')).toBeUndefined()
    runs.set('p2', 'ABC-1', { provider: 'codex', model: null, effort: 'high' })
    runs.set('p1', 'ABC-1', null)
    runs.set('p1', 'ABC-9', null)
    expect(runs.ofProject('p1')).toEqual({})
    expect(runs.ofProject('p2')).toEqual({ 'ABC-1': { provider: 'codex', model: null, effort: 'high' } })
    expect(kept.calls).toEqual(['save ABC-1 codex|null|high', 'drop ABC-1'])
  })

  it('moves the run label of each open task of a marked project into a run, once', () => {
    const kept = store()
    const runs = new TaskRuns([{ project: 'p1', task: 'ABC-4', provider: 'codex', model: null, effort: 'low' }], ['p1'], kept)
    const done = { name: 'Done', category: 'Won' as const }
    const tasks = [
      task('ABC-1', { labels: ['Claude | opus', 'bug'] }),
      task('ABC-2', { labels: ['Codex'] }),
      task('ABC-3', { labels: ['Claude | opus', 'Codex'] }),
      task('ABC-4', { labels: ['Claude | sonnet'] }),
      task('ABC-5', { labels: ['Claude | haiku'], status: done }),
      task('ABC-6', { labels: ['bug'] }),
    ]
    expect(runs.importLabels('p1', tasks)).toEqual(['ABC-1', 'ABC-2'])
    expect(runs.ofProject('p1')).toEqual({
      'ABC-1': { provider: 'claude', model: 'opus', effort: null },
      'ABC-2': { provider: 'codex', model: null, effort: null },
      'ABC-4': { provider: 'codex', model: null, effort: 'low' },
    })
    expect(kept.calls).toEqual(['save ABC-1 claude|opus|null', 'save ABC-2 codex|null|null', 'imported p1'])
    expect(runs.importLabels('p1', [task('ABC-7', { labels: ['Codex'] })])).toEqual([])
    expect(runs.of('p1', 'ABC-7')).toBeUndefined()
  })

  it('moves nothing for a project that did not read run labels', () => {
    const kept = store()
    const runs = new TaskRuns([], ['p1'], kept)
    expect(runs.importLabels('p2', [task('ABC-1', { labels: ['Codex'] })])).toEqual([])
    expect(kept.calls).toEqual([])
  })
})
