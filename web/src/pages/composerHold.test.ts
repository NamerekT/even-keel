import { describe, expect, it } from 'vitest'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import { answeredAsks, holdKey, sendAhead, shownAsk, type HeldSession } from './composerHold.js'

const ASK = { id: 'toolu_1', questions: [] }

const session = (extra: Partial<HeldSession> = {}): HeldSession => ({
  sessionId: 's1',
  lamp: 'waiting',
  ask: null,
  lastActivityAt: '2026-10-19T10:00:00.000Z',
  ...extra,
})

describe('holdKey', () => {
  it('changes when a turn ended between two updates and the lamp stayed waiting', () => {
    expect(holdKey(session({ lastActivityAt: '2026-10-19T10:00:30.000Z' }))).not.toBe(holdKey(session()))
  })

  it('changes with the lamp and with a new question', () => {
    expect(holdKey(session({ lamp: 'working' }))).not.toBe(holdKey(session()))
    expect(holdKey(session({ ask: ASK }))).not.toBe(holdKey(session()))
  })

  it('stays while nothing of the session moved', () => {
    expect(holdKey(session({ ask: ASK }))).toBe(holdKey(session({ ask: { ...ASK } })))
  })
})

describe('shownAsk', () => {
  it('gives the open question', () => {
    expect(shownAsk(ASK, new Set())).toBe(ASK)
    expect(shownAsk(ASK, new Set(['toolu_0']))).toBe(ASK)
  })

  it('never gives the question already answered, which the job file may still hold', () => {
    expect(shownAsk(ASK, new Set(['toolu_1']))).toBeNull()
  })

  it('gives nothing without a question', () => {
    expect(shownAsk(null, new Set(['toolu_1']))).toBeNull()
  })
})

describe('answeredAsks', () => {
  const line = (extra: Partial<FeedLine>): FeedLine => ({ at: '2026-11-09T12:46:45.000Z', kind: 'text', text: '', ...extra })

  it('takes the questions the feed holds answers to, from the transcript and from a reply sent from the page', () => {
    const feed = [line({ kind: 'answer', answers: { ask: 'toolu_1', answers: {} } }), line({ kind: 'prompt', text: 'hi' }), line({ kind: 'answer', answers: { answers: { Q: 'A' } } })]
    expect([...answeredAsks(feed)]).toEqual(['toolu_1'])
  })

  // The composer keeps no memory of it: a chat built anew over the same feed hides the question just the same.
  it('hides a question answered in the feed whatever view of the session comes late', () => {
    const feed = [line({ kind: 'answer', answers: { ask: 'toolu_1', answers: {} } })]
    expect(shownAsk(ASK, answeredAsks(feed))).toBeNull()
    expect(shownAsk(ASK, answeredAsks([]))).toBe(ASK)
  })
})

describe('sendAhead', () => {
  it('shows the reply before the server answers and keeps it when the server takes it', async () => {
    const order: string[] = []
    let resolve: (ok: boolean) => void = () => {}
    const done = sendAhead(
      () => {
        order.push('shown')
        return () => order.push('retracted')
      },
      () => {
        order.push('sent')
        return new Promise<boolean>((ok) => (resolve = ok))
      },
    )
    expect(order).toEqual(['shown', 'sent'])
    resolve(true)
    expect(await done).toBe(true)
    expect(order).toEqual(['shown', 'sent'])
  })

  it('takes the reply back when the server refuses it, so the question returns', async () => {
    const order: string[] = []
    const ok = await sendAhead(
      () => () => order.push('retracted'),
      async () => false,
    )
    expect(ok).toBe(false)
    expect(order).toEqual(['retracted'])
  })
})
