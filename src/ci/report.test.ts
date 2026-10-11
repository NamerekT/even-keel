import { describe, expect, it } from 'vitest'
import type { CiJob, CiRun } from './model.js'
import { logTail, redReport, type RedFacts } from './report.js'

const run: CiRun = {
  id: 7,
  number: 12,
  title: 'Merge btn-1',
  workflow: 'CI',
  commit: 'abcdef1234567',
  status: 'failure',
  createdAt: '2026-10-12T10:00:00Z',
  startedAt: '2026-10-12T10:00:05Z',
  stoppedAt: '2026-10-12T10:03:00Z',
  url: 'https://example.com/acme/app/actions/runs/7',
}

const job = (name: string, status: CiJob['status'], steps: CiJob['steps']): CiJob => ({ id: 1, name, status, startedAt: null, stoppedAt: null, steps })

const facts: RedFacts = {
  commit: 'abcdef1234567',
  runs: [
    {
      kind: 'github',
      run,
      jobs: [
        job('lint', 'success', []),
        job('build', 'failure', [
          { name: 'Checkout', status: 'success', startedAt: null, stoppedAt: null },
          { name: 'Test', status: 'failure', startedAt: null, stoppedAt: null },
        ]),
      ],
      log: 'FAIL src/a.test.ts\nexpected 1 to be 2',
    },
    { kind: 'forgejo', run: { ...run, id: 8, number: 3, url: 'https://example.com/forgejo/runs/3' }, jobs: [job('test', 'failure', null)], log: null },
  ],
  commits: ['abcdef1 [BTN-2] Second', '1234567 [BTN-1] First'],
  green: '1111111aaaa',
  tasks: ['BTN-1', 'BTN-2'],
}

describe('redReport', () => {
  it('titles the fix task by the short commit in the chosen language', () => {
    expect(redReport(facts, 'en').title).toBe('CI on main failed: abcdef1')
    expect(redReport(facts, 'ru').title).toBe('CI на main упал: abcdef1')
  })

  it('lists the failed runs with links, their failed jobs and steps, the log tail, the commits and the tasks', () => {
    const { description } = redReport(facts, 'en')
    expect(description).toContain('- GitHub Actions: [CI #12](https://example.com/acme/app/actions/runs/7)')
    expect(description).toContain('  - job build, failed step: Test')
    expect(description).not.toContain('job lint')
    expect(description).toContain('- Forgejo: [CI #3](https://example.com/forgejo/runs/3)')
    expect(description).toContain('  - job test')
    expect(description).toContain('```text\nFAIL src/a.test.ts\nexpected 1 to be 2\n```')
    expect(description).toContain('```text\nabcdef1 [BTN-2] Second\n1234567 [BTN-1] First\n```')
    expect(description).toContain('BTN-1, BTN-2')
    expect(description).not.toContain('last green commit is unknown')
  })

  it('says the commits are only the latest when no green commit is known', () => {
    expect(redReport({ ...facts, green: null }, 'en').description).toContain('The last green commit is unknown')
  })

  it('says where the log is when no CI gave one', () => {
    const { description } = redReport({ ...facts, runs: [facts.runs[1]!] }, 'ru')
    expect(description).toContain('Лог упавших заданий — на странице прогона.')
    expect(description).not.toContain('## Хвост лога')
  })

  it('makes the comment for a fix task already open from the same facts', () => {
    const { comment } = redReport(facts, 'ru')
    expect(comment.startsWith('CI на main снова упал на `abcdef1`.')).toBe(true)
    expect(comment).toContain('[CI #12](https://example.com/acme/app/actions/runs/7)')
  })

  it('never puts inline code inside a bold mark or a link', () => {
    for (const language of ['en', 'ru'] as const) {
      const { description, comment } = redReport(facts, language)
      for (const text of [description, comment]) {
        expect(text).not.toMatch(/\*\*[^*\n]*`[^*\n]*\*\*/)
        expect(text).not.toMatch(/\[[^\]\n]*`[^\]\n]*\]\(/)
      }
    }
  })
})

describe('logTail', () => {
  it('keeps the last lines without the timestamps GitHub prefixes', () => {
    const log = ['2026-10-12T10:00:01.1234567Z one', '2026-10-12T10:00:02.1234567Z two', '2026-10-12T10:00:03.1234567Z three', ''].join('\r\n')
    expect(logTail(log, 2)).toBe('two\nthree')
  })

  it('does not let the log close the code block', () => {
    expect(logTail('a\n```\nb', 10)).toBe("a\n'''\nb")
  })
})
