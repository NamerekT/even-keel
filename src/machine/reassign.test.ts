import { describe, expect, it } from 'vitest'
import { PROMPTS } from '../chain/prompts.js'
import { movedText, reassignable, type ReassignFacts } from './reassign.js'

const facts = (overrides: Partial<ReassignFacts> = {}): ReassignFacts => ({
  task: 'ABC-2',
  holder: 'laptop',
  own: 'pc',
  connected: false,
  holderName: 'Laptop',
  branch: 'abc-2/task',
  remote: 'origin',
  pushed: true,
  ...overrides,
})

describe('reassignable', () => {
  it('lets a task move off a machine gone once its branch is on the remote', () => {
    expect(reassignable(facts())).toBeNull()
  })

  it('moves nothing the own machine holds or no machine holds', () => {
    expect(reassignable(facts({ holder: 'pc' }))?.code).toBe('reassign.notHeld')
    expect(reassignable(facts({ holder: undefined }))?.code).toBe('reassign.notHeld')
  })

  it('leaves a task with its machine while that one is connected', () => {
    expect(reassignable(facts({ connected: true }))).toEqual({ code: 'reassign.machineOnline', params: { task: 'ABC-2', machine: 'Laptop' } })
  })

  it('refuses without a remote, without the branch on it, or when the remote does not answer', () => {
    expect(reassignable(facts({ remote: null }))?.code).toBe('reassign.noRemote')
    expect(reassignable(facts({ pushed: false }))).toEqual({ code: 'reassign.notPushed', params: { task: 'ABC-2', branch: 'abc-2/task', machine: 'Laptop' } })
    expect(reassignable(facts({ pushed: { error: 'timed out' } }))?.code).toBe('reassign.remoteUnknown')
  })
})

describe('movedText', () => {
  it('names the machine and the branch, then the kept note', () => {
    const text = movedText(PROMPTS.en, 'Laptop', 'abc-2/task', 'Done: the parser.\nNext: npm test\n')
    expect(text).toContain('moved here from machine Laptop')
    expect(text).toContain('abc-2/task')
    expect(text.endsWith(`${PROMPTS.en.noteText}\n\nDone: the parser.\nNext: npm test\n`)).toBe(true)
  })

  it('goes without a note when the hub keeps none', () => {
    expect(movedText(PROMPTS.ru, 'Laptop', 'abc-2/task', null)).not.toContain(PROMPTS.ru.noteText)
  })
})
