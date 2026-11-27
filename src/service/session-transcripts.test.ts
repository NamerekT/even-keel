import { describe, expect, it, vi } from 'vitest'
import type { TranscriptReads } from '../machine/services.js'
import { noticeOf } from '../notice/notice.js'
import { sessionTranscripts } from './session-transcripts.js'

const readsOf = (machine: string): TranscriptReads => ({
  record: vi.fn(async (sessionId: string) => ({ sessionId, machine })),
  feed: vi.fn(async (sessionId: string, after: number) => ({ sessionId, after, machine })),
  image: vi.fn(async () => ({ type: 'image/png', data: machine })),
  inboxFile: vi.fn(async () => ({ type: 'text/plain', data: machine })),
  sharedFile: vi.fn(async () => ({ type: 'text/plain', data: machine })),
  note: vi.fn(async () => machine),
  context: vi.fn(async () => ({ context: machine === 'own' ? null : 120_000, compactAt: null })),
})

describe('the hub reads a transcript on the machine of the session (BTN-1574)', () => {
  const own = readsOf('own')
  const laptop = readsOf('laptop')
  const where: Record<string, string> = { mine: 'own', far: 'laptop', away: 'desk' }
  const chats: Record<string, string> = { mine: 'desk', chatted: 'laptop', 'chatted-away': 'desk' }
  const transcripts = sessionTranscripts({
    own: () => 'own',
    sessionMachine: (sessionId) => where[sessionId],
    chatMachine: async (sessionId) => chats[sessionId],
    ownReads: own,
    elsewhere: (machine) => (machine === 'laptop' ? laptop : undefined),
    nameOf: async (machine) => (machine === 'desk' ? 'Desk' : machine),
  })

  it('reads a session of a machine elsewhere there, and the own machine never looks for it', async () => {
    expect(await transcripts.record('far')).toEqual({ sessionId: 'far', machine: 'laptop' })
    expect(await transcripts.feed('far', 3)).toEqual({ sessionId: 'far', after: 3, machine: 'laptop' })
    expect(await transcripts.image('far', 'tool-1', 0)).toEqual({ type: 'image/png', data: 'laptop' })
    expect(await transcripts.inboxFile('far', 'shot.png')).toEqual({ type: 'text/plain', data: 'laptop' })
    expect(await transcripts.sharedFile('far', 'tool-2', 1)).toEqual({ type: 'text/plain', data: 'laptop' })
    expect(await transcripts.note('far')).toBe('laptop')
    expect(await transcripts.context('far')).toEqual({ context: 120_000, compactAt: null })
    for (const read of Object.values(own)) expect(read).not.toHaveBeenCalled()
    expect(laptop.image).toHaveBeenCalledWith('far', 'tool-1', 0)
    expect(laptop.sharedFile).toHaveBeenCalledWith('far', 'tool-2', 1)
  })

  it("reads the own machine's sessions and the unknown ones on the own machine", async () => {
    expect(await transcripts.record('mine')).toEqual({ sessionId: 'mine', machine: 'own' })
    expect(await transcripts.feed('nobody', 0)).toEqual({ sessionId: 'nobody', after: 0, machine: 'own' })
  })

  it('answers that the machine is off the link, naming it, instead of "not found"', async () => {
    const failed = await transcripts.record('away').then(() => undefined, (error: unknown) => noticeOf(error))
    expect(failed).toEqual({ code: 'machines.transcriptOffline', params: { name: 'Desk' } })
    await expect(transcripts.context('away')).rejects.toThrow()
  })

  it("reads a session no mirror holds on its chat's machine, archived or after that machine's restart (BTN-1794)", async () => {
    vi.mocked(own.feed).mockClear()
    expect(await transcripts.feed('chatted', 0)).toEqual({ sessionId: 'chatted', after: 0, machine: 'laptop' })
    expect(own.feed).not.toHaveBeenCalled()
    const failed = await transcripts.record('chatted-away').then(() => undefined, (error: unknown) => noticeOf(error))
    expect(failed).toEqual({ code: 'machines.transcriptOffline', params: { name: 'Desk' } })
  })

  it("lets a mirror's holder outrank the chat's machine", async () => {
    expect(await transcripts.record('mine')).toEqual({ sessionId: 'mine', machine: 'own' })
  })
})
