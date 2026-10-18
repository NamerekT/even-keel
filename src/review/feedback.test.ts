import { describe, expect, it } from 'vitest'
import { feedbackText, withFeedback } from './feedback.js'

const URL = 'https://git.example.com/acme/app/pulls/12'

describe('feedbackText', () => {
  it('lists the review with its comments, the failed run and the conflict', () => {
    const text = feedbackText(
      URL,
      [
        { kind: 'changes', request: { id: '1', author: 'jdoe', body: 'Rename the field.', at: '', comments: [{ path: 'src/a.ts', line: 4, body: 'Here.\nAnd below.' }] } },
        { kind: 'ci', run: { id: 9, number: 9, title: 'Tests', workflow: 'test.yml', commit: 'a1', status: 'failure', createdAt: '', startedAt: null, stoppedAt: null, url: 'https://ci/9' } },
        { kind: 'conflict', head: 'a1' },
      ],
      'en',
      'trunk',
    )
    expect(text).toBe(
      [
        `The pull request ${URL} got feedback:`,
        '- A review by jdoe asks for changes:',
        '  Rename the field.',
        '  - src/a.ts:4:',
        '    Here.',
        '    And below.',
        '- The CI failed: Tests — https://ci/9',
        '- The pull request conflicts with trunk: merge the fresh trunk into your branch and resolve the conflicts.',
      ].join('\n'),
    )
  })

  it('does not fail on a review of a deleted user without words', () => {
    const text = feedbackText(URL, [{ kind: 'changes', request: { id: '1', author: '', body: '', at: '', comments: [] } }], 'ru', 'main')
    expect(text).toBe(`На pull request ${URL} пришли замечания:\n- Ревью ? просит правок:`)
  })
})

describe('withFeedback', () => {
  it('ends with what to do once, however many polls it gathers', () => {
    const first = withFeedback(undefined, 'A', 'en')
    expect(first).toMatch(/^A\n\nFix it, commit/)
    const both = withFeedback(first, 'B', 'en')
    expect(both.startsWith('A\n\nB\n\nFix it, commit')).toBe(true)
    expect(both.match(/Fix it/g)).toHaveLength(1)
  })
})
