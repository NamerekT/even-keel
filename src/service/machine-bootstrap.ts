import { type AccountHome } from '../account/homes.js'
import { saveLedger, type AccountLedger } from '../account/ledger.js'
import { providerUrl } from '../account/network.js'
import { KEY_SPEND_POLL_MS, KEY_SPEND_TAIL_MS, KEY_SPEND_TIMEOUT_MS } from '../account/service-defaults.js'
import { AccountSettings, loadAccountSettings, saveAccountSettings } from '../account/settingsLayer.js'
import { KeySpend, readOpenRouterKey } from '../account/spend.js'
import { SPEND_EVENT } from '../machine/records.js'
import type { MachineContext } from './machine-context.js'
import { AGENTS } from '../agent/adapters.js'
import { CLI_INSTALL_TIMEOUT_MS, CliInstaller } from '../agent/cli-installer.js'
import { copies } from '../agent/copies.js'
import { installableClis, writableFolder } from '../agent/installable.js'
import { forgetNpmBinaries } from '../agent/npm-global.js'
import { inContainer } from '../locations.js'
import { plainProjects, projectLabel, type EvenKeelConfig } from '../config.js'
import { runGit } from '../git/run.js'
import { gitSetup } from '../git/setup.js'
import { fail } from '../notice/notice.js'
import { keyVendor } from '../opencode/home.js'
import { OPENCODE } from '../opencode/name.js'
import { GitFound } from '../projects/git-found.js'
import type { ServiceContext } from '../service.js'
import { Approvals } from '../sessions/approvals.js'
import { type WarmTask } from '../sessions/keepwarm.js'
import { TranscriptWatch } from '../sessions/watch.js'
import type { SessionView } from '../state.js'
import { machineValue, setMachineValue } from '../machine/state.js'

export function assembleKeySpend(ctx: Pick<MachineContext, 'homes' | 'account' | 'writes' | 'tell'>) {
  return new KeySpend({
    metered: (key) => {
      const home = ctx.homes.find(key)
      if (home === undefined || home.agent !== OPENCODE || home.global) return false
      const apiKey = ctx.homes.apiKeyOf(home)
      return apiKey !== null && keyVendor(apiKey) === 'openrouter'
    },
    read: async (key) => {
      const home = ctx.homes.find(key)
      const apiKey = home === undefined ? null : ctx.homes.apiKeyOf(home)
      ctx.account.readBalance(key).catch((error: unknown) => console.error(`account: the balance of ${key}: ${error instanceof Error ? error.message : String(error)}`))
      const read = apiKey === null ? null : await readOpenRouterKey(apiKey, KEY_SPEND_TIMEOUT_MS)
      if (read !== null) ctx.account.noteKeyLimit(key, read.limit)
      return read?.usage ?? null
    },
    onSpend: (growth) => ctx.writes.add(`the key spend of session ${growth.sessionId}`, ctx.tell.record(SPEND_EVENT, growth)),
    now: () => Date.now(),
    tailMs: KEY_SPEND_TAIL_MS,
    pollMs: KEY_SPEND_POLL_MS,
  })
}

/** The agents whose CLI the service's user can install on this machine: none in a container, whose CLIs come as copies. */
function installableHere(ctx: Pick<MachineContext, 'runtimes'>): string[] {
  return installableClis([...ctx.runtimes.keys()], { container: inContainer, env: process.env, execPath: process.execPath, platform: process.platform, writable: writableFolder })
}

/**
 * The page's "Install" of an agent's CLI (BTN-1502): its official installer as the service's user, then the CLIs looked
 * for again, so the panel's versions and the machine's report show it without a restart.
 */
export function assembleCliInstaller(ctx: Pick<MachineContext, 'runtimes' | 'machineChanged' | 'account' | 'cliVersions'>): CliInstaller {
  let installable: string[] | undefined
  return new CliInstaller({
    platform: process.platform,
    installable: () => (installable ??= installableHere(ctx)),
    title: (agent) => AGENTS[agent]?.title ?? agent,
    env: () => process.env,
    execPath: process.execPath,
    timeoutMs: CLI_INSTALL_TIMEOUT_MS,
    onChange: () => ctx.machineChanged(),
    onEnd: async () => {
      forgetNpmBinaries()
      await ctx.cliVersions.check()
      await ctx.account.refresh()
    },
    log: (line) => console.log(line),
    now: () => new Date(),
  })
}

