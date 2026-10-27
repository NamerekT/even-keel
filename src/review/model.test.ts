import { expect, it } from 'vitest'
import { othersOnly, SESSION_MARK, type Remark } from './model.js'

const remark = (key: string, body: string, comments: string[] = [], kind: Remark['kind'] = 'review'): Remark => ({
  key, kind, author: 'jdoe', body, at: '2026-10-25T10:00:00Z', comments: comments.map((text) => ({ path: 'src/a.ts', line: 3, body: text })),
})

it("leaves out what the session wrote into its own pull request, by the mark in its text (BTN-442)", () => {
  const remarks = [
    remark('comment:1', `The red pipeline is expected here.\n\n${SESSION_MARK}`, [], 'comment'),
    remark('comment:2', 'Rename it', [], 'comment'),
    remark('review:3', '', [`Why this line?\n${SESSION_MARK}`, 'Use a const']),
    remark('review:4', '', [`${SESSION_MARK} Done`]),
    remark('review:5', 'Looks off', [`${SESSION_MARK} Done`]),
    remark('review:6', '', [`${SESSION_MARK} Done`], 'changes'),
  ]
  expect(othersOnly(remarks)).toEqual([
    remarks[1],
    { ...remarks[2], comments: [remarks[2].comments[1]] },
    { ...remarks[4], comments: [] },
    { ...remarks[5], comments: [] },
  ])
})
