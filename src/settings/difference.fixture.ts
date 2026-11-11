import { isDeepStrictEqual } from 'node:util'
import type { EvenKeelConfig } from '../config.js'
import { configDefaults, projectDefaults } from './expectations.fixture.js'

/** JSON-pointer paths keep literal dots and slashes in map keys unambiguous. Missing defaults are recorded too. */
export function difference(actual: unknown, baseline: unknown): { changed: Record<string, unknown>; missing: string[] } {
  const changed: Record<string, unknown> = {}
  const missing: string[] = []
  const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
  const visit = (value: unknown, expected: unknown, path: string) => {
    if (isDeepStrictEqual(value, expected)) return
    if (!object(value) || !object(expected)) {
      changed[path] = value
      return
    }
    for (const key of [...new Set([...Object.keys(expected), ...Object.keys(value)])].sort()) {
      const next = `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`
      if (!Object.hasOwn(value, key) || value[key] === undefined) missing.push(next)
      else if (!Object.hasOwn(expected, key)) changed[next] = value[key]
      else visit(value[key], expected[key], next)
    }
  }
  visit(actual, baseline, '')
  return { changed, missing }
}

export function configDifference(config: EvenKeelConfig) {
  const baseline = configDefaults()
  for (const id of Object.keys(config.projects)) {
    baseline.settings[id] = projectDefaults()
    baseline.rules[id] = structuredClone(baseline.chain)
    baseline.ownRules[id] = {}
    baseline.briefs[id] = null
  }
  return difference(config, baseline)
}
