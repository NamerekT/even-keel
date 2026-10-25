import { describe, expect, it } from 'vitest'
import { notice } from '../../../src/notice/notice.js'
import type { ForwardView } from '../../../src/state.js'
import { forwardTone, warningTasks } from './noticeGroups.js'
import { projectNoticesEn } from '../i18n/project-notices-en.js'
import { projectNoticesRu } from '../i18n/project-notices-ru.js'

const forward: ForwardView = { into: 'ABC', behind: 2, held: false, hold: null }

describe('project notices', () => {
  it('counts one cleanup warning per task and excludes tasks shown in chain rows', () => {
    const leftovers = ['ABC-1', 'ABC-2', 'ABC-1', 'ABC-3'].map((task) => ({ task, at: '', notice: notice('cleanup.branchKept', { branch: 'task' }) }))
    expect(warningTasks(leftovers, ['ABC-2'])).toEqual(['ABC-1', 'ABC-3'])
    expect(warningTasks([], [])).toEqual([])
  })

  it('keeps held carries visible as errors and classifies agent work as a note', () => {
    expect(forwardTone(undefined)).toBeNull()
    expect(forwardTone({ ...forward, behind: 0 })).toBeNull()
    expect(forwardTone(forward)).toBe('warn')
    expect(forwardTone({ ...forward, held: true })).toBe('error')
    expect(forwardTone({ ...forward, held: true, agent: 'XYZ-CARRY' })).toBe('note')
    expect(forwardTone({ ...forward, behind: 0, last: { at: '', commits: 1, push: notice('cleanup.branchKept', { branch: 'release' }) } })).toBe('warn')
    expect(forwardTone({ ...forward, behind: 0, held: true, last: { at: '', commits: 1, push: notice('cleanup.branchKept', { branch: 'release' }) } })).toBe('warn')
  })

  it('declines the warning count in Russian and English', () => {
    expect([1, 2, 5, 11, 21, 22, 25].map(projectNoticesRu.warnings)).toEqual([
      '1 предупреждение', '2 предупреждения', '5 предупреждений', '11 предупреждений',
      '21 предупреждение', '22 предупреждения', '25 предупреждений',
    ])
    expect(projectNoticesEn.warnings(1)).toBe('1 warning')
    expect(projectNoticesEn.warnings(2)).toBe('2 warnings')
  })
})
