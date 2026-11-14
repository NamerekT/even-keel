import { FORGES } from './en-values.js'
import type { NoticeAdvice } from './notice.js'

/**
 * What to do about a message, apart from what happened (BTN-1149): a chain of causes shows one advice, the deepest
 * notice's that has one, so a wrapper's is only for a cause without its own. A code not here says it all in its text.
 */
export const ADVICE = {
  'chain.unchangedNotChecked': () => 'answer its session from the chat, or skip the task',
  'chain.unchangedNotCompleted': () => 'move it there yourself and resume the chain, or skip the task',
  'review.notOpened': () => 'fix access and press Resume, answer its session from the chat, or skip the task',
  'review.notCompleted': () => 'move it there yourself and resume the chain, or skip the task',
  'review.noNote': (p) => (p.reason === undefined ? undefined : 'write a safe note in the task folder, mark again and press Resume'),
  'review.noBranch': () => "check out the task's branch there and press Resume, or skip the task",
  'review.dirty': () => 'commit or remove them and press Resume, answer its session from the chat, or skip the task',
  'review.notReady': () => 'fix that and the chain goes on by itself within a minute, or turn PR mode off',
  'review.noToken': (p) => `add a ${FORGES[p.kind]} profile for its host`,
  'accept.notChecked': () => 'try again in a moment',
  'accept.notCompleted': () => 'try again, or close it in the tracker yourself',
  'task.relabelFailed': () => "check the tracker profile's permission to edit issues and labels, then try again",
  'codex.hooksUntrusted': () => 'update Even Keel, or for now run the task on another provider',
  'copilot.binaryMissing': () => "set Copilot's CLI version to Checked in Settings → Providers and models, then resume the chain",
  'chain.noTrackerMcp': () => 'turn on a package with it or the description, and the chain goes on by itself',
  'changelog.unnoticed': () => 'if a task does change something for users, say what in its closing comment and press "Write again"',
  'storage.newer': () => 'put back its *.bak copy or update Even Keel',
  'storage.held': () => 'wait for it to finish or close the other Even Keel instance',
  'storage.newerDatabase': () => 'update Even Keel',
  'packages.port': () => "set another EVEN_KEEL_MCP_PORT in Even Keel's .env",
  'packages.marketplaceCliMissing': () => 'install it, then add the marketplace again on Accounts',
} satisfies NoticeAdvice
