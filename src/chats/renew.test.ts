import { describe, expect, it } from 'vitest'
import { USER_MESSAGE_HEAD } from '../chain/user-message.js'
import { ABC } from '../storage/database.fixture.js'
import { ProjectChats } from './chats.js'
import { FAR, FAR_FOLDER, OWN, setup } from './chats.fixture.js'

const at = '2026-11-18T10:00:30.000Z'

/** A chat with its session started and the machine knowing its last turns. */
async function started(fixture: Awaited<ReturnType<typeof setup>>) {
  const { id } = await fixture.chats.create(ABC, { account: 'global', model: 'opus', effort: 'high' })
  await fixture.chats.send(id, { text: 'Why is the build slow?', files: [] })
  fixture.pasts.set(id, {
    sessionId: `session-${id}`,
    transcript: 'C:\\claude\\projects\\old.jsonl',
    recent: [{ at, kind: 'prompt', text: 'Why is the build slow?' }, { at, kind: 'tool', text: 'Read package.json' }, { at, kind: 'text', text: 'The tests run twice.' }],
  })
  fixture.calls.length = 0
  return id
}

describe('a project chat going on in a new session (BTN-1232)', { timeout: 120_000 }, () => {
  it('stops the old session, archives it with its successor and launches the new chat with the turns and the message', async () => {
    const fixture = await setup()
    try {
      const old = await started(fixture)
      const next = await fixture.chats.renew(old, { text: 'Fix the header', files: [{ name: 'shot.png', data: new Uint8Array([1]) }] }, { account: 'codex-work', model: 'gpt-5.5', effort: 'medium' })
      expect(fixture.calls.map(([name]) => name)).toEqual(['stop', 'launch'])
      const [, project, folder, chat, start] = fixture.calls[1]!
      expect([project, folder, chat]).toEqual([ABC, 'C:\\repos\\example-project', next.id])
      expect(start).toMatchObject({ account: 'codex-work', model: 'gpt-5.5', effort: 'medium' })
      const prompt = (start as { prompt: string }).prompt
      expect(prompt).toContain('- User: Why is the build slow?\n- You: The tests run twice.')
      expect(prompt).not.toContain('Read package.json')
      expect(prompt).toContain('C:\\claude\\projects\\old.jsonl')
      expect(prompt).toContain(`${USER_MESSAGE_HEAD.en}\n\nFix the header\n\nFiles`)
      expect(prompt).toContain('C:\\repos\\example-project\\.temp\\inbox\\shot.png')
      expect(next).toMatchObject({ agent: 'codex', account: 'codex-work', sessionId: `session-${next.id}`, title: 'Fix the header', state: 'starting' })
      expect(next.previous).toBe(old)
      expect(await fixture.chats.card(old)).toMatchObject({ state: 'archived', successor: next.id })
      expect(fixture.chats.choice(ABC)).toEqual({ account: 'codex-work', model: 'gpt-5.5', effort: 'medium' })
      expect(fixture.store.get(next.id)?.pending).toBeNull()
    } finally {
      await fixture.close()
    }
  })

  it("goes on on the old chat's machine elsewhere, in its folder there (BTN-1614)", async () => {
    const fixture = await setup()
    try {
      const { id } = await fixture.chats.create(ABC, { account: 'global', model: null, effort: null }, FAR)
      await fixture.chats.send(id, { text: 'Why is the build slow?', files: [] })
      fixture.calls.length = 0
      const next = await fixture.chats.renew(id, { text: 'Fix the header', files: [] }, { account: 'global', model: null, effort: null })
      expect(fixture.calls[1]?.slice(0, 3)).toEqual(['launch', ABC, FAR_FOLDER])
      expect(next.machine).toBe(FAR)
    } finally {
      await fixture.close()
    }
  })

  it('refuses when the old session does not stop, and changes nothing', async () => {
    const fixture = await setup({ stopFails: true })
    try {
      const old = await started(fixture)
      await expect(fixture.chats.renew(old, { text: 'Fix the header', files: [] }, { account: 'global', model: null, effort: null })).rejects.toMatchObject({ notice: { code: 'chats.noMachine' } })
      expect(fixture.chats.list(ABC).map((each) => each.id)).toEqual([old])
      expect(fixture.calls.map(([name]) => name)).toEqual(['stop'])
    } finally {
      await fixture.close()
    }
  })

  it('keeps the new chat without a session when the launch fails, the old one archived', async () => {
    const fixture = await setup()
    try {
      const old = await started(fixture)
      fixture.switches.launchFails = true
      await expect(fixture.chats.renew(old, { text: 'Fix the header', files: [] }, { account: 'global', model: null, effort: null })).rejects.toMatchObject({ notice: { code: 'chats.noMachine' } })
      const [next] = fixture.chats.list(ABC)
      expect(next).toMatchObject({ state: 'new', sessionId: null, title: 'Fix the header' })
      expect(fixture.store.get(next!.id)?.pending).toBeNull()
      expect(await fixture.chats.card(old)).toMatchObject({ successor: next!.id })
      await fixture.chats.sweep()
      expect(fixture.calls.filter(([name]) => name === 'launch')).toHaveLength(1)
    } finally {
      await fixture.close()
    }
  })

  it('launches what a restart left pending with the same message, at the next sweep', async () => {
    const fixture = await setup()
    try {
      const { id } = await fixture.chats.create(ABC, { account: 'global', model: 'opus', effort: null })
      fixture.store.put({ ...fixture.store.get(id)!, pending: 'the pending prompt\n' })
      const restarted = new ProjectChats(fixture.deps)
      expect(restarted.list(ABC)[0]?.state).toBe('starting')
      fixture.switches.offline = true
      await restarted.sweep()
      expect(fixture.calls).toEqual([])
      fixture.switches.offline = false
      await restarted.sweep()
      expect(fixture.calls).toEqual([['launch', ABC, 'C:\\repos\\example-project', id, { account: 'global', model: 'opus', effort: null, prompt: 'the pending prompt\n' }]])
      expect(fixture.store.get(id)).toMatchObject({ sessionId: `session-${id}`, pending: null, machine: OWN })
    } finally {
      await fixture.close()
    }
  })

  it('takes the session the machine already started under the chat\'s name instead of a second one', async () => {
    const fixture = await setup()
    try {
      const { id } = await fixture.chats.create(ABC, { account: 'global', model: null, effort: null })
      fixture.store.put({ ...fixture.store.get(id)!, pending: 'the pending prompt\n' })
      fixture.pasts.set(id, { sessionId: 'session-before-restart', transcript: null, recent: [] })
      await new ProjectChats(fixture.deps).sweep()
      expect(fixture.calls).toEqual([])
      expect(fixture.store.get(id)).toMatchObject({ sessionId: 'session-before-restart', pending: null })
    } finally {
      await fixture.close()
    }
  })
})
