import { fallbackPassed, instructionsFor, pluginReach, skillFoldersFor, type InstructionFile, type RepoRules, type SkillFolder } from '../../../src/agent/projectRules.js'
import type { PackagesView } from '../../../src/state.js'

/** What a new session of the project gets on the agent, for "What the session gets" on the project's settings (BTN-340). */
export interface SessionGets {
  /** The instruction files it reads. */
  files: InstructionFile[]
  /** Committed files it does not read: the other agent's, when both are there. */
  unread: InstructionFile[]
  /** Its one file is given by Even Keel, not found by the agent. */
  passed: boolean
  prompts: { shared: boolean; project: boolean }
  /** The project's skills it gets. */
  skills: string[]
  /** The project's skill folders it does not read. */
  missed: { folder: SkillFolder; names: string[] }[]
  /** The plugin packages whose skills it gets; `hooks` — with their hooks. */
  packages: { name: string; hooks: boolean }[]
  /** No instruction file, prompt or skill of the project reaches it. */
  none: boolean
}

export function sessionGets(agent: string, rules: RepoRules, prompts: SessionGets['prompts'], packages: PackagesView | null, project: string): SessionGets {
  const files = instructionsFor(agent, rules.files)
  const folders: readonly SkillFolder[] = skillFoldersFor(agent)
  const read = rules.skills.filter((each) => folders.includes(each.folder))
  const reach = pluginReach(agent)
  const cells = packages?.projects[project]?.cells ?? {}
  const plugins =
    reach === 'servers' ? [] : (packages?.packages ?? []).filter((each) => each.kind === 'plugin' && each.extras && cells[each.name]?.enabled === true)
  const skills = [...new Set(read.flatMap((each) => each.names))].sort()
  return {
    files,
    unread: rules.files.filter((file) => !files.includes(file)),
    passed: fallbackPassed(agent, files),
    prompts,
    skills,
    missed: rules.skills.filter((each) => !folders.includes(each.folder)),
    packages: plugins.map((each) => ({ name: each.name, hooks: reach === 'all' })),
    none: files.length === 0 && !prompts.shared && !prompts.project && skills.length === 0,
  }
}
