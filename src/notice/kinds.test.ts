import { describe, expect, it } from 'vitest'
import { DISMISSED_LIMIT, isNoticeKind, noticeShown, PROJECT_KINDS, withDismissed } from './kinds.js'

describe('noticeShown', () => {
  it('shows a kind by default, takes Even Keel\'s value, and the project\'s own over it', () => {
    expect(noticeShown('protection.remote', {})).toBe(true)
    expect(noticeShown('protection.remote', { 'protection.remote': false })).toBe(false)
    expect(noticeShown('protection.remote', { 'protection.remote': false }, { 'protection.remote': true })).toBe(true)
    expect(noticeShown('protection.remote', {}, { 'protection.remote': false })).toBe(false)
  })
})

describe('kinds', () => {
  it('know the warnings only, and a project holds only the kinds of its own banners', () => {
    expect(isNoticeKind('cli.versions')).toBe(true)
    expect(isNoticeKind('chain.paused')).toBe(false)
    expect(isNoticeKind('toString')).toBe(false)
    expect(PROJECT_KINDS).toEqual(['protection.noRules', 'protection.remote', 'branch.drift'])
  })
})

describe('withDismissed', () => {
  it('replaces a mark closed again and moves it to the end', () => {
    expect(Object.entries(withDismissed({ a: '1', b: '1' }, { a: '2' }))).toEqual([['b', '1'], ['a', '2']])
  })

  it('drops the oldest marks over the limit', () => {
    const many = Object.fromEntries(Array.from({ length: DISMISSED_LIMIT }, (_, index) => [`mark-${index}`, 'x']))
    const next = withDismissed(many, { fresh: 'y' })
    expect(Object.keys(next)).toHaveLength(DISMISSED_LIMIT)
    expect(next['mark-0']).toBeUndefined()
    expect(next.fresh).toBe('y')
  })
})
