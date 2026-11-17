import { describe, expect, it } from 'vitest'
import type { AskQuestion } from '../../../src/sessions/ask.js'
import { NO_PICK, chooseLabel, pickAnswer, shownPreview, toggleOther, typeOther } from './askPick.js'

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

describe('the preview column (EKR-139)', () => {
  const option = (label: string, preview?: string) => ({ label, description: '', ...(preview === undefined ? {} : { preview }) })
  const partly = { ...single, options: [option('A', 'code A'), option('B'), option('C', 'code C')] } as AskQuestion

  it('has no column when no option has a preview', () => {
    const plain = { ...single, options: [option('A'), option('B')] } as AskQuestion
    expect(shownPreview(plain, 'A', [])).toBeUndefined()
    expect(shownPreview(plain, null, [])).toBeUndefined()
  })

  it('keeps the column while the pointer is on an option without a preview', () => {
    expect(shownPreview(partly, 'B', [])).toBeNull()
    expect(shownPreview(partly, null, ['B'])).toBeNull()
  })

  it('shows the pointed option, then the picked one, then the first with a preview', () => {
    expect(shownPreview(partly, 'C', ['A'])).toBe('code C')
    expect(shownPreview(partly, null, ['C'])).toBe('code C')
    expect(shownPreview(partly, null, [])).toBe('code A')
  })
})
