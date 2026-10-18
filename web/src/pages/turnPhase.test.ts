import { describe, expect, it } from 'vitest'
import { turnPhase, type TurnFacts } from './turnPhase.js'

const second = (value: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, value)).toISOString()
const at = (value: number) => Date.parse(second(value))

const facts = (extra: Partial<TurnFacts> = {}): TurnFacts => ({
  working: true,
  turn: { startedAt: second(0), tool: null },
  lastReplyAt: second(0),
  answers: [],
  delivering: false,
  ...extra,
})

describe('turnPhase', () => {
  it('shows nothing for a session that is not working', () => {
    expect(turnPhase(facts({ working: false }), at(10))).toBeNull()
  })

  it('shows nothing without a turn and without an answer', () => {
    expect(turnPhase(facts({ turn: null, lastReplyAt: null }), at(10))).toBeNull()
  })

  it('thinks from the prompt of a turn nobody answered into', () => {
    expect(turnPhase(facts(), at(10))).toEqual({ kind: 'thinking', since: second(0) })
  })

  it('names the tool that runs', () => {
    expect(turnPhase(facts({ turn: { startedAt: second(0), tool: 'Bash npm test' } }), at(10))).toEqual({ kind: 'running', tool: 'Bash npm test', since: second(0) })
  })

  it('has no clock for a turn without a time', () => {
    expect(turnPhase(facts({ turn: { startedAt: '', tool: null } }), at(10))).toEqual({ kind: 'thinking', since: null })
  })

  it('delivers an answer sent after the last turn began, counting from the send', () => {
    expect(turnPhase(facts({ answers: [second(36)] }), at(40))).toEqual({ kind: 'delivering', since: second(36) })
  })

  it('does not show the tool of the turn before the answer', () => {
    expect(turnPhase(facts({ turn: { startedAt: second(0), tool: 'AskUserQuestion Which one?' }, answers: [second(36)] }), at(40))).toEqual({
      kind: 'delivering',
      since: second(36),
    })
  })

  it('delivers while the service says so, even once the transcript moved on', () => {
    expect(turnPhase(facts({ answers: [second(36)], delivering: true, turn: { startedAt: second(44), tool: null } }), at(45))).toEqual({
      kind: 'delivering',
      since: second(36),
    })
  })

  it('delivers to a session with no turn yet', () => {
    expect(turnPhase(facts({ turn: null, lastReplyAt: null, answers: [second(36)] }), at(40))).toEqual({ kind: 'delivering', since: second(36) })
  })

  it('counts from the first of the moments one answer is known by', () => {
    expect(turnPhase(facts({ answers: [second(37), second(36)] }), at(40))).toEqual({ kind: 'delivering', since: second(36) })
  })

  it('thinks once the prompt of the answer is in the transcript, the clock running on from the send', () => {
    const turn = { startedAt: second(45), tool: null }
    expect(turnPhase(facts({ turn, lastReplyAt: second(45), answers: [second(36)] }), at(50))).toEqual({ kind: 'thinking', since: second(36) })
  })

  it('runs a tool of the answered turn with the clock from the send', () => {
    const turn = { startedAt: second(45), tool: 'Read a.ts' }
    expect(turnPhase(facts({ turn, lastReplyAt: second(45), answers: [second(36)] }), at(50))).toEqual({ kind: 'running', tool: 'Read a.ts', since: second(36) })
  })

  it('goes on with the asking turn once the answer to its question is in the transcript', () => {
    expect(turnPhase(facts({ lastReplyAt: second(44), answers: [second(36)] }), at(50))).toEqual({ kind: 'thinking', since: second(36) })
  })

  it('stops delivering an answer that never showed after three minutes', () => {
    expect(turnPhase(facts({ answers: [second(0)], turn: { startedAt: second(-60), tool: null } }), at(181))).toEqual({ kind: 'thinking', since: second(0) })
  })

  it('counts a later turn from its own prompt', () => {
    const turn = { startedAt: second(600), tool: null }
    expect(turnPhase(facts({ turn, lastReplyAt: second(600), answers: [second(36)] }), at(610))).toEqual({ kind: 'thinking', since: second(600) })
  })

  it('skips a moment that is not a time', () => {
    expect(turnPhase(facts({ answers: [''] }), at(10))).toEqual({ kind: 'thinking', since: second(0) })
  })
})
