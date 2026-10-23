import { CLAUDE } from '../claude/name.js'
import { CODEX } from '../codex/name.js'
import { COPILOT } from '../copilot/name.js'
import { OPENCODE } from '../opencode/name.js'

// What of a repository's own rules reaches a session of each agent (BTN-340), checked live on Claude Code 2.1.309,
// codex-cli 0.164.0, OpenCode 1.18.25 and Copilot CLI 1.0.103 (`docs/sessions.md`). No node imports: the page reads it.

export type InstructionFile = 'CLAUDE.md' | 'AGENTS.md'

export const INSTRUCTION_FILES: readonly InstructionFile[] = ['CLAUDE.md', 'AGENTS.md']

/** The folders of a repository that hold skills, one skill per subfolder with its `SKILL.md`. */
export const SKILL_FOLDERS = ['.claude/skills', '.agents/skills', '.codex/skills', '.github/skills', '.opencode/skills'] as const

export type SkillFolder = (typeof SKILL_FOLDERS)[number]

/** What of a Claude Code plugin package reaches the agent's sessions besides its MCP servers. */
export type PluginReach = 'all' | 'skills' | 'servers'

interface Reads {
  /** The file the agent reads by itself when both are there; `null` — both. */
  own: InstructionFile | null
  /** Even Keel, not the agent, gives it the other file when it is the only one. */
  fallbackPassed: boolean
  /** The skill folders it reads by itself. */
  skills: readonly SkillFolder[]
  /** The skill folders Even Keel passes to it (OpenCode's `skills.paths`). */
  passed: readonly SkillFolder[]
  /** Copilot takes a plugin's folder as Claude Code does; OpenCode its skills folder only. */
  plugins: PluginReach
}

// A lone file reaches every agent: Codex and OpenCode take CLAUDE.md without an AGENTS.md (Codex by Even Keel's
// `project_doc_fallback_filenames`), Claude Code gets a lone AGENTS.md appended to its system prompt by Even Keel.
const READS: Record<string, Reads> = {
  [CLAUDE]: { own: 'CLAUDE.md', fallbackPassed: true, skills: ['.claude/skills'], passed: [], plugins: 'all' },
  [CODEX]: { own: 'AGENTS.md', fallbackPassed: true, skills: ['.agents/skills', '.codex/skills'], passed: [], plugins: 'all' },
  [OPENCODE]: { own: 'AGENTS.md', fallbackPassed: false, skills: ['.opencode/skills'], passed: ['.claude/skills', '.agents/skills'], plugins: 'skills' },
  [COPILOT]: { own: null, fallbackPassed: false, skills: ['.github/skills', '.agents/skills', '.claude/skills'], passed: [], plugins: 'all' },
}

/** What of a plugin package the agent's sessions get; an agent outside the table — its servers only. */
export function pluginReach(agent: string): PluginReach {
  return READS[agent]?.plugins ?? 'servers'
}

/** Whether the one file a session of the agent reads is given by Even Keel, not found by the agent itself. */
export function fallbackPassed(agent: string, files: readonly InstructionFile[]): boolean {
  const reads = READS[agent]
  return reads?.fallbackPassed === true && files.length === 1 && files[0] !== reads.own
}

/** The instruction files of `files` a session of the agent gets; an agent outside the table — its own guess, nothing. */
export function instructionsFor(agent: string, files: readonly InstructionFile[]): InstructionFile[] {
  const reads = READS[agent]
  if (reads === undefined) return []
  if (reads.own === null || files.length < 2) return [...files]
  return files.filter((file) => file === reads.own)
}

/** The skill folders of the repository a session of the agent gets, Even Keel's passed ones included. */
export function skillFoldersFor(agent: string): SkillFolder[] {
  const reads = READS[agent]
  return reads === undefined ? [] : [...reads.skills, ...reads.passed]
}

/** The skill folders Even Keel passes to the agent's sessions itself, since the agent does not read them. */
export function passedSkillFolders(agent: string): readonly SkillFolder[] {
  return READS[agent]?.passed ?? []
}

/** The rules a project's branch holds for its sessions: its instruction files and skills, as committed. */
export interface RepoRules {
  files: InstructionFile[]
  skills: { folder: SkillFolder; names: string[] }[]
}

/** The rules among a branch's file paths (`git ls-tree -r --name-only`, `/`-separated). */
export function repoRulesOf(paths: readonly string[]): RepoRules {
  const files = INSTRUCTION_FILES.filter((file) => paths.includes(file))
  const skills = SKILL_FOLDERS.flatMap((folder) => {
    const names = paths.flatMap((path) => {
      const rest = path.startsWith(`${folder}/`) ? path.slice(folder.length + 1).split('/') : []
      return rest.length === 2 && rest[1] === 'SKILL.md' ? [rest[0]!] : []
    })
    return names.length === 0 ? [] : [{ folder, names: names.sort() }]
  })
  return { files, skills }
}
