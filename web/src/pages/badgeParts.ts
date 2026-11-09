import { BADGE_FIELDS, type BadgeField, type BadgeSettings } from '../../../src/badge/model.js'
import type { RemoteRef } from '../../../src/state.js'

export type BadgeGroupId = 'tasks' | 'context' | 'chain' | 'milestone' | 'sessions' | 'medianCost' | 'medianMinutes' | 'title'

/** A switch of the badge dialog (BTN-917) and the fields of the state it publishes. */
export interface BadgeGroup {
  id: BadgeGroupId
  fields: readonly BadgeField[]
}

export const BADGE_GROUPS: readonly BadgeGroup[] = [
  { id: 'tasks', fields: ['agent', 'model', 'time', 'action'] },
  { id: 'context', fields: ['context'] },
  { id: 'chain', fields: ['chain'] },
  { id: 'milestone', fields: ['milestone'] },
  { id: 'sessions', fields: ['sessions'] },
  { id: 'medianCost', fields: ['medianCost'] },
  { id: 'medianMinutes', fields: ['medianMinutes'] },
  { id: 'title', fields: ['title'] },
]

export const groupOn = (fields: readonly BadgeField[], group: BadgeGroup): boolean => group.fields.every((field) => fields.includes(field))

export function withGroup(fields: readonly BadgeField[], group: BadgeGroup, on: boolean): BadgeField[] {
  return BADGE_FIELDS.filter((field) => (group.fields.includes(field) ? on : fields.includes(field)))
}

/** The project's name on the Worker until one is given: its key in lower case. */
export function defaultSlug(key: string): string {
  const slug = key
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return slug === '' ? 'project' : slug
}

/** What the dialog shows and writes: the saved badge, or one turned off with every field. */
export function badgeDraft(saved: BadgeSettings | null | undefined, key: string): BadgeSettings {
  return saved ?? { on: false, url: '', slug: defaultSlug(key), fields: [...BADGE_FIELDS] }
}

const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?\//

/** The releases page of the project's repository on a forge: GitHub first, then GitLab, then any other; `null` — none. */
export function releasesLink(remotes: readonly RemoteRef[]): string | null {
  const hosted = remotes.filter((remote) => HOST.test(remote.id))
  const pick = hosted.find((remote) => remote.id.startsWith('github.com/')) ?? hosted.find((remote) => remote.id.startsWith('gitlab.')) ?? hosted[0]
  if (pick === undefined) return null
  return `https://${pick.id}${pick.id.startsWith('gitlab.') ? '/-/releases' : '/releases'}`
}

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The README snippet: the light picture where the reader's theme is light, the dark one else, in a link to the releases. */
export function badgeMarkdown(input: { url: string; slug: string; name: string; releases: string }): string {
  const base = `${input.url.trim().replace(/\/+$/, '')}/${input.slug}.svg`
  const picture = `<picture><source media="(prefers-color-scheme: light)" srcset="${escape(`${base}?theme=light`)}"><img alt="${escape(`${input.name}: what the chain is building now`)}" src="${escape(`${base}?theme=dark`)}"></picture>`
  const link = input.releases.trim()
  return link === '' ? picture : `<a href="${escape(link)}">${picture}</a>`
}
