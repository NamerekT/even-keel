import type { ChainRules } from '../chain/rules.js'
import { checkRules, projectLabel, type EvenKeelConfig } from '../config.js'
import { PROFILE_RULE_KEYS, profileFor, type ProfileRules, type ProfileSet } from './model.js'

type RulesConfig = Pick<EvenKeelConfig, 'rules' | 'ownRules' | 'trackers' | 'keys' | 'names' | 'settings'>

/**
 * The project's rules with the profile's between the shared ones and its own (BTN-66): `rules` is the project's own over
 * the shared, `own` only the keys the project set itself, which the profile does not touch.
 */
export function rulesWith(rules: ChainRules, own: Partial<ChainRules>, profile: ProfileRules | undefined): ChainRules {
  if (profile === undefined) return rules
  const merged = { ...rules }
  for (const key of PROFILE_RULE_KEYS) if (own[key] === undefined && profile[key] !== undefined) Object.assign(merged, { [key]: profile[key] })
  return merged
}

/** What the project's chain runs on: `rulesWith` of the profile it runs on; throws when they clash (`config.statusBoth`…). */
export function projectRules(config: RulesConfig, set: ProfileSet, project: string): ChainRules {
  const profile = profileFor(set, project, config.trackers[project] ?? '')
  return checkRules(rulesWith(config.rules[project]!, config.ownRules[project] ?? {}, profile?.rules), projectLabel(config, project))
}

/** Throws the first clash the profile's new rules would make with a project that runs on it. */
export function checkProfileRules(config: RulesConfig, set: ProfileSet, id: string, rules: ProfileRules): void {
  const next = { ...set, profiles: set.profiles.map((profile) => (profile.id === id ? { ...profile, rules } : profile)) }
  for (const project of Object.keys(config.rules)) {
    if (profileFor(next, project, config.trackers[project] ?? '')?.id === id) projectRules(config, next, project)
  }
}

/** Only the keys set, each a list of trimmed names without blanks; `null` of `active`/`terminal` — by the status category. */
export function cleanRules(rules: ProfileRules): ProfileRules {
  const clean: ProfileRules = {}
  for (const key of PROFILE_RULE_KEYS) {
    const value = rules[key]
    if (value === undefined) continue
    if (value === null) {
      if (key === 'active' || key === 'terminal') clean[key] = null
      continue
    }
    Object.assign(clean, { [key]: [...new Set(value.map((name) => name.trim()).filter((name) => name !== ''))] })
  }
  return clean
}
