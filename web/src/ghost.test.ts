import { describe, expect, it } from 'vitest'
import { fakeTask } from '../../src/tracker/fixture.js'
import type { EvenKeelState } from '../../src/state.js'
import { ghostOf } from './state.js'

describe('ghostOf', () => {
  it.each([true, false])('groups a preview by its filled milestone when provided (%s)', (filled) => {
    const milestone = { label: 'v0.2', targetDate: null }
    const state = {
      tasks: [fakeTask('ABC-2')],
      chain: { projects: { ABC: { landing: { 'ABC-2': 'ABC-1' }, ...(filled && { landingMilestones: { 'ABC-2': milestone } }) } } },
    } as unknown as EvenKeelState
    expect(ghostOf(state, 'ABC', 'ABC-2')).toEqual({ id: 'ABC-2', title: 'ABC-2', before: 'ABC-1', milestone: filled ? 'v0.2' : null })
  })
})
