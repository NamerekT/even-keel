import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { AccountHome } from '../../src/account/homes.js'
import type { Source } from './load.js'

export async function transcriptFiles(homes: AccountHome[]): Promise<Source[]> {
  const sources: Source[] = []
  for (const home of homes) {
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
