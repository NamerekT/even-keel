import { configStore } from '../account/share.js'
import { isPlain, type EvenKeelConfig } from '../config.js'
import type { Git } from '../git/types.js'
import type { Packages } from '../packages/service.js'
import { readProjectSettings } from '../tools/projectSettings.js'
import { trimSettings } from '../tools/settings.js'
import type { MenuEntry } from './commands.js'
import { chatMenu } from './menu.js'

export interface MenuSourceDeps {
  config: () => EvenKeelConfig
  packages: Pick<Packages, 'pluginFolders'>
  /** The hub's global folder: its configuration copy is the menu's user part. */
  globalDir: string
  trim: () => boolean
  git: Git
  branchOf: (project: string) => string
}

/**
 * The hub's answer to `chat/menu` (BTN-1695): what the session gets, never asked of the session or its machine. A chain
 * session with "Trim the tools" on loses what the trim's `skillOverrides` turn off (`trimSettings`); a project chat has
 * no trim (`createChatSettings`).
 */
export function createMenuSource(deps: MenuSourceDeps) {
  return async (project: string, task: string | null): Promise<MenuEntry[]> => {
    const config = deps.config()
    const repo = config.projects[project]
    if (repo === undefined) return []
    let overrides: Record<string, unknown> = {}
    if (task !== null && deps.trim()) {
      const files = await readProjectSettings(deps.git, repo, deps.branchOf(project), isPlain(config, project))
      overrides = trimSettings(config.hiddenSkills, files.project, files.local).skillOverrides as Record<string, unknown>
    }
    return chatMenu({ configFolder: configStore(deps.globalDir), plugins: deps.packages.pluginFolders(project, task), overrides })
  }
}
