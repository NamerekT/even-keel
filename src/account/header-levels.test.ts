import { describe, expect, it } from 'vitest'
import { headerLevels, type HeaderContext } from './header-levels.js'
import type { Task } from '../tracker/model.js'
import type { RunSettings } from '../sessions/launch.js'

const shared: RunSettings = { provider: 'codex', accounts: { codex: 'shared', claude: 'claude', opencode: 'open' }, models: {}, labels: true }
const task = (id: string, provider?: string): Task => ({ id, runLabels: provider ? [{ provider, model: null }] : [], status: { name: 'Todo', category: 'ToDo' } }) as Task
const level = (account: string, source: string, task?: string) => ({ account, source, ...(task && { task }) })
function context(own: Partial<RunSettings> = {}, tasks = [task('ABC-1')]): HeaderContext {
  return { shared, project: { ...shared, ...own }, tasks, order: tasks.map((each) => each.id), current: null, sessionAccount: () => undefined, hasAccount: () => true }
}

describe('header account levels', () => {
  it('shows only Even Keel without project overrides or labels, including an empty chain', () => {
    expect(headerLevels(context())).toEqual([level('shared', 'shared')])
    expect(headerLevels(context({}, []))).toEqual([level('shared', 'shared')])
  })
  it('shows a labelled provider above the shared account', () => {
    expect(headerLevels(context({}, [task('ABC-1', 'opencode')]))).toEqual([level('open', 'task', 'ABC-1'), level('shared', 'shared')])
  })
  it('shows three distinct levels and the project account without a label', () => {
    const own = { provider: 'claude', accounts: { ...shared.accounts, claude: 'project' } }
    expect(headerLevels(context(own, [task('ABC-1', 'opencode')]))).toEqual([level('open', 'task', 'ABC-1'), level('project', 'project'), level('shared', 'shared')])
    expect(headerLevels(context(own))).toEqual([level('project', 'project'), level('shared', 'shared')])
  })
  it('keeps only the upper occurrence of an account', () => {
    expect(headerLevels(context({ provider: 'claude' }, [task('ABC-1', 'codex')]))).toEqual([level('shared', 'task', 'ABC-1'), level('claude', 'project')])
    expect(headerLevels(context({}, [task('ABC-1', 'codex')]))).toEqual([level('shared', 'task', 'ABC-1')])
  })
  it('uses launch fallback and ignores disabled or ambiguous labels', () => {
    const ctx = context({}, [task('ABC-1', 'opencode')])
    expect(headerLevels({ ...ctx, hasAccount: () => false })).toEqual([level('shared', 'shared')])
    expect(headerLevels({ ...ctx, project: { ...shared, labels: false } })).toEqual([level('shared', 'shared')])
    expect(headerLevels({ ...ctx, tasks: [{ ...ctx.tasks[0]!, runLabels: [...ctx.tasks[0]!.runLabels, { provider: 'claude', model: null }] }] })).toEqual([level('shared', 'shared')])
  })
  it('keeps the launched session account after settings change, including while paused', () => {
    const ctx = context({}, [task('ABC-1', 'opencode')])
    const current = { task: 'ABC-1', sessionId: 'session', since: '' }
    expect(headerLevels({ ...ctx, current, sessionAccount: () => 'original' })).toEqual([level('original', 'task', 'ABC-1'), level('shared', 'shared')])
  })
  it('switches from a closed current task to the next ordered task before it launches', () => {
    const tasks = [{ ...task('ABC-1', 'opencode'), status: { name: 'Done', category: 'Won' as const } }, task('ABC-2', 'claude'), task('ABC-3', 'opencode')]
    const ctx = context({}, tasks)
    const current = { task: 'ABC-1', sessionId: 'session', since: '' }
    expect(headerLevels({ ...ctx, current, order: ['ABC-3', 'ABC-2'], sessionAccount: () => 'original' })).toEqual([level('open', 'task', 'ABC-3'), level('shared', 'shared')])
  })
  it('uses the next task even when a chain is stopped, and the project when it is empty', () => {
    expect(headerLevels(context({}, [task('ABC-1', 'claude')]))[0]).toEqual(level('claude', 'task', 'ABC-1'))
    expect(headerLevels(context({ provider: 'claude' }, []))).toEqual([level('claude', 'project'), level('shared', 'shared')])
  })
  it('passes over skipped tasks and tasks blocked by held tasks as the dispatcher does', () => {
    const first = task('ABC-1', 'claude')
    const second = { ...task('ABC-2', 'claude'), blockedBy: ['ABC-1'] }
    const third = task('ABC-3', 'opencode')
    expect(headerLevels({ ...context({}, [first, second, third]), holding: ['ABC-1'] })[0]).toEqual(level('open', 'task', 'ABC-3'))
  })
})
