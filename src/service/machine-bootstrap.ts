import { type AccountHome } from '../account/homes.js'
import { saveLedger, type AccountLedger } from '../account/ledger.js'
import { providerUrl } from '../account/network.js'
import { KEY_SPEND_POLL_MS, KEY_SPEND_TAIL_MS, KEY_SPEND_TIMEOUT_MS } from '../account/service-defaults.js'
import { AccountSettings, loadAccountSettings, saveAccountSettings } from '../account/settingsLayer.js'
import { KeySpend, readOpenRouterKey, saveKeySpend } from '../account/spend.js'
import { copies } from '../agent/copies.js'
import { plainProjects, projectLabel } from '../config.js'
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
import { setStateValue, stateValue } from '../storage/service-state.js'
import { createSessionSettings } from '../tools/sessionSettings.js'

export function assembleKeySpend(ctx: Pick<ServiceContext, 'homes' | 'account' | 'writes' | 'db'>) {
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
    onSpend: (growth) => ctx.writes.add(`the key spend of session ${growth.sessionId}`, saveKeySpend(ctx.db, growth)),
    now: () => Date.now(),
    tailMs: KEY_SPEND_TAIL_MS,
    pollMs: KEY_SPEND_POLL_MS,
  })
}

export async function assembleCliCopies(ctx: Pick<ServiceContext, 'runtimes' | 'configStore' | 'dispatcher' | 'stateChanged' | 'account' | 'cliVersions' | 'db' | 'writes'>) {
  return copies(ctx.runtimes, (name, source) => ctx.configStore.saveCli(name, source), (name) => ctx.configStore.fallBackCli(name),
    () => { ctx.dispatcher.check(); ctx.stateChanged(); void ctx.account.refresh() },
    async () => { await ctx.cliVersions.check(); await ctx.account.refresh() },
    {
      downloaded: ((await stateValue(ctx.db, 'cli.downloaded')) as string[] | undefined) ?? [],
      remember: (downloaded) => ctx.writes.add('the providers with a downloaded CLI copy', setStateValue(ctx.db, 'cli.downloaded', downloaded)),
    })
}

export function assembleGitFound(ctx: Pick<ServiceContext, 'configStore'>) {
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

export function assembleSettingsFor(ctx: Pick<ServiceContext, 'configStore' | 'packages' | 'homes' | 'dispatcher' | 'projectOf'>) {
  return createSessionSettings({ config: () => ctx.configStore.current, packages: ctx.packages, globalDir: ctx.homes.global.dir, trim: () => ctx.dispatcher.state.trimTools, projectOf: ctx.projectOf })
}

export function assembleApprovals(ctx: Pick<ServiceContext, 'configStore' | 'promptLanguage'>) {
  return new Approvals({ language: () => ctx.configStore.current.language ?? ctx.promptLanguage(), unattended: () => ctx.configStore.current.unattended })
}

export function assembleTranscriptWatch(ctx: Pick<ServiceContext, 'hub'>) {
  return new TranscriptWatch(
    (sessionId) => ctx.hub.signal('transcript', { sessionId }),
    (error) => console.error(`sessions: watching a transcript: ${error instanceof Error ? error.message : String(error)}`),
  )
}

export async function assembleAccountSettings(ctx: Pick<ServiceContext, 'db' | 'homes' | 'writes'>) {
  return new AccountSettings(await loadAccountSettings(ctx.db), ctx.homes.global.dir, (account, record) =>
    ctx.writes.add(`the settings of ${account}`, saveAccountSettings(ctx.db, account, record, new Date())))
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
