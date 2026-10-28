import { describe, expect, it } from 'vitest'
import { changedLabels } from './labels.js'

describe('label changes', () => {
  it('removes before adding, ignores case and blanks, and keeps the first spelling', () => {
    expect(changedLabels(['Bug', 'BUG', 'old'], { remove: [' OLD ', 'bug'], add: [' bug ', 'New', 'NEW', ''] })).toEqual(['bug', 'New'])
    expect(changedLabels(['Bug'], { remove: [], add: ['BUG'] })).toEqual(['Bug'])
  })
})
