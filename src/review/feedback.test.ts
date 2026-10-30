import { describe, expect, it } from 'vitest'
import { closedText, feedbackText, withFeedback } from './feedback.js'
import type { Feedback, Remark } from './model.js'

const URL = 'https://git.example.com/acme/app/pulls/12'
const RUN = { id: 9, number: 9, title: 'Tests', workflow: 'test.yml', commit: 'a1', status: 'failure', createdAt: '', startedAt: null, stoppedAt: null, url: 'https://ci/9' } as const

const remark = (change: Partial<Remark> = {}): Feedback => ({
  kind: 'remark',
  remark: { key: 'review:1', kind: 'changes', author: 'jdoe', body: '', at: '', comments: [], ...change },
})

describe('feedbackText', () => {
  it('lists the review with its comments, the failed run and the conflict', () => {
    const text = feedbackText(
      URL,
      [
        remark({ kind: 'changes', body: 'Rename the field.', comments: [{ path: 'src/a.ts', line: 4, body: 'Here.\nAnd below.' }] }),
        remark({ key: 'review:2', kind: 'review', body: 'Odd name.' }),
        remark({ key: 'comment:3', kind: 'comment', body: 'Make another file too.' }),
        { kind: 'ci', run: RUN, log: null },
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
        '- A review by jdoe comments:',
        '  Odd name.',
        '- A comment by jdoe:',
        '  Make another file too.',
        '- The CI failed: Tests — https://ci/9',
        '- The pull request conflicts with trunk: merge the fresh trunk into your branch and resolve the conflicts.',
      ].join('\n'),
    )
  })

  it('gives the log tail of the failed job under its run', () => {
    const text = feedbackText(URL, [{ kind: 'ci', run: RUN, log: "src/a.ts(4,1): error TS2741\nJob 'test' failed" }], 'en', 'main')
    expect(text).toBe(
      [
        `The pull request ${URL} got feedback:`,
        '- The CI failed: Tests — https://ci/9',
        '  ```text',
        '  src/a.ts(4,1): error TS2741',
        "  Job 'test' failed",
        '  ```',
      ].join('\n'),
    )
  })

  it('does not fail on a review of a deleted user without words', () => {
    const text = feedbackText(URL, [remark({ author: '' })], 'ru', 'main')
    expect(text).toBe(`На pull request ${URL} пришли замечания:\n- Ревью ? просит правок:`)
  })
})

describe('closedText', () => {
  it('gives the link, every remark and what to do', () => {
    const text = closedText(URL, [{ key: 'comment:3', kind: 'comment', author: 'jdoe', body: 'Not needed, see #9.', at: '', comments: [] }], 'en', 'trunk')
    expect(text).toBe(
      [
        `The previous pull request of this task, ${URL}, was closed without a merge. The remarks on it:`,
        '- A comment by jdoe:',
        '  Not needed, see #9.',
        '',
        'Its branch is removed: you do the task over, on a fresh branch from trunk. Take the remarks into account — they may say why the pull request was closed and what to do differently.',
      ].join('\n'),
    )
  })

  it('says there were no remarks', () => {
    expect(closedText(URL, [], 'ru', 'main')).toContain('- (замечаний нет)')
  })

  it('keeps the latest remarks of many and counts the earlier ones', () => {
    const many = Array.from({ length: 23 }, (_, index) => ({ key: `comment:${index}`, kind: 'comment' as const, author: 'jdoe', body: `Remark ${index}.`, at: '', comments: [] }))
    const text = closedText(URL, many, 'en', 'main')
    expect(text).toContain('earlier remarks not shown: 3')
    expect(text).not.toContain('Remark 2.')
    expect(text).toContain('Remark 3.')
    expect(text).toContain('Remark 22.')
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
