import type { StatsScope } from '../../../src/stats/model.js'
import type { RuleKind } from '../../../src/stats/rules.js'
import { RULE_KIND_LABELS } from './marks.js'
import { isPreset, type PeriodChoice, type Step } from './period.js'

export interface StatsView {
  period: PeriodChoice
  projects: string[] | null
  scope: StatsScope
  account: string | null
  step: Step | null
  kinds: RuleKind[] | null
}

export const DEFAULT_VIEW: StatsView = { period: { preset: '30d' }, projects: null, scope: 'all', account: null, step: null, kinds: null }

const KINDS = new Set<string>(RULE_KIND_LABELS.map(([kind]) => kind))

const STEPS: Record<string, Step> = { d: 'day', w: 'week', m: 'month' }
const STEP_CODES: Record<Step, string> = { day: 'd', week: 'w', month: 'm' }

function isDay(text: string | null): text is string {
  if (text === null || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const date = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text)
}

function readPeriod(params: URLSearchParams): PeriodChoice {
  const from = params.get('from')
  const to = params.get('to')
  if (isDay(from) && isDay(to) && from <= to) return { from, to }
  const range = params.get('range')
  return range !== null && isPreset(range) ? { preset: range } : DEFAULT_VIEW.period
}

export function parseView(params: URLSearchParams): StatsView {
  const listed = params.get('projects')
  const kinds = params.get('kinds')
  return {
    period: readPeriod(params),
    projects: listed === null ? null : listed.split(',').filter((each) => each !== ''),
    scope: params.get('scope') === 'chain' ? 'chain' : 'all',
    account: params.get('account') || null,
    step: STEPS[params.get('step') ?? ''] ?? null,
    kinds: kinds === null ? null : (kinds.split(',').filter((each) => KINDS.has(each)) as RuleKind[]),
  }
}

export function viewSearch(view: StatsView): string {
  const params = new URLSearchParams()
  if ('preset' in view.period) {
    if (view.period.preset !== '30d') params.set('range', view.period.preset)
  } else {
    params.set('from', view.period.from)
    params.set('to', view.period.to)
  }
  if (view.projects !== null) params.set('projects', view.projects.join(','))
  if (view.scope !== 'all') params.set('scope', view.scope)
  if (view.account !== null) params.set('account', view.account)
  if (view.step !== null) params.set('step', STEP_CODES[view.step])
  if (view.kinds !== null) params.set('kinds', view.kinds.join(','))
  return params.toString()
}