export async function assembleCliCopies(ctx: Pick<MachineContext, 'runtimes' | 'configStore' | 'machineChanged' | 'account' | 'cliVersions' | 'machineDb' | 'writes' | 'brief'>) {
  const installable = installableHere(ctx)
  return copies(ctx.runtimes, (name, source) => ctx.configStore.saveCli(name, source), (name) => ctx.configStore.fallBackCli(name),
    () => { ctx.machineChanged(); void ctx.account.refresh() },
    async () => { await ctx.cliVersions.check(); await ctx.account.refresh() },
    {
      downloaded: ((await machineValue(ctx.machineDb, 'cli.downloaded')) as string[] | undefined) ?? [],
      remember: (downloaded) => ctx.writes.add('the providers with a downloaded CLI copy', setMachineValue(ctx.machineDb, 'cli.downloaded', downloaded)),
      hub: () => ctx.brief.cliConsent(),
    },
    (name) => installable.includes(name))
}

export function assembleGitFound(ctx: { configStore: { readonly current: EvenKeelConfig } }) {
  return new GitFound({
    git: runGit,
    gitStarts: () => (gitSetup.view()?.version ?? null) !== null,
    folders: () => plainProjects(ctx.configStore.current),
    label: (project) => projectLabel(ctx.configStore.current, project),
  })
}

export function assembleHomeOf(ctx: Pick<ServiceContext, 'homes'>) {
  return (key: string): AccountHome => {
    const home = ctx.homes.find(key)
    if (home === undefined) throw fail('account.homeGone', { key })
    return home
  }
}

export function assembleOnline(ctx: Pick<ServiceContext, 'reach' | 'homes'>) {
  return (home: AccountHome) => ctx.reach.up(providerUrl(home.agent, home.agent === OPENCODE ? ctx.homes.apiKeyOf(home) : null))
}

export function assembleWarmable(ctx: Pick<ServiceContext, 'liveView' | 'monitor' | 'agentOf' | 'homeOf'>) {
  return ({ task, sessionId }: WarmTask): SessionView | undefined => {
    const view = ctx.liveView(task)
    if (view === undefined || (sessionId !== null && view.sessionId !== sessionId)) return undefined
    const session = ctx.monitor.handoff(task)
    return session?.sessionId === view.sessionId && ctx.agentOf(ctx.homeOf(session.account)).warm !== undefined ? view : undefined
  }
}

export function assembleApprovals(ctx: Pick<MachineContext, 'configStore' | 'promptLanguage'>) {
  return new Approvals({ language: () => ctx.configStore.current.language ?? ctx.promptLanguage(), unattended: () => ctx.configStore.current.unattended })
}

/** A change of a watched transcript goes to the hub as the link's event: the page is the hub's (`TRANSCRIPT_EVENT`). */
export function assembleTranscriptWatch(tell: (sessionId: string) => void) {
  return new TranscriptWatch(
    tell,
    (error) => console.error(`sessions: watching a transcript: ${error instanceof Error ? error.message : String(error)}`),
  )
}

export async function assembleAccountSettings(ctx: Pick<ServiceContext, 'machineDb' | 'homes' | 'writes'>) {
  return new AccountSettings(await loadAccountSettings(ctx.machineDb), ctx.homes.global.dir, (account, record) =>
    ctx.writes.add(`the settings of ${account}`, saveAccountSettings(ctx.machineDb, account, record, new Date())))
}

export function assembleClaudeConfigs(ctx: Pick<ServiceContext, 'claudeAccount' | 'homes'>) {
  return (account = ctx.claudeAccount()) =>
    [...new Set([ctx.homes.global, ctx.homes.find(account)].flatMap((home) => (home === undefined ? [] : [ctx.homes.configFile(home)])))]
}

export function assembleSaveAccounts(ctx: Pick<ServiceContext, 'ledger' | 'accountFile'>) {
  return (next: AccountLedger) => {
    ctx.ledger = next
    saveLedger(ctx.accountFile, ctx.ledger)
  }
}

/** The first answer `read` finds in any account folder. */
export function assembleInHomes(ctx: Pick<ServiceContext, 'homes'>) {
  return async <T>(read: (home: AccountHome) => Promise<T | undefined>): Promise<T | undefined> => {
    for (const home of ctx.homes.list()) {
      const found = await read(home)
      if (found !== undefined) return found
    }
    return undefined
  }
}

