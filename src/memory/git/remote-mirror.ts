import { existsSync } from 'node:fs'
import { runGit } from '../../git/run.js'
import type { Git } from '../../git/types.js'
import { notice, type Notice } from '../../notice/notice.js'
import { MEMORY_BRANCH } from './sync.js'

export interface RemoteMirrorDeps {
  /** The `memoryMirror` setting now: any address git pushes to; `null` — no mirror. */
  address(): string | null
  /** The project's bare repository on the hub. */
  repositoryOf(project: string): string
  /** The projects whose repositories the mirror keeps: all of them go at a new address. */
  projects(): string[]
  log(line: string): void
  git?: Git
}

/**
 * The hub's memory repositories copied to one remote repository (BTN-1649, `docs/sessions/memory.md`), so the memory
 * outlives the hub: each project's `main` into the branch named by its id. A push follows every push into a project's
 * repository and never holds it: a failed one is logged once and the next push carries what was missed. The branch
 * only moves forward: one that has commits the hub's repository lacks is left as it is.
 */
export class RemoteMirror {
  private readonly git: Git
  private readonly current = new Map<string, Promise<void>>()
  private readonly queued = new Map<string, Promise<void>>()
  /** The last failure logged per project, so a mirror that stays down is not logged at every push. */
  private readonly failing = new Map<string, string>()
  private applied: string | null | undefined

  constructor(private readonly deps: RemoteMirrorDeps) {
    this.git = deps.git ?? runGit
  }

  /** The project's repository to the mirror, after the push running for it; calls meanwhile share the one queued. */
  push(project: string): Promise<void> {
    const queued = this.queued.get(project)
    if (queued !== undefined) return queued
    const next = (this.current.get(project) ?? Promise.resolve()).then(() => {
      this.queued.delete(project)
      return this.pushNow(project)
    })
    this.queued.set(project, next)
    this.current.set(project, next)
    return next
  }

  /** The setting as it is now: at the first call and at a new address every project's repository goes to the mirror. */
  apply(): Promise<unknown> {
    const address = this.deps.address()
    if (address === this.applied) return Promise.resolve()
    this.applied = address
    this.failing.clear()
    if (address === null) return Promise.resolve()
    return Promise.allSettled(this.deps.projects().map((project) => this.push(project)))
  }

  /** The page's warning while a mirror is set: Even Keel cannot tell whether the repository is private. */
  view(): Notice | null {
    const address = this.deps.address()
    return address === null ? null : notice('memory.mirrorPrivate', { address })
  }

  private async pushNow(project: string): Promise<void> {
    const address = this.deps.address()
    const repository = this.deps.repositoryOf(project)
    if (address === null || address.startsWith('-') || !existsSync(repository)) return
    const head = `refs/heads/${MEMORY_BRANCH}`
    if ((await this.git(repository, ['rev-parse', '--verify', '-q', head])).code !== 0) return
    // No credential prompt: the service has nobody to answer it, and a credential manager's window would wait forever.
    const pushed = await this.git(repository, ['push', '-q', address, `${head}:refs/heads/${project}`], { GCM_INTERACTIVE: 'never' })
    if (pushed.code === 0) {
      if (this.failing.delete(project)) this.deps.log(`memory: ${project} reached the mirror again`)
      return
    }
    const line = /\[rejected\]|fetch first|non-fast-forward/.test(pushed.out)
      ? `memory: the mirror's branch ${project} has commits the hub's repository lacks: it is left as it is`
      : `memory: ${project} cannot push to the mirror, tried again at its next push: ${pushed.out.split('\n')[0]}`
    if (this.failing.get(project) === line) return
    this.failing.set(project, line)
    this.deps.log(line)
  }
}
