import { describe, expect, it } from 'vitest'
import type { AccountHome } from '../account/homes.js'
import { ScriptedAgent } from './scripted.js'

const homeAt = (dir: string): AccountHome => ({ key: 'script', dir, global: false, agent: 'claude' })

describe('ScriptedAgent', () => {
  // The e2e hub and its machine elsewhere share one scripted agent and name their account folders alike: a session is
  // the folder's it ran in, as a CLI's transcript is, or the hub would find a machine's session in its own folders.
  it("shows a session only to the account folder it was launched in, not to another folder of the same account's key", async () => {
    const agent = new ScriptedAgent((cwd) => cwd)
    agent.script('ABC-1', async () => ({ say: 'Done' }))
    const ran = homeAt('/machine/accounts/script')
    const other = homeAt('/hub/accounts/script')
    const sessionId = await agent.launch(ran, { name: 'ABC-1', cwd: '/machine/repo', prompt: 'Go', model: null })
    await agent.settled()

    expect((await agent.sessions(ran)).map((entry) => entry.sessionId)).toEqual([sessionId])
    expect(await agent.record(ran, sessionId)).toMatchObject({ sessionId })
    expect(await agent.sessions(other)).toEqual([])
    expect(await agent.record(other, sessionId)).toBeUndefined()
  })
})
