import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { TaskSession } from '../../../src/chain/launches.js'
import { formatLineTime } from '../format.js'
import { t } from '../i18n/index.js'
import { Loader } from '../ui/Loader.js'
import { progressParts } from './jobProgress.js'
import { StepState } from './JobWindow.js'
import { ModelFact } from './SessionFacts.js'
import { PlaceFacts, SessionHow } from './SessionPanel.js'
import { toggleTip, TurnRow } from './TranscriptWindow.js'

const html = (element: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(element)

const ROW: TaskSession = { sessionId: 'a1b2c3d4e5', at: '2026-11-20T09:00:00Z', how: 'launch', resumed: 0, answers: 0 }

describe('the session glues no facts with a dot (BTN-1376)', () => {
  it("draws a session's resumes, answers and compactions as counted badges, the words in their tips", () => {
    const markup = html(createElement(SessionHow, { row: { ...ROW, resumed: 1, answers: 2, compactions: 3 } }))
    expect(markup).not.toContain('·')
    expect(markup).toContain(t.session.launches.launch)
    expect(markup.match(/class="sessions__badge"/g)).toHaveLength(3)
    for (const tip of [t.session.resumed(1), t.session.answered(2), t.session.compacted(3)]) expect(markup).toContain(tip)
  })

  it('leaves out the badges of what did not happen', () => {
    const markup = html(createElement(SessionHow, { row: { ...ROW, compactions: 0 } }))
    expect(markup).not.toContain('sessions__badge')
  })

  it('puts how a session ended on lines of their own', () => {
    const markup = html(
      createElement(SessionHow, {
        row: { ...ROW, left: { at: ROW.at, reason: 'postpone', blockers: ['ABC-7'] }, replaced: { at: ROW.at, how: 'relay', cause: 'limit' } },
      }),
    )
    expect(markup).not.toContain('·')
    expect(markup.match(/class="sessions__end"/g)).toHaveLength(2)
    expect(markup).toContain(t.session.postponed('ABC-7'))
    expect(markup).toContain(t.session.replacedRelay.limit)
  })

  it('shows the branch and the folder as two facts', () => {
    const markup = html(createElement(PlaceFacts, { branch: 'abc-5/chain-order', workdir: 'C:\\repos\\abc-5' }))
    expect(markup).not.toContain('·')
    expect(markup).toContain(t.session.branch)
    expect(markup).toContain(t.session.folder)
    const bare = html(createElement(PlaceFacts, { branch: null, workdir: 'C:\\repos\\abc-5' }))
    expect(bare).not.toContain(t.session.branch)
  })

  it("splits a model's provider off with a bar, as the run label does", () => {
    const markup = html(createElement(ModelFact, { agent: 'codex', model: 'gpt-6.1-sol', effort: null }))
    expect(markup).not.toContain('·')
    expect(markup).toContain(' | ')
  })

  it("puts the turn's time in a grey pill before what it does, the start in its tip (BTN-1427)", () => {
    const since = '2026-11-21T12:00:00Z'
    const markup = html(createElement(TurnRow, { doing: t.session.chat.thinking, elapsed: '23s', since }))
    expect(markup).not.toContain('·')
    expect(markup).toMatch(/class="count-badge transcript__turn-time">23s</)
    expect(markup.indexOf('transcript__turn-time')).toBeLessThan(markup.indexOf(t.session.chat.thinking))
    expect(markup.indexOf('lamp--working')).toBeLessThan(markup.indexOf('transcript__turn-time'))
    expect(markup).toContain(t.session.chat.turnSince(formatLineTime(since)))
    expect(html(createElement(TurnRow, { doing: t.session.chat.thinking, elapsed: null, since: null }))).not.toContain('transcript__turn-time')
  })

  it("gives the loader's time a cell of its own", () => {
    const markup = html(createElement(Loader, { phase: 'stay', label: t.session.chat.handing.boot, time: '0:12' }))
    expect(markup).not.toContain('·')
    expect(markup).toContain('<span class="ui-loader__time">0:12</span>')
  })

  it("puts a button's keys under its name in the tip", () => {
    const markup = html(toggleTip('Show the task', 'Ctrl+K'))
    expect(markup).not.toContain('·')
    expect(markup).toContain('<kbd class="tip__keys">Ctrl+K</kbd>')
  })

  it("keeps a job step's state and time, and a clone's figures, in cells", () => {
    const step = html(createElement(StepState, { step: { id: 'clone', state: 'running', startedAt: '2026-11-13T10:00:00Z' }, now: new Date('2026-11-13T10:00:42Z') }))
    expect(step).not.toContain('·')
    expect(step).toContain('<span class="job-window__time">0:42</span>')
    expect(progressParts({ stage: 'receiving', percent: 42, bytes: 2048, speed: 1024 })).toEqual(['receiving', '42%', '2 KB (1 KB/s)'])
  })
})
