import { describe, expect, it } from 'vitest'
import { runLabelView } from './runLabel.js'

describe('runLabelView', () => {
  it.each([
    ['OpenCode | opencode/deepseek-v4.1-flash-free', { provider: 'OpenCode', model: 'deepseek-v4.1-flash-free' }],
    ['OpenCode | router/vendor/deepseek-v4-pro', { provider: 'OpenCode', model: 'deepseek-v4-pro' }],
    ['Codex | gpt-6.1-terra', { provider: 'Codex', model: 'gpt-6.1-terra' }],
    ['Claude | opus', { provider: 'Claude', model: 'opus' }],
    ['OpenCode', { provider: 'OpenCode', model: null }],
    ['cOdEx | gpt-6.1-sol', { provider: 'cOdEx', model: 'gpt-6.1-sol' }],
    ['Bug', null],
  ])('displays %s without changing provider case or the model suffix', (label, expected) => {
    expect(runLabelView(label)).toEqual(expected)
  })
})
