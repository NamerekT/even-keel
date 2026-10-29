import { describe, expect, it } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import { checkAgents } from './cli-check.js'

const home = (key: string, agent: string): AccountHome => ({ key, dir: `/homes/${key}`, global: false, agent })
const HOMES = [home('main', 'claude'), home('other', 'claude'), home('codex', 'codex')]

function contextOf(settings: Record<string, unknown>, runtimes = ['claude', 'codex']) {
  return {
    configStore: {
      current: {
        projects: { p1: '/p1', p2: '/p2', p3: '/p3' },
        settings,
        provider: 'claude',
        models: {},
        accounts: { claude: 'main', codex: 'codex' },
        modelLabels: false,
      },
    },
    homes: { find: (key: string) => HOMES.find((each) => each.key === key) },
    runtimes: new Map(runtimes.map((name) => [name, {}])),
  } as unknown as Parameters<typeof checkAgents>[0]
}

describe('checkAgents', () => {
  it('checks each agent the projects run on in the first folder a project chooses', () => {
    const agents = checkAgents(contextOf({ p1: {}, p2: { provider: 'codex' }, p3: { accounts: { claude: 'other' } } }))
    expect(agents.map(({ name, home }) => [name, home.key])).toEqual([['claude', 'main'], ['codex', 'codex']])
  })

  it('leaves out an agent no project runs on, one without a runtime and a folder of another agent', () => {
    expect(checkAgents(contextOf({ p1: {}, p2: {}, p3: {} })).map(({ name }) => name)).toEqual(['claude'])
    expect(checkAgents(contextOf({ p1: { provider: 'codex' }, p2: { provider: 'codex' }, p3: { provider: 'codex' } }, ['claude']))).toEqual([])
    expect(checkAgents(contextOf({ p1: { provider: 'codex', accounts: { codex: 'main' } }, p2: {}, p3: {} })).map(({ name }) => name)).toEqual(['claude'])
  })
})
