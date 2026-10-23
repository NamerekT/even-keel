import { describe, expect, it } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import type { ModelList } from './contract.js'
import { ModelCatalog } from './models.js'

const home = { key: 'opencode', agent: 'opencode', dir: 'D:/accounts/opencode' } as AccountHome
const FREE: ModelList = { models: ['opencode/deepseek-v4.1-flash-free', 'opencode/big-pickle'], complete: true }

function catalog(answers: (ModelList | Error)[], now = { at: 0 }) {
  const asked: string[] = []
  const models = new ModelCatalog({
    list: async (each) => {
      asked.push(each.key)
      const answer = answers.shift()
      if (answer === undefined) throw new Error('asked once too often')
      if (answer instanceof Error) throw answer
      return answer
    },
    title: () => 'OpenCode',
    name: (each) => `${each.key} (named)`,
    now: () => now.at,
    log: () => {},
  })
  return { models, asked, now }
}

describe('ModelCatalog', () => {
  it('refuses a model a complete list does not have, naming the account and what it has', async () => {
    const { models } = catalog([FREE, FREE])
    const refusal = await models.refusal(home, 'NAM-65', 'deepseek-v4.1')
    expect(refusal).toEqual({
      code: 'chain.unknownModel',
      params: { task: 'NAM-65', model: 'deepseek-v4.1', agent: 'OpenCode', account: 'opencode (named)', known: FREE.models },
    })
  })

  it('lets a listed model, the default and anything of an incomplete list through', async () => {
    const { models } = catalog([FREE, { models: ['opus', 'sonnet'], complete: false }])
    expect(await models.refusal(home, 'NAM-65', 'opencode/big-pickle')).toBeUndefined()
    expect(await models.refusal(home, 'NAM-65', null)).toBeUndefined()
    const claude = { ...home, key: 'claude' }
    expect(await models.refusal(claude, 'NAM-65', 'claude-opus-5-5')).toBeUndefined()
  })

  it('keeps a list for a while and reads it anew once it is old', async () => {
    const { models, asked, now } = catalog([FREE, FREE])
    await models.of(home)
    now.at = 60_000
    await models.of(home)
    expect(asked).toHaveLength(1)
    now.at = 11 * 60_000
    await models.of(home)
    expect(asked).toHaveLength(2)
  })

  it('reads the list anew before refusing on a kept one: the account may have signed in to another provider since', async () => {
    const { models, asked } = catalog([FREE, { models: [...FREE.models, 'deepseek/deepseek-v4.1'], complete: true }])
    await models.of(home)
    expect(await models.refusal(home, 'NAM-65', 'deepseek/deepseek-v4.1')).toBeUndefined()
    expect(asked).toHaveLength(2)
  })

  it('does not hold a launch when the agent does not answer', async () => {
    const { models } = catalog([new Error('opencode: not found')])
    expect(await models.of(home)).toBeNull()
    expect(await models.refusal(home, 'NAM-65', 'deepseek-v4.1')).toBeUndefined()
  })

  it('asks a failed agent again only after a minute', async () => {
    const { models, asked, now } = catalog([new Error('busy'), FREE])
    await models.of(home)
    await models.of(home)
    expect(asked).toHaveLength(1)
    now.at = 61_000
    expect(await models.of(home)).toEqual(FREE)
  })

  it('asks once for callers that come together', async () => {
    const { models, asked } = catalog([FREE])
    await Promise.all([models.of(home), models.of(home)])
    expect(asked).toHaveLength(1)
  })
})
