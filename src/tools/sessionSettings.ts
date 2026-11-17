import { join } from 'node:path'
import { sessionSecrets } from '../agent/env.js'
import { isPlain, type EvenKeelConfig } from '../config.js'
import type { Git } from '../git/types.js'
import { readJson } from '../packages/plugins.js'
import type { Packages } from '../packages/service.js'
import { chainSettings } from './panel.js'
import { readProjectSettings } from './projectSettings.js'

export interface SessionSettingsDeps {
  config: () => EvenKeelConfig
  packages: Pick<Packages, 'otherPlugins' | 'keyNames'>
  globalDir: string
  trim: () => boolean
  projectOf: (task: string) => string | undefined
  git: Git
  /** The project's branch, whose `.claude/settings.json` its task worktrees have (EKR-128). */
  branchOf: (project: string) => string
}

/**
 * Settings are assembled at launch from the current configuration, including the account-independent overrides. The
 * project's `settings.json` is the branch's, as the session's worktree has it and "What sessions get" shows it.
 */
export function createSessionSettings(deps: SessionSettingsDeps) {
  return async (task: string, project = deps.projectOf(task)): Promise<string | undefined> => {
    if (project === undefined) return undefined
    const config = deps.config()
    const repo = config.projects[project]!
    const plain = isPlain(config, project)
    const files = await readProjectSettings(deps.git, repo, deps.branchOf(project), plain)
    const plugins = deps.packages.otherPlugins(project, task, [readJson(join(deps.globalDir, 'settings.json')), files.project, files.local])
    const own = config.settings[project]
    return chainSettings(repo, plugins, deps.trim(), config.hiddenSkills, deps.globalDir, own?.cacheTtl ?? null, sessionSecrets(deps.packages.keyNames()), own?.protection ?? config.protection, own?.autoCompactWindow ?? null, plain, files)
  }
}
