import type { HubBuild, MachineFollow, MachineSignIn } from '../link/view.js'
import type { MachineServices } from '../machine/services.js'
import { fail } from '../notice/notice.js'
import type { NetworkHost } from './machine-network-options.js'
import { machineAccountOf } from './machine-page.js'

/**
 * Each machine elsewhere's accounts and its sign-in under way, as its last post showed them (BTN-1245): what the hub's
 * page offers to sign in to there. Only the panel's names and states: the credentials never leave the machine.
 */
export function signIns(host: NetworkHost): MachineSignIn[] {
  return [...host.peers].flatMap(([machine, peer]) => {
    const panel = peer.remote.page.panel()
    if (panel === undefined) return []
    const { login } = panel
    const { polled, differs } = host.options
    const polls = polled === undefined ? undefined : { panel: panel.accounts, identities: peer.remote.facts()?.identities, polled, ...(differs !== undefined && { differs }) }
    return [{
      machine,
      name: peer.name,
      online: host.hub.connected(machine),
      accounts: panel.accounts.map((entry) => machineAccountOf(entry, polls)),
      ...(panel.active !== '' && { active: panel.active }),
      login: login === null ? null : {
        agent: login.agent,
        ...(login.method !== undefined && { method: login.method }),
        target: login.target,
        startedAt: login.startedAt,
        urls: login.urls,
        deviceCode: login.deviceCode,
        output: login.output,
        error: login.error,
        codeSent: login.codeSent,
      },
      missing: panel.missing,
      ...(panel.globals !== undefined && panel.globals.length > 0 && { globals: panel.globals }),
      ...(panel.installs !== undefined && { installs: panel.installs }),
      ...(panel.install !== undefined && { install: panel.install }),
    }]
  })
}

/**
 * Starts a sign-in on the machine through its CLI (`docs/machines/machine-side.md`, "Signing in on a machine"): again in its folder
 * `account` when it has one, else in a new folder named after the account signed in. The link and the code go
 * through the hub; the token the CLI gets stays in the machine's folder.
 */
export async function login(host: NetworkHost, machine: string, agent: string, account?: string, method?: string): Promise<void> {
  const control = await accountsOf(host, machine)
  const has = account !== undefined && host.peers.get(machine)?.remote.page.panel()?.accounts.some((entry) => entry.key === account) === true
  host.options.log(`machines: a sign-in of ${agent} is started on machine ${machine}${has ? ` in its folder ${account}` : ''}`)
  if (has) await control.renew(account)
  else await control.add(agent, method)
}

/**
 * The machine's CLI folder of `agent` that is signed in but not added becomes its account (BTN-1568). It uses that
 * folder's own sign-in, so there is no new one. The machine checks the sign-in again and applies its own rules, as
 * `account/global` on the hub does.
 */
export async function useGlobal(host: NetworkHost, machine: string, agent: string): Promise<void> {
  const offered = host.peers.get(machine)?.remote.page.panel()?.globals?.some((each) => each.agent === agent) === true
  const control = await accountsOf(host, machine)
  if (!offered) throw fail('account.unknown', { key: agent })
  host.options.log(`machines: the CLI folder of ${agent} is added on machine ${machine}`)
  await control.useGlobal(agent)
}

/**
 * A Claude folder on the machine signed in with a long token of `claude setup-token` (BTN-1002), tied to the hub's
 * folder `account`'s claude.ai account, so the hub hands it that account's limits. The token passes through the hub
 * only as the command's payload and is not logged; the machine checks it with one short turn.
 */
export async function token(host: NetworkHost, machine: string, account: string, token: string, name = ''): Promise<void> {
  const of = host.options.hubAccount?.(account)
  if (of === undefined) throw fail('account.unknown', { key: account })
  const control = await accountsOf(host, machine)
  host.options.log(`machines: a long token of ${of.email ?? of.account} is added on machine ${machine}`)
  await control.addLongToken(name, token, null, of)
}

