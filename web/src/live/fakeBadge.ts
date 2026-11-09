import type { BadgeCheck } from '../../../src/badge/check.js'
import { renderBadge } from '../../../src/badge/drawing.js'
import { BADGE_FIELDS, BADGE_SECRET, type BadgeSettings, type BadgeState } from '../../../src/badge/model.js'
import { fail, notice } from '../../../src/notice/notice.js'
import type { EvenKeelState } from '../../../src/state.js'

const HTTP = /^https?:\/\/[^\s/]+/
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/

/**
 * `?badgeState=filled`: ABC publishes to a Worker with every field but the English titles, and the push secret is set
 * (BTN-917); `?badgeCheck=refused|unreachable` makes the dialog's "Check" fail so.
 */
export function withFakeBadge(state: EvenKeelState, mode: string): EvenKeelState {
  if (mode !== 'filled') return state
  const project = state.projects.find((id) => state.projectKeys[id] === 'ABC') ?? state.projects[0]
  const form = project === undefined ? undefined : state.config.projects[project]
  if (project === undefined || form === undefined) return state
  const badge: BadgeSettings = { on: true, url: 'https://even-keel-badge.example.workers.dev', slug: 'abc', fields: BADGE_FIELDS.filter((field) => field !== 'title') }
  const variables = state.secrets.variables.map((each) => (each.name === BADGE_SECRET ? { ...each, set: true } : each))
  return { ...state, config: { ...state.config, projects: { ...state.config.projects, [project]: { ...form, badge } } }, secrets: { ...state.secrets, variables } }
}

/** `project/badge` writes the project's badge as the service would, refusing a bad address or name. */
export function fakeBadgeCommand(state: EvenKeelState, name: string, body: Record<string, unknown>): EvenKeelState | null {
  if (name !== 'project/badge') return null
  const project = String(body.project)
  const form = state.config.projects[project]
  if (form === undefined) return state
  const badge = body.badge as BadgeSettings | null
  if (badge !== null && badge.url.trim() !== '' && !HTTP.test(badge.url.trim())) throw fail('badge.url', {})
  if (badge !== null && badge.slug.trim() !== '' && !SLUG.test(badge.slug.trim().toLowerCase())) throw fail('badge.slug', {})
  const next = badge === null ? null : { ...badge, url: badge.url.trim(), slug: badge.slug.trim().toLowerCase() }
  return { ...state, config: { ...state.config, projects: { ...state.config.projects, [project]: { ...form, badge: next } } } }
}

/** `project/badge/check`: passes unless `?badgeCheck` names a failure. */
export function fakeBadgeCheck(body: Record<string, unknown>, mode: string | null): BadgeCheck {
  if (!HTTP.test(String(body.url).trim())) return { ok: false, notice: notice('badge.url', {}) }
  if (mode === 'refused') return { ok: false, notice: notice('badge.refused', {}) }
  if (mode === 'unreachable') return { ok: false, notice: notice('badge.unreachable', {}) }
  return { ok: true, notice: notice('badge.checked', {}) }
}

/** The preview drawn in the page from a made-up state: the fake has no service to ask. */
export function fakeBadgeUrl(state: EvenKeelState | null, project: string, theme: 'dark' | 'light'): string {
  const key = state?.projectKeys[project] ?? project
  const now = new Date()
  const badge: BadgeState = {
    v: 1,
    at: now.toISOString(),
    project: { key, name: state?.config.projects[project]?.name ?? key },
    active: [
      {
        key: `${key}-12`,
        titleEn: 'Badge for the README: a dialog in the project settings',
        agent: 'claude',
        model: 'opus',
        startedAt: new Date(now.getTime() - 14 * 60_000).toISOString(),
        state: 'working',
        action: { tool: 'Edit', text: 'web/src/pages/BadgeDialog.tsx' },
        context: 42,
      },
    ],
    chain: {
      state: 'running',
      next: `${key}-13`,
      tasks: [
        { key: `${key}-10`, state: 'done' },
        { key: `${key}-11`, state: 'done' },
        { key: `${key}-12`, state: 'working' },
        { key: `${key}-13`, state: 'queued' },
        { key: `${key}-14`, state: 'queued' },
      ],
    },
    milestone: { name: 'v0.3', done: 11, left: 4 },
    stats: { sessions: 128, medianCost: 1.84, medianMinutes: 22 },
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderBadge(badge, { theme, now }))}`
}
