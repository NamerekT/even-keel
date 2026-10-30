import type { ProfileKindView, ProfileView } from '../../../src/state.js'

const DAY_MS = 86_400_000

type Field = ProfileKindView['fields'][number]

/** The set of fields a profile signs in with: the one the stored profile has filled, else the first. */
export function alternativeOf(kind: ProfileKindView, profile: ProfileView | undefined): number {
  if (profile === undefined) return 0
  const filled = kind.alternatives.findIndex((names) => names.every((name) => profile.fields.some((field) => field.name === name && field.set)))
  return Math.max(filled, 0)
}

/** The kind's fields outside every set, and those of the chosen set. */
export function shownFields(kind: ProfileKindView, alternative: number): Field[] {
  const chosen = kind.alternatives[alternative] ?? []
  return kind.fields.filter((field) => !kind.alternatives.some((names) => names.includes(field.name)) || chosen.includes(field.name))
}

/** The fields above the MCP block: a kind with MCP OAuth keeps its optional MCP token inside the block. */
export function trackerFields(kind: ProfileKindView, alternative: number): Field[] {
  return shownFields(kind, alternative).filter((field) => kind.mcpOAuth !== true || field.name !== 'JIRA_MCP_TOKEN')
}

/** The fields above the MCP block left blank, which a check and an MCP connection both need; a stored secret counts as filled. */
export function unfilled(kind: ProfileKindView, alternative: number, typed: Readonly<Record<string, string>>, profile: ProfileView | undefined): string[] {
  const kept = (name: string) => profile?.fields.some((field) => field.name === name && field.secret && field.set) === true
  return trackerFields(kind, alternative).filter(({ name }) => (typed[name] ?? '').trim() === '' && !kept(name)).map(({ name }) => name)
}

/** The values to check or save: a field of another set is `null` (removed), one not typed is blank (a stored secret stays). */
export function draftValues(kind: ProfileKindView, alternative: number, typed: Readonly<Record<string, string>>): Record<string, string | null> {
  const shown = new Set(shownFields(kind, alternative).map((field) => field.name))
  return Object.fromEntries(kind.fields.map(({ name }) => [name, shown.has(name) ? (typed[name] ?? '') : null]))
}

/** What a new profile starts with: the server's address in the kind's one host field (Forgejo's URL); a kind with none or several gets nothing. */
export function hostValues(kind: Pick<ProfileKindView, 'hostVariables'>, host: string | undefined): Record<string, string> {
  const [only, ...rest] = kind.hostVariables
  return host === undefined || host === '' || only === undefined || rest.length > 0 ? {} : { [only]: host }
}

/** Whole days until `expiresAt`, rounded up; zero or less once it is past. */
export function daysLeft(expiresAt: string, now: number): number {
  return Math.ceil((Date.parse(expiresAt) - now) / DAY_MS)
}
