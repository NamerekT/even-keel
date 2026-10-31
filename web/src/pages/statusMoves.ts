import { MOVE_SETTINGS, type MoveSetting, type StatusMoves } from '../../../src/chain/moves.js'
import { isActive, isDone, sameName, type ChainRules } from '../../../src/chain/rules.js'
import type { TaskStatus } from '../../../src/tracker/model.js'
import { t } from '../i18n/index.js'
import type { SelectOption } from '../ui/Select.js'

/** A source's own "leave the status" (`null`); no status is named so. `''` — the key is not set here. */
export const LEAVE = '\u0000leave'

export type MovesText = Record<MoveSetting, string>

export const movesText = (moves: StatusMoves | undefined): MovesText =>
  Object.fromEntries(MOVE_SETTINGS.map((key) => [key, moves?.[key] === null ? LEAVE : (moves?.[key] ?? '')])) as MovesText

/** A profile's: its `null` is the same as no key, "leave". */
export const profileMovesText = (moves: StatusMoves | undefined): MovesText =>
  Object.fromEntries(Object.entries(movesText(moves)).map(([key, value]) => [key, value === LEAVE ? '' : value])) as MovesText

export function movesFrom(values: Readonly<Record<string, unknown>>): StatusMoves {
  return Object.fromEntries(
    MOVE_SETTINGS.flatMap((key) => {
      const value = values[key]
      if (typeof value !== 'string' || value === '') return []
      return [[key, value === LEAVE && key !== 'done' ? null : value]]
    }),
  ) as StatusMoves
}

/** What a profile's value reads as where a source inherits it. */
export function profileMoveLabel(key: MoveSetting, profile: StatusMoves | undefined): string {
  const value = profile?.[key]
  return typeof value === 'string' ? value : key === 'done' ? t.profiles.moves.auto : t.profiles.moves.leave
}

/**
 * The choices of a move: a profile's (`profile` absent) — "leave" or "automatic" and the statuses; a source's — "as in
 * the profile", "leave" for start and review, and the statuses. Start and review offer those in the chain, completion
 * the done ones; a chosen status the list lacks stays, so the field never shows a blank.
 */
export function moveOptions(key: MoveSetting, rules: ChainRules, statuses: readonly TaskStatus[], value: string, profile?: StatusMoves): SelectOption[] {
  const fits = statuses.filter((status) => (key === 'done' ? isDone(rules, status) : isActive(rules, status))).map((status) => status.name)
  const named = value === '' || value === LEAVE || fits.some((name) => sameName(name, value)) ? fits : [...fits, value]
  const first: SelectOption[] = [{ value: '', label: moveLabel(key, '', profile) }, ...(profile === undefined || key === 'done' ? [] : [{ value: LEAVE, label: t.profiles.moves.leave }])]
  return [...first, ...named.map((name) => ({ value: name, label: name }))]
}

/** What a draft value of a move reads as: `''` — the default of a profile, the profile's value of a source. */
export function moveLabel(key: MoveSetting, value: string, profile?: StatusMoves): string {
  if (value === LEAVE) return t.profiles.moves.leave
  if (value !== '') return value
  return profile === undefined ? profileMoveLabel(key, undefined) : t.profiles.moves.asProfile(profileMoveLabel(key, profile))
}
