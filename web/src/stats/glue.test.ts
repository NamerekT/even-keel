import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { StatsPeriod, StatsTaskRow } from '../../../src/stats/model.js'
import { t } from '../i18n/index.js'
import { fakePeriod } from '../live/fakeStats.js'
import { EstimateSection } from './EstimateSection.js'
import { formatShare, formatUsd } from './format.js'
import { Sources, Tiles } from './Summary.js'

vi.mock('../live/context.js', () => ({ useLive: () => ({ state: null }) }))

const range = { from: '2026-11-01', to: '2026-11-18' }

function period(): StatsPeriod {
  const answer = fakePeriod(null, { ...range, projects: null, scope: 'all', account: null, tz: 'UTC' })
  if (answer.state !== 'ok') throw new Error(answer.state)
  return answer.data
}

function task(id: string, fields: Partial<StatsTaskRow>): StatsTaskRow {
  return {
    task: id, project: 'ABC', title: null, status: 'Done', url: null, cost: 1, priceEstimate: null, limit: null, sessions: 1, relays: 0,
    checkpoints: 0, restarts: 0, compactsAuto: 0, compactsManual: 0, spans: 0, rework: false, estimateH: null, activeS: null, waitS: null,
    totalS: null, done: true, component: null, model: null, ...fields,
  }
}

const fold = { open: true, onToggle: () => {} }

/** The text a person reads: no tags. */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ')

describe('/stats glues no facts with a dot (BTN-1384)', () => {
  it('the stuck tile shows its share as a muted second figure of the same row', () => {
    const data = period()
    const html = renderToStaticMarkup(createElement(Tiles, { period: data, range }))
    expect(text(html)).not.toContain('·')
    const share = formatShare((data.current.stuckCost / data.current.cost) * 100)
    expect(html).toContain(`${formatUsd(data.current.stuckCost)}<span class="stats-tile__share">${share}</span>`)
  })

  it('the legend of the sources puts the name, the sum and the share into columns of their own', () => {
    const data = period()
    const html = renderToStaticMarkup(createElement(Sources, { period: data }))
    expect(text(html)).not.toContain('·')
    const top = data.models.filter((each) => each.cost > 0)[0]!
    expect(html).toContain(`<span class="sources__sum">${formatUsd(top.cost)}</span><span class="sources__share">`)
  })

  it('the estimate tiles give each figure a captioned row and the skipped tasks a count with a tip', () => {
    const hours = (count: number) => count * 3600
    const tasks = [
      task('ABC-1', { estimateH: 1, activeS: hours(1.2) }),
      task('ABC-2', { estimateH: 2, activeS: hours(5) }),
      task('ABC-3', { activeS: hours(0.5) }),
      task('ABC-4', { estimateH: 1, activeS: hours(1), done: false }),
    ]
    const html = renderToStaticMarkup(createElement(EstimateSection, { tasks, fold }))
    expect(text(html)).not.toContain('·')
    expect(html).toContain(`<dt>${t.stats.estimate.within2Label}</dt><dd>50%</dd>`)
    expect(html).toContain(`<dt>${t.stats.estimate.comparedLabel}</dt><dd>2</dd>`)
    expect(html).toMatch(new RegExp(`<dt>${t.stats.estimate.skipped}</dt><dd>.*>2<`))
  })
})
