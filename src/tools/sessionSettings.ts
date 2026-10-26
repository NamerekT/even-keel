import { join } from 'node:path'
import { sessionSecrets } from '../agent/env.js'
import type { EvenKeelConfig } from '../config.js'
import { readJson } from '../packages/plugins.js'
import type { Packages } from '../packages/service.js'
import { chainSettings } from './panel.js'

export interface SessionSettingsDeps {
  config: () => EvenKeelConfig
  packages: Pick<Packages, 'otherPlugins' | 'keyNames'>
  globalDir: string
  trim: () => boolean
  projectOf: (task: string) => string | undefined
}

/** Settings are assembled at launch from the current configuration, including the account-independent overrides. */
export function createSessionSettings(deps: SessionSettingsDeps) {
  return (task: string, project = deps.projectOf(task)): string | undefined => {
    if (project === undefined) return undefined
    const config = deps.config()
    const repo = config.projects[project]!
    const files = [join(deps.globalDir, 'settings.json'), join(repo, '.claude', 'settings.json'), join(repo, '.claude', 'settings.local.json')].map(readJson)
    return chainSettings(repo, deps.packages.otherPlugins(project, task, files), deps.trim(), config.hiddenSkills, deps.globalDir, config.settings[project]?.cacheTtl ?? null, sessionSecrets(deps.packages.keyNames()))
  }
}