/**
 * The machine signed in on the long token the hub's folder `from` runs on (BTN-1501), in a folder of the same name:
 * the page names only the folder, the token goes from the hub's folder into the command's payload as `token`'s does.
 * Tied to the account the hub's folder was said to be of — its full sign-in `sameAs`, else the account its token file
 * names; neither — none, and the machine finds its folder by that name (BTN-1512).
 */
export async function sharedToken(host: NetworkHost, machine: string, from: string): Promise<void> {
  const held = host.options.hubLongToken?.(from)
  if (held === undefined) throw fail('account.unknown', { key: from })
  const of = (held.sameAs === undefined ? undefined : host.options.hubAccount?.(held.sameAs)) ?? held.account ?? null
  const control = await accountsOf(host, machine)
  host.options.log(`machines: the long token of the hub's folder ${from} is added on machine ${machine}`)
  await control.addLongToken(from, held.token, null, of)
}

/** The code the person got on the sign-in page, for the machine's CLI waiting for it; it is not logged. */
export async function code(host: NetworkHost, machine: string, code: string): Promise<void> {
  await (await accountsOf(host, machine)).code(code)
}

export async function cancel(host: NetworkHost, machine: string): Promise<void> {
  await (await accountsOf(host, machine)).cancel()
}

/** The agent's official installer on the machine (BTN-1502); its output comes back in the machine's panel. */
export async function installCli(host: NetworkHost, machine: string, agent: string): Promise<void> {
  host.options.log(`machines: the CLI of ${agent} is installed on machine ${machine}`)
  await (await accountsOf(host, machine)).installCli(agent)
}

export async function checkClis(host: NetworkHost, machine: string): Promise<void> {
  await (await accountsOf(host, machine)).checkClis()
}

/**
 * Git's `user.name` and `user.email` written on the machine (BTN-1503): its report takes what git read back there at
 * once, so its facts and its cards change without waiting for its next handshake, which reports the same.
 */
export async function gitIdentity(host: NetworkHost, machine: string, name: string, email: string): Promise<void> {
  const record = await host.foreign(machine)
  const read = await (await servicesOf(host, machine)).git.identity(name, email)
  host.options.log(`machines: git's name and e-mail are set on machine ${record.id} (${record.name})`)
  const about = (await host.options.store.machine(record.id))?.about ?? record.about
  if (about !== null) {
    const { gitName: _name, gitEmail: _email, ...rest } = about
    await host.options.store.described(record.id, {
      ...rest,
      gitUser: read.name !== null && read.email !== null,
      ...(read.name !== null && { gitName: read.name }),
      ...(read.email !== null && { gitEmail: read.email }),
    })
  }
  host.options.changed()
}

/**
 * The machine's update to the hub's build (BTN-1609, `update.follow`): `null` — it moves; what keeps it where it is
 * goes into its report at once, as its next handshake would bring it.
 */
export async function follow(host: NetworkHost, machine: string, build: HubBuild, force: boolean): Promise<MachineFollow | null> {
  const answer = await (await servicesOf(host, machine)).update.follow(build, force)
  if (answer !== null) {
    const about = (await host.options.store.machine(machine))?.about ?? null
    if (about !== null) await host.options.store.described(machine, { ...about, follow: answer })
    host.options.changed()
  }
  return answer
}

export async function accountsOf(host: NetworkHost, machine: string): Promise<MachineServices['account']> {
  return (await servicesOf(host, machine)).account
}

async function servicesOf(host: NetworkHost, machine: string): Promise<MachineServices> {
  const record = await host.foreign(machine)
  const peer = host.peers.get(record.id)
  // Its answers come no sooner than its state: a call would wait for good (BTN-1560).
  if (host.tooLarge.has(record.id)) throw fail('machines.tooLarge', { name: record.name })
  if (peer === undefined || !host.hub.connected(record.id)) throw fail('machines.offline', { name: record.name })
  return peer.remote.services()
}
