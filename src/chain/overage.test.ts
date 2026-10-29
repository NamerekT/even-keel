import { describe, expect, it } from 'vitest'
import { pause, setup, task } from './dispatcher.fixture.js'
import type { LimitedSession } from './relay.js'

const at = '2026-09-26T12:00:00.000Z'
const session: LimitedSession = {
  sessionId: 'session-1', agentId: 'agent-1', account: 'global', cwd: 'D:/work/abc',
  workdir: 'D:/work/abc/.claude/worktrees/abc-1', branch: 'abc-1/task', transcript: 'D:/fake/session.jsonl',
  lastReplyAt: '2026-09-26T11:59:00.000Z', recent: [], lastMessage: 'Keep the parser change', checkpoint: '.temp/handoff.md',
  limit: { at, text: 'Included subscription allowance exhausted; paid usage detected' },
}
async function running(reset: string | null = '2026-09-26T12:30:00.000Z') {
  const evidence = { current: undefined as LimitedSession | undefined, reset }
  const c = setup({ busy: new Set(['ABC-1']), overage: (id) => id === 'ABC-1' ? evidence.current : undefined,
    limitResetAfter: () => evidence.reset })
  c.dispatcher.setTasks('ABC', [task('ABC-1')])
  await c.dispatcher.start('ABC')
  await c.dispatcher.idle()
  c.handoffs['ABC-1'] = session
  evidence.current = session
  return { ...c, evidence }
}
async function check(c: ReturnType<typeof setup>) {
  c.dispatcher.check()
  await c.dispatcher.idle()
}

describe('chain overage stop', () => {
  it('stops once mid-turn, preserves context and waits even after the source disappears', async () => {
    const c = await running()
    await check(c)
    expect(c.stopped).toEqual(['session-1'])
    expect(c.relays).toEqual([])
    expect(c.dispatcher.state.active[0]?.current?.limit).toMatchObject({ at, resetsAt: c.evidence.reset, acted: null })
    await check(c)
    c.evidence.current = undefined
    c.busy.clear()
    await check(c)
    expect(c.stopped).toEqual(['session-1'])
    expect(c.relays).toEqual([])
    expect(c.dispatcher.state.active[0]?.current?.limit).toBeDefined()
  })

  it('resumes with a warm cache after reset and does not consume the same evidence again', async () => {
    const c = await running()
    await check(c)
    c.clock.now = new Date('2026-09-26T12:31:00Z')
    await check(c)
    await check(c)
    expect(c.relays.map((r) => r.kind)).toEqual(['resume'])
    expect(c.relays[0]?.stopped).toBe(true)
    expect(c.stopped).toHaveLength(1)
  })

  it('hands over to another account with the original worktree, branch and note', async () => {
    const c = await running(null)
    await check(c)
    c.evidence.current = undefined
    c.busy.clear()
    c.account.id = 'other@example.com'
    await check(c)
    expect(c.relays).toEqual([expect.objectContaining({ kind: 'relay', workdir: session.workdir, reason: 'limit' })])
    expect(c.relays[0]?.prompt).toContain(session.branch)
    expect(c.relays[0]?.prompt).toContain('.temp/handoff.md')
  })

  it('retains the wait and handoff across a service restart even without a monitored session', async () => {
    const c = await running('2026-09-26T15:00:00.000Z')
    await check(c)
    const restored = setup({ state: structuredClone(c.dispatcher.state), limitReset: c.evidence.reset })
    restored.dispatcher.setTasks('ABC', [task('ABC-1')])
    await restored.dispatcher.idle()
    expect(restored.relays).toEqual([])
    restored.clock.now = new Date('2026-09-26T15:01:00Z')
    await check(restored)
    expect(restored.stopped).toEqual([])
    expect(restored.relays[0]).toMatchObject({ kind: 'relay', workdir: session.workdir, stopped: true })
  })

  it('keeps an unknown reset unknown until the normal provider mechanism learns it', async () => {
    const c = await running(null)
    await check(c)
    c.evidence.current = undefined
    c.busy.clear()
    c.clock.now = new Date('2026-09-26T14:00:00Z')
    await check(c)
    expect(c.relays).toEqual([])
    expect(c.dispatcher.state.active[0]?.current?.limit?.resetsAt).toBeNull()
    c.evidence.reset = '2026-09-26T15:00:00.000Z'
    await check(c)
    c.clock.now = new Date('2026-09-26T15:01:00Z')
    await check(c)
    expect(c.relays[0]?.kind).toBe('relay')
  })

  it('restores normal unattended handling once the paid hold has been resumed', async () => {
    const c = await running()
    await check(c)
    c.clock.now = new Date('2026-09-26T12:31:00Z')
    await check(c)
    c.evidence.current = undefined
    c.busy.clear()
    c.handoffs['ABC-1'] = { ...session, checkpoint: null }
    c.clock.now = new Date('2026-09-26T12:51:00Z')
    c.dispatcher.setUnattended(true)
    await c.dispatcher.idle()
    expect(c.dispatcher.state.released).toEqual({ ABC: ['ABC-1'] })
  })

  it('guards paused chains too, but never stops a session other than the chain current', async () => {
    const c = await running()
    pause(c.dispatcher, 'ABC')
    await c.dispatcher.idle()
    expect(c.stopped).toEqual(['session-1'])
    const other = await running()
    other.evidence.current = { ...session, sessionId: 'external-session' }
    await check(other)
    expect(other.stopped).toEqual([])
  })

  it('pauses on a failed stop without starting a replacement', async () => {
    const c = setup({ failStop: true, busy: new Set(['ABC-1']), overage: () => session })
    c.dispatcher.setTasks('ABC', [task('ABC-1')])
    await c.dispatcher.start('ABC')
    await c.dispatcher.idle()
    await check(c)
    expect(c.dispatcher.state.active[0]?.paused).toBe(true)
    expect(c.relays).toEqual([])
  })

  it('keeps an in-flight move intact until recovery settles it', async () => {
    const c = await running()
    const current = c.dispatcher.state.active[0]!.current!
    current.starting = at
    current.move = 'relay'
    await check(c)
    expect(c.stopped).toEqual([])
  })

  it('waits when a newly selected account still shares an exhausted pool', async () => {
    const c = await running(null)
    await check(c)
    c.busy.clear()
    c.account.id = 'other@example.com'
    const restored = setup({ state: structuredClone(c.dispatcher.state), account: c.account, limitReset: '2026-09-26T15:00:00.000Z' })
    restored.dispatcher.setTasks('ABC', [task('ABC-1')])
    await restored.dispatcher.idle()
    expect(restored.relays).toEqual([])
    restored.clock.now = new Date('2026-09-26T15:01:00Z')
    await check(restored)
    expect(restored.relays[0]?.kind).toBe('relay')
  })

  it('recovers an interrupted cold handoff from its retained snapshot alone', async () => {
    const c = await running()
    await check(c)
    const state = structuredClone(c.dispatcher.state)
    const current = state.active[0]!.current!
    current.starting = '2026-09-26T15:01:00.000Z'
    current.move = 'relay'
    current.limit!.acted = 'relay'
    const restored = setup({ state })
    restored.clock.now = new Date('2026-09-26T15:02:00Z')
    restored.dispatcher.setTasks('ABC', [task('ABC-1')])
    await restored.dispatcher.idle()
    expect(restored.relays[0]).toMatchObject({ kind: 'relay', workdir: session.workdir })
  })
})
