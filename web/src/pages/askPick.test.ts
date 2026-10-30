import { describe, expect, it } from 'vitest'
import type { AskQuestion } from '../../../src/sessions/ask.js'
import { NO_PICK, chooseLabel, pickAnswer, toggleOther, typeOther } from './askPick.js'

const single = { question: 'Q', header: 'Q', multiSelect: false, options: [] } as unknown as AskQuestion
const multi = { ...single, multiSelect: true } as AskQuestion

describe('the Other pick', () => {
  it('keeps the Other text when another option is picked and Other is chosen again (radio)', () => {
    let pick = toggleOther(single, NO_PICK, true)
    pick = typeOther(pick, 'my own')
    pick = chooseLabel(single, pick, 'A', true)
    expect(pickAnswer(single, pick)).toBe('A')
    pick = toggleOther(single, pick, true)
    expect(pick.other).toBe('my own')
    expect(pickAnswer(single, pick)).toBe('my own')
  })

  it('sends the Other text only while Other is on (checkbox)', () => {
    let pick = chooseLabel(multi, NO_PICK, 'A', true)
    pick = toggleOther(multi, pick, true)
    pick = typeOther(pick, 'extra')
    expect(pickAnswer(multi, pick)).toBe('A, extra')
    pick = toggleOther(multi, pick, false)
    expect(pickAnswer(multi, pick)).toBe('A')
    expect(pick.other).toBe('extra')
    expect(pickAnswer(multi, toggleOther(multi, pick, true))).toBe('A, extra')
  })

  it('an empty Other sends nothing', () => {
    expect(pickAnswer(single, toggleOther(single, NO_PICK, true))).toBe('')
  })
})
