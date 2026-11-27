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
    recent: [{ at, kind: 'prompt', text: 'Why is the build slow?' }, { at, kind: 'text', text: 'The tests run twice.' }],
  })
  fixture.calls.length = 0
  return id
}

describe('a project chat continued in a new session early, from its menu (BTN-1776)', { timeout: 120_000 }, () => {
  it('stops the old session and archives it with its successor, and launches nothing yet', async () => {
    const fixture = await setup()
    try {
      const old = await started(fixture)
      await fixture.chats.rename(old, 'Build speed')
      const next = await fixture.chats.continueEarly(old, { account: 'codex-work', model: 'gpt-5.5', effort: 'medium' })
      expect(fixture.calls.map(([name]) => name)).toEqual(['stop'])
      expect(next).toMatchObject({ agent: 'codex', account: 'codex-work', model: 'gpt-5.5', effort: 'medium', sessionId: null, state: 'new', previous: old, title: 'Build speed' })
      expect(await fixture.chats.card(old)).toMatchObject({ state: 'archived', successor: next.id })
      expect(fixture.chats.list(ABC).map((each) => each.id)).toEqual([next.id])
      expect(fixture.chats.choice(ABC)).toEqual({ account: 'codex-work', model: 'gpt-5.5', effort: 'medium', machine: OWN })
      const kept = fixture.store.get(next.id)!
      expect(kept.pending).toBeNull()
      expect(kept.handover).toContain('- User: Why is the build slow?\n- You: The tests run twice.')
      await fixture.chats.sweep()
      expect(fixture.calls.map(([name]) => name)).toEqual(['stop'])
    } finally {
      await fixture.close()
    }
  })

  it("sends the hand-over with the user's first message, once", async () => {
    const fixture = await setup()
    try {
      const old = await started(fixture)
      const next = await fixture.chats.continueEarly(old, { account: 'global', model: 'sonnet', effort: null })
      const card = await fixture.chats.send(next.id, { text: 'Fix the header', files: [] })
      const [, project, folder, chat, start] = fixture.calls[1]!
      expect([fixture.calls[1]![0], project, folder, chat]).toEqual(['launch', ABC, 'C:\\repos\\example-project', next.id])
      const prompt = (start as { prompt: string }).prompt
      expect(prompt).toContain('- User: Why is the build slow?\n- You: The tests run twice.')
      expect(prompt).toContain('C:\\claude\\projects\\old.jsonl')
      expect(prompt).toContain(`${USER_MESSAGE_HEAD.en}\n\nFix the header`)
      expect(card).toMatchObject({ sessionId: `session-${next.id}`, title: 'Fix the header' })
      expect(fixture.store.get(next.id)?.handover).toBeNull()
      await fixture.chats.send(next.id, { text: 'And the footer', files: [] })
      expect(fixture.calls[2]![0]).toBe('send')
      expect((fixture.calls[2]![3] as { prompt: string }).prompt).not.toContain('The tests run twice')
    } finally {
      await fixture.close()
    }
  })

  it('keeps the hand-over over a failed first launch and over a restart', async () => {
    const fixture = await setup()
    try {
      const old = await started(fixture)
      const next = await fixture.chats.continueEarly(old, { account: 'global', model: null, effort: null })
      fixture.switches.launchFails = true
      await expect(fixture.chats.send(next.id, { text: 'Fix the header', files: [] })).rejects.toMatchObject({ notice: { code: 'chats.noMachine' } })
      fixture.switches.launchFails = false
      const restarted = new ProjectChats(fixture.deps)
      await restarted.send(next.id, { text: 'Fix the header', files: [] })
      expect((fixture.calls.at(-1)![4] as { prompt: string }).prompt).toContain('- You: The tests run twice.')
    } finally {
      await fixture.close()
    }
  })

  it('carries the transcript to another machine at once, while the old one is on the link', async () => {
    const fixture = await setup()
    try {
      const old = await started(fixture)
      fixture.transcripts.set(old, { name: 'old.jsonl', data: Buffer.from('lines') })
      const next = await fixture.chats.continueEarly(old, { account: 'global', model: null, effort: null }, FAR)
      expect(fixture.carried.filter(([, kind]) => kind === 'save')).toEqual([[FAR, 'save', FAR_FOLDER, ['old.jsonl', 'lines']]])
      expect(next.machine).toBe(FAR)
      expect(fixture.store.get(next.id)?.handover).toContain(`${FAR_FOLDER}\\.temp\\inbox\\old.jsonl`)
      fixture.switches.down.add(OWN)
      await fixture.chats.send(next.id, { text: 'Fix the header', files: [] })
      expect(fixture.calls.at(-1)?.slice(0, 3)).toEqual(['launch', ABC, FAR_FOLDER])
    } finally {
      await fixture.close()
    }
  })

  it('refuses a chat with no session, and one whose old session does not stop', async () => {
    const fixture = await setup()
    try {
      const { id } = await fixture.chats.create(ABC, { account: 'global', model: null, effort: null })
      await expect(fixture.chats.continueEarly(id, { account: 'global', model: null, effort: null })).rejects.toMatchObject({ notice: { code: 'chats.noSession' } })
      const old = await started(fixture)
      fixture.switches.stopFails = true
      await expect(fixture.chats.continueEarly(old, { account: 'global', model: null, effort: null })).rejects.toMatchObject({ notice: { code: 'chats.noMachine' } })
      expect(fixture.chats.list(ABC).map((each) => each.id).sort()).toEqual([id, old].sort())
    } finally {
      await fixture.close()
    }
  })

  it('never deletes the new chat waiting with its hand-over: it is archived instead', async () => {
    const fixture = await setup()
    try {
      const old = await started(fixture)
      const next = await fixture.chats.continueEarly(old, { account: 'global', model: null, effort: null })
      await expect(fixture.chats.remove(next.id)).rejects.toMatchObject({ notice: { code: 'chats.hasSession' } })
      await fixture.chats.archive(next.id)
      expect((await fixture.chats.card(next.id)).state).toBe('archived')
    } finally {
      await fixture.close()
    }
  })
})
