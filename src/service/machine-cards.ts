import type { AccountView } from '../account/model.js'
import { MACHINE_PALETTE } from '../link/colors.js'
import type { MachineRecord } from '../link/hub-store.js'
import type { MachineCard, MachineCardAccount } from '../link/view.js'
import { currentLimits, exhaustedReset, type RateLimits } from '../limits/model.js'
import type { RemoteMachine } from '../machine/remote.js'
import { machineAccountOf } from './machine-page.js'
import { buildGap } from './machine-updates.js'

export interface MachineCardsDeps {
  own: () => string
  records: () => Promise<MachineRecord[]>
  online: (machine: string) => boolean
  /** When the hub saw the machine go off the link; `undefined` — not since it started. */
  offlineSince: (machine: string) => number | undefined
  colors: () => Record<string, string>
  folders: (machine: string) => Promise<Array<{ project: string; folder: string; enabled: boolean }>>
  mirror: (machine: string) => Pick<RemoteMachine, 'facts' | 'page'> | undefined
  /** The own machine's accounts panel, with the limits it read. */
  ownAccounts: () => Pick<AccountView, 'accounts' | 'active'>
  /** Git's name and e-mail on the own machine, the hub's (`null` each — unset); `null` — not read yet. */
  ownGit: () => { name: string | null; email: string | null } | null
  /** The hub's version of Even Keel. */
  version: string
  now: () => number
}

/**
 * Every machine for the header's machines panel (BTN-1051, query `machines/cards`): the own one first, then the joined
 * ones not revoked in the hub's order. A machine elsewhere's accounts and packages come from its mirror: empty before
 * its first snapshot since the hub started.
 */
export async function machineCards(deps: MachineCardsDeps): Promise<MachineCard[]> {
  const own = deps.own()
  const records = (await deps.records()).filter((record) => record.revokedAt === null && (record.id === own || record.joinedAt !== null))
  const ordered = [...records.filter((record) => record.id === own), ...records.filter((record) => record.id !== own)]
  const colors = deps.colors()
  const now = new Date(deps.now())
  return Promise.all(ordered.map(async (record): Promise<MachineCard> => {
    const isOwn = record.id === own
    const mirror = isOwn ? undefined : deps.mirror(record.id)
    const facts = mirror?.facts()
    const panel = isOwn ? deps.ownAccounts() : mirror?.page.panel()
    const accounts = (panel?.accounts ?? []).map((entry): MachineCardAccount => ({
      ...machineAccountOf(entry),
      name: entry.name ?? null,
      limits: isOwn ? entry.limits : mirror!.page.limits(entry.key),
      ...(entry.sessions !== undefined && entry.sessions.length > 0 && { sessions: entry.sessions }),
      ...(entry.transport !== undefined && { transport: entry.transport }),
    }))
    const online = isOwn || deps.online(record.id)
    const ownGit = isOwn ? deps.ownGit() : null
    const git = isOwn
      ? { name: ownGit?.name ?? undefined, email: ownGit?.email ?? undefined, user: ownGit === null ? null : ownGit.name !== null && ownGit.email !== null }
      : { name: record.about?.gitName, email: record.about?.gitEmail, user: record.about?.gitUser ?? null }
    return {
      id: record.id,
      name: record.name,
      color: colors[record.id] ?? MACHINE_PALETTE[0]!,
      own: isOwn,
      online,
      offlineSince: online ? null : (deps.offlineSince(record.id) ?? null),
      gitUser: git.user,
      ...(git.name !== undefined && { gitName: git.name }),
      ...(git.email !== undefined && { gitEmail: git.email }),
      ...(!isOwn && record.about !== null && buildGap({ evenKeel: deps.version }, record.about) === 'protocol' && { otherBuild: record.about.evenKeel }),
      ...limitedOf(accounts.filter((account) => account.signedIn), now),
      accounts,
      active: panel?.active || null,
      projects: (await deps.folders(record.id)).map((row) => {
        const project = facts?.projects[row.project]
        const pause = project?.packagesPause
        return {
          project: row.project,
          enabled: row.enabled,
          packagesBlocked: project?.packagesBlocked === true,
          packagesUnready: pause?.code === 'chain.packagesNotReady' ? pause.params.packages : [],
          trackerMissing: project?.trackerMissing ?? null,
        }
      }),
    }
  }))
}

/** The agents signed in there, and each one whose every account is spent with the soonest of their resets. */
function limitedOf(accounts: Array<{ agent: string; limits: RateLimits | null }>, now: Date): Pick<MachineCard, 'agents' | 'limitedUntil'> {
  const agents = [...new Set(accounts.map((account) => account.agent))]
  const limitedUntil: Record<string, string> = {}
  for (const agent of agents) {
    const resets = accounts.filter((account) => account.agent === agent).map((account) => exhaustedReset(currentLimits(account.limits ?? undefined, now)))
    if (resets.every((reset) => reset !== null)) limitedUntil[agent] = [...(resets as string[])].sort()[0]!
  }
  return { agents, limitedUntil }
}
