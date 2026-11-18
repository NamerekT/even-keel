import { describe, expect, it } from 'vitest'
import { parseConfig } from '../config.js'
import type { TaskRun } from '../sessions/runs.js'
import { wireChoiceFor, wirePlanFor, type ChoiceContext } from './accounts.js'

/** A machine whose folders are `here`; `folderOf` maps the hub's folder to one of them, null — none of that account. */
function machine(folderOf: (key: string) => string | null, here: Record<string, string>, run?: TaskRun): ChoiceContext {
  const config = parseConfig({ projects: [], accounts: { claude: 'main', codex: 'codex' } })
  return {
    homes: { find: (key: string) => (here[key] === undefined ? undefined : { key, agent: here[key] }) } as unknown as ChoiceContext['homes'],
    hasAccount: (provider, key) => here[key] === provider,
    projectOf: () => undefined,
    configStore: { current: config },
    runOfTask: () => run,
    demo: { owns: () => false },
    folderOf,
  }
}

describe('the launch choice on a machine (BTN-1311)', () => {
  it('runs on the machine\'s folder of the hub\'s account, under whatever name it has here', () => {
    const choiceFor = wireChoiceFor(machine((key) => (key === 'main' ? 'token' : key), { token: 'claude' }))
    expect(choiceFor(undefined)).toMatchObject({ provider: 'claude', account: 'token' })
    expect(choiceFor(undefined).absent).toBeUndefined()
  })

  it('names the hub\'s folder as absent and no folder here when the machine has none of its account', () => {
    const choiceFor = wireChoiceFor(machine(() => null, { main: 'claude' }))
    expect(choiceFor(undefined)).toMatchObject({ provider: 'claude', account: '', absent: 'main' })
  })

  it('keeps a task\'s own run on its agent instead of falling back when the machine lacks that account', () => {
    const run: TaskRun = { provider: 'codex', model: null }
    const ctx = machine((key) => (key === 'codex' ? null : key), { main: 'claude' }, run)
    expect(wireChoiceFor(ctx)(undefined, 'A-1')).toMatchObject({ provider: 'codex', account: '', absent: 'codex', fallback: null })
    const plan = wirePlanFor({ ...ctx, unattended: () => false, promptLanguage: () => 'en' })('A-1', 'Go')
    expect(plan).toMatchObject({ provider: 'codex', absent: 'codex' })
  })
})
