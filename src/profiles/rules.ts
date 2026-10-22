import type { ChainRules } from '../chain/rules.js'
import { checkRules, projectLabel, type EvenKeelConfig, type Feed } from '../config.js'
import { PROFILE_RULE_KEYS, profileFor, type ProfileRules, type ProfileSet } from './model.js'

type RulesConfig = Pick<EvenKeelConfig, 'rules' | 'ownRules' | 'trackers' | 'keys' | 'names' | 'settings'> & Partial<Pick<EvenKeelConfig, 'feeds'>>

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

/**
 * What the project's chain runs on: `rulesWith` of the profile it runs on — for the tasks of one of its feeds, the
 * feed's profile; throws when they clash (`config.statusBoth`…).
 */
export function projectRules(config: RulesConfig, set: ProfileSet, project: string, feed?: Feed): ChainRules {
  const profile = feed === undefined ? profileFor(set, project, config.trackers[project] ?? '') : profileFor(set, feed.id, feed.tracker)
  const label = feed === undefined ? projectLabel(config, project) : `${projectLabel(config, project)} · ${feed.key}`
  return checkRules(rulesWith(config.rules[project]!, config.ownRules[project] ?? {}, profile?.rules), label)
}

/** Throws the first clash the profile's new rules would make with a project or a feed that runs on it. */
export function checkProfileRules(config: RulesConfig, set: ProfileSet, id: string, rules: ProfileRules): void {
  const next = { ...set, profiles: set.profiles.map((profile) => (profile.id === id ? { ...profile, rules } : profile)) }
  for (const project of Object.keys(config.rules)) {
    if (profileFor(next, project, config.trackers[project] ?? '')?.id === id) projectRules(config, next, project)
    for (const feed of config.feeds?.[project] ?? []) if (profileFor(next, feed.id, feed.tracker)?.id === id) projectRules(config, next, project, feed)
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
