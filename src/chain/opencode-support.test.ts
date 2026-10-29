import { describe, expect, it } from 'vitest'
import { ModelCatalog } from '../agent/models.js'
import { NoticeError } from '../notice/notice.js'
import { copilotUnsupported } from '../opencode/support.js'
import { runChoice } from '../sessions/launch.js'
import { setup, task } from './dispatcher.fixture.js'

describe('unsupported OpenCode Copilot in a chain', () => {
  it('pauses before launching on a Copilot-only folder', async () => {
    const { dispatcher, launched } = setup({ blocked: copilotUnsupported() })
    dispatcher.setTasks('ABC', [task('ABC-1')])
    await dispatcher.start('ABC')
    await dispatcher.idle()
    expect(launched).toEqual([])
    expect(dispatcher.state.active[0]).toMatchObject({ paused: true, error: copilotUnsupported() })
  })

  it('preserves the refusal when the selected model comes from a run label', async () => {
    const labelled = { ...task('ABC-1'), runLabels: [{ provider: 'opencode', model: 'github-copilot/gpt-6.1' }] }
    const choice = runChoice(labelled, { provider: 'claude', models: {}, accounts: { claude: 'global', opencode: 'mixed' }, labels: true }, () => true)
    const models = new ModelCatalog({ list: async () => null, title: () => 'OpenCode', name: () => 'Mixed', now: Date.now, log: () => {} })
    const refusal = await models.refusal({ key: choice.account, agent: choice.provider, dir: '/unused', global: false }, labelled.id, choice.model)
    expect(refusal).toEqual(copilotUnsupported())
    const { dispatcher, launched } = setup({ refuse: { [labelled.id]: new NoticeError(refusal!) } })
    dispatcher.setTasks('ABC', [labelled])
    await dispatcher.start('ABC')
    await dispatcher.idle()
    expect(launched).toEqual([])
    expect(dispatcher.state.active[0]).toMatchObject({ paused: true, error: copilotUnsupported() })
  })
})
