import { describe, expect, it } from 'vitest'
import { type LastRun, type RunFile, lastRunReport, lastRunTail } from './vitest-last-run.js'

const REPORT = '.temp/vitest-last.json'

function file(path: string, tests: RunFile['tests'], errors: RunFile['errors'] = []): RunFile {
  return { file: path, errors, tests }
}

const passed = (name: string) => ({ name, state: 'passed' as const, errors: [] })
const failed = (name: string, message = 'expected 1 to be 2') => ({ name, state: 'failed' as const, errors: [{ message, stack: `Error: ${message}\n    at x.test.ts:3:5` }] })

describe('lastRunTail', () => {
  it('is one line on a green run', () => {
    const run: LastRun = { reason: 'passed', files: [file('src/a.test.ts', [passed('one'), passed('two'), { name: 'three', state: 'skipped', errors: [] }])], unhandled: [] }
    expect(lastRunTail(run, REPORT)).toEqual(['vitest: passed — 2 passed, 1 skipped of 3 tests in 1 file; report .temp/vitest-last.json'])
  })

  it('names each failed test as file > name and ends on the verdict', () => {
    const run: LastRun = {
      reason: 'failed',
      files: [
        file('src/a.test.ts', [passed('one'), failed('suite > two')]),
        file('src/b.test.ts', [failed('three')]),
      ],
      unhandled: [],
    }
    expect(lastRunTail(run, REPORT)).toEqual([
      'FAIL src/a.test.ts > suite > two',
      'FAIL src/b.test.ts > three',
      'vitest: FAILED — 2 failed, 1 passed of 3 tests in 2 files; report .temp/vitest-last.json',
    ])
  })

  it('names a file that failed outside its tests, and an unhandled error', () => {
    const run: LastRun = {
      reason: 'failed',
      files: [file('src/c.test.ts', [], [{ message: 'Cannot find module ./gone\nmore' }])],
      unhandled: [{ name: 'TypeError', message: 'x is undefined' }],
    }
    expect(lastRunTail(run, REPORT)).toEqual([
      'FAIL src/c.test.ts: Cannot find module ./gone',
      'ERROR unhandled TypeError: x is undefined',
      'vitest: FAILED — 0 of 0 tests in 1 file, 1 file failed outside its tests, 1 unhandled error; report .temp/vitest-last.json',
    ])
  })

  it('keeps to twenty lines however many failed', () => {
    const tests = Array.from({ length: 40 }, (_, i) => failed(`t${i}`))
    const tail = lastRunTail({ reason: 'failed', files: [file('src/a.test.ts', tests)], unhandled: [] }, REPORT)
    expect(tail).toHaveLength(20)
    expect(tail[17]).toBe('FAIL src/a.test.ts > t17')
    expect(tail[18]).toBe('… 22 more failed: report .temp/vitest-last.json')
    expect(tail[19]).toMatch(/^vitest: FAILED — 40 failed of 40 tests/)
  })

  it('says an interrupted run is one, and a run without files', () => {
    expect(lastRunTail({ reason: 'interrupted', files: [file('src/a.test.ts', [passed('one')])], unhandled: [] }, REPORT).at(-1))
      .toMatch(/^vitest: INTERRUPTED — 1 passed of 1 test in 1 file/)
    expect(lastRunTail({ reason: 'failed', files: [], unhandled: [] }, REPORT)).toEqual(['vitest: FAILED — no test files ran; report .temp/vitest-last.json'])
  })

  it('names a test that passed only on a retry with its first failure, after the failed ones', () => {
    const run: LastRun = {
      reason: 'failed',
      files: [file('src/e2e/a.test.ts', [
        { ...passed('slow'), retries: 1, errors: [{ message: 'Test timed out in 120000ms.\nIf this is a long-running test, …' }] },
        { ...failed('broken'), retries: 1 },
        passed('fast'),
      ])],
      unhandled: [],
    }
    expect(lastRunTail(run, REPORT)).toEqual([
      'FAIL src/e2e/a.test.ts > broken',
      'RETRIED src/e2e/a.test.ts > slow: Test timed out in 120000ms.',
      'vitest: FAILED — 1 failed, 2 passed of 3 tests in 1 file, 1 passed only on a retry; report .temp/vitest-last.json',
    ])
  })

  it('leaves the room to the failed tests when the retried ones do not fit', () => {
    const retried = Array.from({ length: 5 }, (_, i) => ({ ...passed(`r${i}`), retries: 1, errors: [{ message: 'Hook timed out in 20000ms.' }] }))
    const tests = [...Array.from({ length: 16 }, (_, i) => failed(`t${i}`)), ...retried]
    const tail = lastRunTail({ reason: 'failed', files: [file('src/a.test.ts', tests)], unhandled: [] }, REPORT)
    expect(tail).toHaveLength(20)
    expect(tail[15]).toBe('FAIL src/a.test.ts > t15')
    expect(tail[16]).toBe('RETRIED src/a.test.ts > r0: Hook timed out in 20000ms.')
    expect(tail[18]).toBe('… 3 more passed only on a retry: report .temp/vitest-last.json')
    expect(tail[19]).toMatch(/, 5 passed only on a retry; report/)
  })
})

describe('lastRunReport', () => {
  it('keeps the totals and every failure with its errors, not the passed tests', () => {
    const run: LastRun = {
      reason: 'failed',
      files: [
        file('src/a.test.ts', [passed('one'), failed('two', 'boom')]),
        file('src/c.test.ts', [], [{ message: 'Cannot find module' }]),
      ],
      unhandled: [{ message: 'late' }],
    }
    expect(lastRunReport(run, '2026-11-13T10:00:00.000Z')).toEqual({
      reason: 'failed',
      finishedAt: '2026-11-13T10:00:00.000Z',
      totals: { files: 2, tests: 2, passed: 1, failed: 1, skipped: 0 },
      failed: [
        { file: 'src/a.test.ts', test: 'two', errors: [{ message: 'boom', stack: 'Error: boom\n    at x.test.ts:3:5' }] },
        { file: 'src/c.test.ts', errors: [{ message: 'Cannot find module' }] },
      ],
      unhandled: [{ message: 'late' }],
    })
  })

  it('lists a test that passed only on a retry with the errors of its failed attempts', () => {
    const run: LastRun = {
      reason: 'passed',
      files: [file('src/e2e/a.test.ts', [passed('one'), { ...passed('two'), retries: 1, errors: [{ message: 'Test timed out in 60000ms.' }] }])],
      unhandled: [],
    }
    expect(lastRunReport(run, '2026-11-23T10:00:00.000Z')).toMatchObject({
      failed: [],
      retried: [{ file: 'src/e2e/a.test.ts', test: 'two', errors: [{ message: 'Test timed out in 60000ms.' }] }],
    })
  })
})
