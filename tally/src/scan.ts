import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AccountHome } from '../../src/account/homes.js'
import { CODEX } from '../../src/codex/name.js'
import type { Source } from './load.js'
import { rolloutSession } from './rollout.js'

const ROLLOUT_DIRS = ['sessions', 'archived_sessions']

export async function transcriptFiles(homes: AccountHome[]): Promise<Source[]> {
  const sources: Source[] = []
  for (const home of homes) {
    if (home.agent === CODEX) continue
    const projects = join(home.dir, 'projects')
    for (const project of await folders(projects)) {
      const dir = join(projects, project)
      for (const entry of await entries(dir)) {
        if (entry.isFile() && entry.name.endsWith('.jsonl')) sources.push({ path: join(dir, entry.name), account: home.key })
        if (!entry.isDirectory()) continue
        const subagents = join(dir, entry.name, 'subagents')
        for (const agent of await entries(subagents)) {
          if (agent.isFile() && agent.name.endsWith('.jsonl')) sources.push({ path: join(subagents, agent.name), account: home.key })
        }
      }
    }
  }
  return sources
}

/** The rollouts of the Codex folders, plain and compressed, at any depth of `sessions/` and `archived_sessions/`. */
export async function rolloutFiles(homes: AccountHome[]): Promise<Source[]> {
  const sources: Source[] = []
  const walk = async (dir: string, account: string): Promise<void> => {
    for (const entry of await entries(dir)) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path, account)
      else if (entry.isFile() && rolloutSession(path) !== null) sources.push({ path, account })
    }
  }
  for (const home of homes) {
    if (home.agent !== CODEX) continue
    for (const dir of ROLLOUT_DIRS) await walk(join(home.dir, dir), home.key)
  }
  return sources
}

async function folders(dir: string): Promise<string[]> {
  return (await entries(dir)).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

async function entries(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}
