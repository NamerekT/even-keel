import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CiRun, PushRuns } from '../../../src/ci/model.js'
import { t } from '../i18n/index.js'
import { AfterGreen, MirrorTime, pushTip, Timing } from './CiChip.js'

const NOW = new Date('2026-10-12T12:00:00Z')

function run(overrides: Partial<CiRun> = {}): CiRun {
  return {
    id: 1,
    number: 41,
    title: 'Fix the parser',
    workflow: 'Tests',
    commit: '78dde6c0000000',
    status: 'success',
    event: 'push',
    createdAt: '2026-10-12T11:30:00Z',
    startedAt: '2026-10-12T11:30:00Z',
    stoppedAt: '2026-10-12T11:33:12Z',
    url: 'https://ci.example.com/runs/41',
    ...overrides,
  }
}

const html = (element: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(element)

describe('the CI panel glues no facts with a dot (BTN-1378)', () => {
  it("puts a finished run's length and when into cells of their own", () => {
    const markup = html(createElement(Timing, { run: run(), median: null, now: NOW, meter: false }))
    expect(markup).not.toContain('·')
    expect(markup).toContain('ci__length')
    expect(markup).toContain('3:12')
    expect(markup).toContain('ci__ago')
    expect(markup).toContain(t.ci.took('3:12'))
  })

  it('names the after-green commit and its time apart, the waiting chain in the tip', () => {
    const since = '2026-10-12T11:50:00Z'
    const running = html(createElement(AfterGreen, { run: { commit: '78dde6c0000000', since, running: true }, held: true, now: NOW }))
    expect(running).not.toContain('·')
    expect(running).toContain(t.ci.after.held)
    expect(running).toContain('ci__after-mark')
    const done = html(createElement(AfterGreen, { run: { commit: '78dde6c0000000', since, running: false, end: { at: since, state: 'done' } }, held: false, now: NOW }))
    expect(done).not.toContain('·')
    expect(done).toContain(t.ci.after.done('78dde6c'))
    expect(done).toContain('ci__after-ago')
    expect(done).not.toContain('ci__after-mark')
    const failed = html(
      createElement(AfterGreen, { run: { commit: '78dde6c0000000', since, running: false, end: { at: since, state: 'failed', command: 'npm test', code: 1 } }, held: false, now: NOW }),
    )
    expect(failed).not.toContain('·')
    expect(failed).toContain('ci__after-ago')
  })

  it("shows a mirror's length as a clock cell beside \"same commit\"", () => {
    const markup = html(createElement(MirrorTime, { length: 470_000 }))
    expect(markup).not.toContain('·')
    expect(markup).toContain(t.ci.same)
    expect(markup).toContain('7:50')
    expect(markup).toContain('ci__length')
  })

  it("writes a past push's tip as captioned lines", () => {
    const push: PushRuns = { key: 'k', commit: '78dde6c0000000', title: 'Fix the parser', manual: false, runs: [run(), run({ id: 2, number: 186, workflow: 'macOS' })] }
    const tip = pushTip(push, 'chain')
    expect(tip).not.toContain('·')
    expect(tip.split('\n')).toEqual([
      `${t.ci.facts.status}: ${t.ci.status.success}`,
      `${t.ci.facts.event}: ${t.ci.events.push}`,
      `${t.ci.facts.by}: ${t.ci.pushedBy.chain}`,
      `${t.ci.facts.runs}: Tests #41, macOS #186`,
    ])
    expect(pushTip({ ...push, runs: [run({ event: undefined })] }, undefined).split('\n')).toEqual([`${t.ci.facts.status}: ${t.ci.status.success}`, `${t.ci.facts.runs}: Tests #41`])
  })
})
