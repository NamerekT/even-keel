import { defaultSettings } from '../packages/settings.js'
import type { ServerEntry } from '../packages/model.js'
import { isRecord } from './projects.js'

/** v13 → v14: only values differing from the current install are user overrides. */
export function packageOverrides(raw: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(raw.packages)) return raw
  const inherited: Record<string, Record<string, unknown>> = {}
  const packages = Object.fromEntries(Object.entries(raw.packages).map(([name, value]) => {
    if (!isRecord(value)) return [name, value]
    const install: unknown = Array.isArray(value.installs) ? value.installs.at(-1) : undefined
    const servers = isRecord(install) && isRecord(install.servers)
      ? Object.fromEntries(Object.entries(install.servers).flatMap(([server, each]) => isRecord(each) && isRecord(each.entry) ? [[server, each.entry]] : []))
      : { server: isRecord(value.server) ? value.server : {} }
    const defaults = defaultSettings(servers as Record<string, ServerEntry>)
    const settings = differing(value.settings, defaults)
    inherited[name] = { ...defaults, ...settings }
    return [name, { ...value, settings }]
  }))
  const projects = isRecord(raw.projects) ? Object.fromEntries(Object.entries(raw.projects).map(([project, value]) => {
    if (!isRecord(value) || !isRecord(value.settings)) return [project, value]
    const settings = Object.fromEntries(Object.entries(value.settings).flatMap(([name, own]) => {
      const overrides = differing(own, inherited[name] ?? {})
      return Object.keys(overrides).length === 0 ? [] : [[name, overrides]]
    }))
    return [project, { ...value, settings }]
  })) : raw.projects
  return { ...raw, packages, projects }
}

function differing(settings: unknown, inherited: Record<string, unknown>): Record<string, unknown> {
  return isRecord(settings) ? Object.fromEntries(Object.entries(settings).filter(([key, value]) => value !== inherited[key])) : {}
}
