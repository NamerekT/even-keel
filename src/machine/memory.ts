import { sharedMemory } from '../account/share.js'
import type { GitAnswer, GitRequest } from '../link/protocol.js'
import { WorkingCopies } from '../memory/git/copies.js'
import { MemoryRelay } from '../memory/git/relay.js'
import type { MemorySyncDeps } from '../memory/git/sync.js'
import type { HubBrief } from './brief.js'

/** While the link is up the copies fetch this often, so another machine's edits come without an edit here. */
export const PULL_EVERY_MS = 10 * 60_000

/**
 * The memory folders a machine elsewhere keeps (BTN-1648): each project of its pool in its folder there, then the
 * folders the hub's owner bound to a project beyond the pool (`brief.memory`); `~/.claude-memory/<folder>` of each.
 */
export function machineMemoryFolders(brief: Pick<HubBrief, 'config' | 'memory'>, globalDir: string): Record<string, string[]> {
  const folders: Record<string, string[]> = {}
  const add = (project: string, folder: string) => {
    const memory = sharedMemory(globalDir, folder)
    const list = (folders[project] ??= [])
    if (!list.includes(memory)) list.push(memory)
  }
  for (const [project, folder] of Object.entries(brief.config.projects)) add(project, folder)
  for (const { project, folder } of brief.memory ?? []) add(project, folder)
  return folders
}

export interface MachineMemoryDeps {
  /** The hub's brief the machine holds, its own or kept from before; `undefined` — none yet: nothing is synced. */
  brief(): HubBrief | undefined
  globalDir: string
  send(project: string, request: GitRequest): Promise<GitAnswer | undefined>
  /** The link is up now: the copies' periodic fetch waits for it. */
  linked(): boolean
  author: string
  log(line: string): void
  git?: MemorySyncDeps['git']
}

/**
 * A machine's memory folders as working copies of the hub's repositories (`docs/sessions/memory.md`), reached through
 * its `MemoryRelay`. `apply` at every brief that changed; `online` at every reconnection: the commits made without
 * the link go then. The hub's own machine has none: its folders are the hub's copies (`MemoryHub`).
 */
export class MachineMemory {
  private readonly relay: MemoryRelay
  private readonly copies: WorkingCopies
  private pulling: ReturnType<typeof setInterval> | undefined
  private started = false

  constructor(private readonly deps: MachineMemoryDeps) {
    this.relay = new MemoryRelay({ send: deps.send, log: deps.log })
    this.copies = new WorkingCopies({
      folders: () => {
        const brief = deps.brief()
        return brief === undefined ? {} : machineMemoryFolders(brief, deps.globalDir)
      },
      remoteOf: (project) => this.relay.originOf(project),
      author: deps.author,
      log: deps.log,
      ...(deps.git !== undefined && { git: deps.git }),
    })
  }

  async start(): Promise<void> {
    await this.relay.start()
    this.started = true
    await this.copies.apply()
    this.pulling = setInterval(() => void (this.deps.linked() && this.copies.syncAll()), PULL_EVERY_MS)
    this.pulling.unref()
  }

  /** Before `start` nothing: the copies need the relay's address. */
  apply(): Promise<void> {
    return this.started ? this.copies.apply() : Promise.resolve()
  }

  /** The link is back: every copy syncs now. */
  online(): Promise<unknown> {
    return this.copies.syncAll()
  }

  async stop(): Promise<void> {
    clearInterval(this.pulling)
    this.copies.stop()
    await this.relay.close()
  }
}
