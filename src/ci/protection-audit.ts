import type { EvenKeelConfig } from '../config.js'
import { createHash } from 'node:crypto'
import type { Git } from '../git/types.js'
import { branchProtection } from './protection.js'
import type { RemoteProtection } from './protection-model.js'
import { parseRemote, remoteKind, remotesOf, type CiTarget } from './remote.js'

interface AuditDeps {
  config: () => EvenKeelConfig
  git: Git
  token: (project: string, target: CiTarget) => string | null
  gitlabUrls: () => string[]
  changed: () => void
}

/** One read per launch, at most once in five minutes for an unchanged branch and set of remote profiles. */
export class ProtectionAudit {
  readonly view: Record<string, RemoteProtection[]> = {}
  private checked = new Map<string, { key: string; at: number }>()
  private pending = new Map<string, Promise<void>>()
  constructor(private readonly deps: AuditDeps) {}

  check(project: string): Promise<void> {
    const active = this.pending.get(project)
    if (active !== undefined) return active
    const job = this.read(project).catch(() => {
      this.view[project] = (this.view[project] ?? []).map(item => ({ ...item, status: 'unknown' }))
      this.deps.changed()
    }).finally(() => this.pending.delete(project))
    this.pending.set(project, job)
    return job
  }

  private async read(project: string): Promise<void> {
    const config = this.deps.config()
    const repo = config.projects[project]
    const settings = config.settings[project]
    if (repo === undefined || settings === undefined) return
    const result = await this.deps.git(repo, ['config', '--get-regexp', '^remote\\..*\\.url$'])
    if (result.code !== 0 && result.code !== 1) return
    const targets = remotesOf(result.out).flatMap<CiTarget>(remote => {
      const parsed = parseRemote(remote.url)
      if (parsed === null) return []
      const kind = remoteKind(parsed.host, this.deps.gitlabUrls())
      return kind === null ? [] : [{ ...parsed, kind, remote: remote.name }]
    })
    const tokens = targets.map(target => this.deps.token(project, target))
    const key = JSON.stringify([repo, settings.branch, targets, settings.remoteProfiles, tokens.map(token => token === null ? null : createHash('sha256').update(token).digest('hex'))])
    const previous = this.checked.get(project)
    if (previous?.key === key && Date.now() - previous.at < 300_000) return
    this.view[project] = await Promise.all(targets.map((target, index) => branchProtection(target, settings.branch, tokens[index]!)))
    this.checked.set(project, { key, at: Date.now() })
    this.deps.changed()
  }
}
