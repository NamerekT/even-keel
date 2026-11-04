import { describe, expect, it, vi } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import { PROMPTS } from '../chain/prompts.js'
import { resumePrompt, type HandoffSession } from '../chain/relay.js'
import { wirePlanFor } from './accounts.js'
import { goOnWith, resumeWith, steer } from './chain.js'

const instructions = 'Model-specific instructions.'

function setup() {
  const home = { key: 'test', agent: 'claude' } as AccountHome
  const planning = {
    dispatcher: { state: { unattended: true } },
    promptLanguage: () => 'en', projectOf: () => undefined,
    knownTask: () => undefined, hasAccount: () => true,
    configStore: { current: {
      provider: 'claude', models: { claude: 'sonnet' }, accounts: { claude: 'test' },
      modelLabels: false, modelPrompts: { 'Claude | *': instructions }, settings: {},
    } },
  } as unknown as Parameters<typeof wirePlanFor>[0]
  const reply = vi.fn().mockResolvedValue('session-1')
  const resumeIn = vi.fn().mockResolvedValue('session-1')
  const ctx = {
    planFor: wirePlanFor(planning), projectOf: planning.projectOf,
    agentExtras: () => ({ protection: false }), settingsFor: () => ({ test: true }),
    monitor: { holds: { during: (_id: string, action: () => Promise<string>) => action() } },
    approved: () => false, homeOf: () => home, liveView: () => undefined,
    agentOf: () => ({ reply }), daemons: { prepare: vi.fn() }, stopIn: vi.fn(), resumeIn,
  } as unknown as Parameters<typeof goOnWith>[0]
  ctx.goOnWith = (account, task, session, prompt) => goOnWith(ctx, account, task, session, prompt)
  const session = { sessionId: 'session-1', account: 'test', cwd: '/test/worktree', stopped: true } as HandoffSession
  return { ctx, home, session, reply, resumeIn, planning }
}

describe('continuation prompts', () => {
  it('keeps the initial launch plan enriched', () => {
    const { ctx } = setup()
    const plan = ctx.planFor('ABC-1', 'Start')
    expect(plan.prompt).toContain(instructions)
    expect(plan.prompt).toContain(PROMPTS.en.unattended)
    expect(plan.model).toBe('sonnet')
  })

  it.each(['готово', '  Keep the spacing.\n\n', resumePrompt('en')])('resumes with the exact continuation %j', async (prompt) => {
    const { ctx, home, session, resumeIn } = setup()
    await resumeWith(ctx, 'ABC-1', session, prompt)
    expect(resumeIn).toHaveBeenCalledExactlyOnceWith(home, session, expect.objectContaining({
      prompt, model: 'sonnet', cwd: session.cwd, settings: { test: true }, protection: false,
    }))
  })

  it('steers a running SDK session with the exact message', async () => {
    const { ctx, home, session, reply } = setup()
    delete session.stopped
    expect(await steer(ctx, 'ABC-1', session, 'готово')).toBe(true)
    expect(reply).toHaveBeenCalledExactlyOnceWith(home, session, expect.objectContaining({ prompt: 'готово', model: 'sonnet' }))
  })

  it('uses a changed model without adding its prompt to the continuation', () => {
    const { ctx, home, session, planning } = setup()
    planning.configStore.current.models.claude = 'haiku'
    expect(goOnWith(ctx, home, 'ABC-1', session, 'Continue')).toMatchObject({ prompt: 'Continue', model: 'haiku' })
  })
})
