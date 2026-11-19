import { AsyncLocalStorage } from 'node:async_hooks'
import type { ChangeAuthor } from './history.js'

const current = new AsyncLocalStorage<ChangeAuthor>()

/**
 * Runs `work` with its tracker writes recorded as `author`'s (BTN-1112): the tasks server runs an agent's call so, and a
 * tracker that keeps its own history (the built-in one) names the agent and its model whatever wraps its editor.
 */
export function writingAs<T>(author: ChangeAuthor, work: () => T): T {
  return current.run(author, work)
}

/** The author `writingAs` set for the call in progress; `undefined` — none. */
export function writingAuthor(): ChangeAuthor | undefined {
  return current.getStore()
}
