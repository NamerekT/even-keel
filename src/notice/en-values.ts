import type { CiKind } from '../ci/model.js'
import type { UpdateBlock } from '../updates/model.js'

export type ClaudeRecovery = { binary: string; configDir: string | null }

export const FORGES: Record<CiKind, string> = { github: 'GitHub', forgejo: 'Forgejo', gitlab: 'GitLab' }
/** Whose key an API account holds, by `keyProvider`. */
export const PROVIDER_NAMES: Record<string, string> = { anthropic: 'Anthropic', openai: 'OpenAI', openrouter: 'OpenRouter', github: 'GitHub' }
/** The agents of the account folders by their registry name, as their adapters' `title`. */
export const AGENT_NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', copilot: 'GitHub Copilot', demo: 'Demo' }

export type GitStep ='excludeFile' | 'addWorktree' | 'listRemotes' | 'listWorktrees' | 'listBranches' | 'readStatus' | 'countCommits' | 'addSlot' | 'clean' | 'switch'

export const list = (items: string[]) => items.join(', ')
/** The service's user and home in brackets, when known (`cloudErrorNotice`). */
export const whose = (p: { user: string; home: string }) => (p.user === '' ? '' : ` (${p.user}, ${p.home})`)
/** Bytes as whole megabytes, at least one decimal for less than ten. */
export const megabytes = (bytes: number) => {
  const value = bytes / 1024 / 1024
  return value >= 10 ? String(Math.round(value)) : String(Math.round(value * 10) / 10)
}
/** How many models of an account `chain.unknownModel` names; the rest are counted. */
export const MODELS_NAMED = 8

/** The short fields of a built-in tracker's task an edit checks one by one (`FieldEdit` of `src/builtin/store.ts`). */
export type BuiltinField = 'title' | 'status' | 'priority' | 'milestone' | 'parent' | 'description'
export const BUILTIN_FIELDS: Record<BuiltinField, string> = {
  title: 'title',
  status: 'status',
  priority: 'priority',
  milestone: 'milestone',
  parent: 'parent task',
  description: 'description',
}

/** Where a status move is set (BTN-554): its notices lead to that setting. */
export type MoveLevel = 'profile' | 'source'
export type MoveWhen = 'start' | 'review'

/** The status move settings as the page labels them. */
export const MOVE_LABELS: Record<MoveWhen | 'done', string> = { start: '“On task start”', review: '“On pull request”', done: '“On task completion”' }

export const GIT_STEPS: Record<GitStep, (subject: string) => string> = {
  excludeFile: () => 'find the exclude file of',
  addWorktree: (task) => `add the worktree of ${task} to`,
  listRemotes: () => 'list the remotes of',
  listWorktrees: () => 'list the worktrees of',
  listBranches: () => 'list the branches of',
  readStatus: () => 'read the status of',
  countCommits: (main) => `count the commits beyond ${main} in`,
  addSlot: () => 'add the slot to',
  clean: () => 'clean',
  switch: (branch) => `switch to ${branch} in`,
}

export const UPDATE_BLOCKS: Record<UpdateBlock | 'storage', string> = {
  service: 'Even Keel does not run as a service here, so nothing could restart it',
  git: 'the folder of Even Keel is not a git checkout',
  dirty: 'the checkout has uncommitted changes',
  tag: 'the checkout is not on the release tag of the installed version',
  global: 'the npm package is not a global install (npm install --global)',
  checking: 'the checkout is still being read; try again in a moment',
  storage: 'the previous version cannot read the storage this one migrated',
}

