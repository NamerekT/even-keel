import type { EvenKeelState } from '../../../src/state.js'
import { EMPTY_FIELDS, switchBuiltin, switchProfile, type WizardFields } from './projectWizard.js'

/** Defaults at each visit, with only the person's edits restored over them. */
export function firstFields(state: EvenKeelState, kept: Partial<WizardFields> = {}): WizardFields {
  const trackers = new Set(state.profiles.kinds.filter((kind) => kind.tracker).map((kind) => kind.kind))
  const own = state.profiles.profiles.filter((profile) => trackers.has(profile.kind))
  const empty: WizardFields = { ...EMPTY_FIELDS, git: state.config.shared.defaultGit ?? state.git?.version !== null }
  const defaults = own.length === 0 ? switchBuiltin(empty) : own.length === 1 ? switchProfile(empty, own[0]!) : empty
  return { ...defaults, ...kept }
}

/** Record a user action without turning untouched defaults into manual choices. */
export function keepFields(kept: Partial<WizardFields>, before: WizardFields, after: WizardFields): Partial<WizardFields> {
  const changed = Object.fromEntries(Object.entries(after).filter(([key, value]) => value !== before[key as keyof WizardFields]))
  for (const field of ['key', 'name', 'trackerProject'] as const) if (after.typed[field]) changed[field] = after[field]
  if (after.tracker !== before.tracker || after.profile !== before.profile) {
    changed.tracker = after.tracker
    changed.profile = after.profile
  }
  return { ...kept, ...changed }
}
