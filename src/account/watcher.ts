import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { Agent } from '../agent/contract.js'
import { NO_SIGN_IN, SIGN_INS } from '../agent/providers.js'
import type { RateLimits } from '../limits/model.js'
import type { UsageHealth } from '../limits/usage.js'
import { fail, notice, NoticeError, noticeOf, sameNotice, type Notice } from '../notice/notice.js'
import { appSwitchProblem, type AppAccount, type AppId } from './apps.js'
import { assertApiKey, keyProvider, type AccountHome, type AccountHomes } from './homes.js'
import { CreditChecks, type CreditVerdict } from './credit.js'
import { KeyChecks, type KeyLimit, type KeyVerdict } from './keycheck.js'
import type { BalanceVerdict } from './management.js'
import type { AccountSettings, EditChoice } from './settingsLayer.js'
import { CLAUDE } from '../claude/name.js'
import type { AwsProfiles, AzureCredentials, CloudConnection, CloudSummary, GcloudCredentials } from './cloud.js'
import { cloudErrorNotice, type Whose } from './cloud-errors.js'
import type { Transport } from './transport.js'
import {
  cleanOutput,
  isApiKey,
  loginBlockNotice,
  loginCode,
  loginUrls,
  missingNotice,
  needsLogin,
  paysPerToken,
  removeProblem,
  secondFreeProblem,
  switchProblem,
  takesShared,
  withIdentity,
  type AccountEntry,
  type AccountLogin,
  type AccountView,
  type AccountStatus,
  type LoginBlock,
  type PoolEntry,
  type ReadBalance,
} from './model.js'

const MAX_OUTPUT_CHARS = 16 * 1024
const SHOWN_OUTPUT_CHARS = 2 * 1024
/** What a key refused or not checked says, by whose key it is (`keyProvider`). */
const REJECTED = {
  anthropic: 'account.apiKeyRejected',
  openai: 'account.codexKeyRejected',
  openrouter: 'account.openRouterKeyRejected',
  github: 'account.copilotTokenRejected',
} as const
const UNCHECKED = {
  anthropic: 'account.apiKeyUnchecked',
  openai: 'account.codexKeyUnchecked',
  openrouter: 'account.openRouterKeyUnchecked',
  github: 'account.copilotTokenUnchecked',
} as const

export type AccountAgent = Pick<Agent, 'authStatus' | 'login' | 'logout' | 'terminalLogin'>

export interface AppControl {
  list: () => AppAccount[]
  refresh: () => Promise<void>
  point: (app: AppId, home: AccountHome) => void
}

export interface AccountWatcherOptions {
  homes: AccountHomes
  /** The agent whose account folder it is, by `AccountHome.agent`. */
  agentOf: (home: AccountHome) => AccountAgent
  apps: AppControl
  prepare: (home: AccountHome) => Promise<void>
  active: () => string
  activate: (key: string) => void
  forget: (key: string) => void
  nameOf: (key: string) => string | null
  /** Optional. The e-mail the folder was last signed in as, and the account it is named after when another holds it (BTN-528). */
  signedInAs?: (key: string) => { last: string | null; former: string | null }
  name: (key: string, name: string) => void
  /** How the account's new sessions run, by the agent, `execution` and whether it signs in with a key. */
  transportOf: (home: AccountHome, apiKey: boolean) => Transport | null
  loginBlock: () => LoginBlock | null
  sessionsIn: (key: string) => string[]
  workingIn?: (key: string) => boolean
  /** The projects whose sessions run in the folder, by the pool. */
  projectsOn: (key: string) => string[]
  pool: () => PoolEntry[]
  /** Writes the shared pool's entry of the agent: the first account added while it names no folder takes it (`takesShared`). */
  makeShared: (agent: string, key: string) => void
  /** The agents whose CLI is not found, asked at each refresh. */
  missing: () => string[]
  /** Whether the account's provider answers: its sign-in is not asked before, as asking may renew it into the void (EKR-15). */
  online: (home: AccountHome) => Promise<boolean>
  sessionsKnown: () => boolean
  removing: (key: string) => boolean
  markRemoving: (key: string, on: boolean) => void
  configPending: (key: string) => boolean
  /** Optional. The edits made right in a Claude folder's `settings.json` and the account's own layer (BTN-901). */
  settings?: Pick<AccountSettings, 'edits' | 'own' | 'resolve' | 'dropOwn'>
  limits: (key: string) => RateLimits | null
  usage: (key: string) => UsageHealth
  /** Optional. The limits are old and unconfirmed since the start (`LimitsWatcher.outdated`). */
  limitsOutdated?: (key: string) => boolean
  /** Optional. When an account whose limit nothing tells last hit it (`LimitRetries`). */
  lastLimit?: (key: string) => string | null
  /** One short turn on a new cloud account, answering with the model that answered (`Agent.write`). */
  checkCloud: (home: AccountHome) => Promise<{ model: string | null }>
  /** The AWS profiles of the user the service runs as (`readAwsProfiles`). */
  awsProfiles: () => AwsProfiles
  /** The Google Cloud credentials of the user the service runs as (`readGcloud`). */
  gcloud: () => GcloudCredentials
  /** The Azure sign-in of the user the service runs as (`readAzure`). */
  azure: () => AzureCredentials
  /** Who the service runs as, for a cloud's credential refusal to name. */
  whose: () => Whose
  /** Whether the agent's provider takes the key. */
  checkKey: (agent: string, key: string) => Promise<KeyVerdict>
  keyCheckMs: number
  /** The organization each API account's key was last seen paying through (`src/account/organizations.ts`). */
  organizations: KeyOrganizations
  /** The management key of each OpenRouter account (BTN-868, `src/account/management.ts`). */
  managementKeys: ManagementKeys
  /** The account's balance, read with its management key (`readOpenRouterBalance`). */
  readBalance: (managementKey: string) => Promise<BalanceVerdict>
  /** Whether the key can pay again, asked of the agent's provider. */
  checkCredit: (agent: string, key: string) => Promise<CreditVerdict>
  creditCheckMs: number
  intervalMs: number
  loginTimeoutMs: number
  now: () => Date
  onChange: () => void
  onError: (error: unknown) => void
}

export interface KeyOrganizations {
  of: (key: string) => string | undefined
  note: (key: string, organization: string) => void
  forget: (key: string) => void
}

export interface ManagementKeys {
  of: (key: string) => string | undefined
  save: (key: string, value: string) => void
  forget: (key: string) => void
}

interface Known {
  home: AccountHome
  status: AccountStatus | null
  error: Notice | null
  /** The folder keeps its key itself, so the page may replace it (`AccountHomes.replacement`). */
  keyHeld: boolean
  /** The key it keeps is OpenRouter's, so a management key may read the account's balance (BTN-868). */
  openRouter: boolean
  /** The cloud the folder's `settings.json` connects to (BTN-822). */
  cloud: CloudSummary | null
}

interface Running {
  child: ChildProcessWithoutNullStreams
  home: AccountHome
  adding: boolean
}

export class AccountWatcher {
  private known: Known[] = []
  private read = false
  private absent: string[] = []
  private current: AccountLogin | null = null
  private globalCheck: AccountView['globalCheck']
  private running: Running | undefined
  private output = ''
  private timer: NodeJS.Timeout | undefined
  private readonly keys: KeyChecks
  private aws: AwsProfiles | undefined
  private gcloud: GcloudCredentials | undefined
  private azure: AzureCredentials | undefined
  /** The model each cloud account's check turn answered with, by folder key (BTN-822). */
  private readonly checkedModels = new Map<string, string | null>()
  private readonly credit: CreditChecks
  /** Each OpenRouter account's balance as its management key last read it, by folder key (BTN-868). */
  private readonly balances = new Map<string, ReadBalance>()

  constructor(private readonly options: AccountWatcherOptions) {
    this.keys = new KeyChecks(options.keyCheckMs)
    this.credit = new CreditChecks(options.creditCheckMs)
  }

  /** Readable by the limits watcher without constructing `view`, which itself asks for limits and usage. */
  needsLogin(key: string): boolean {
    const known = this.known.find((entry) => entry.home.key === key)
    if (known === undefined) return true
    return needsLogin(known.status, this.options.homes.times(known.home), this.options.now()) || (isApiKey(known.status) && this.keys.rejected(key))
  }

  get view(): AccountView {
    const now = this.options.now()
    const accounts = this.known.map(({ home, status, error, keyHeld, openRouter, cloud }): AccountEntry => {
      const times = this.options.homes.times(home)
      const transport = this.options.transportOf(home, paysPerToken(status))
      const seen = this.options.signedInAs?.(home.key)
      const signedOut = this.needsLogin(home.key)
      const terminalLogin = signedOut && !paysPerToken(status) ? this.options.agentOf(home).terminalLogin?.(home) : undefined
      return {
        key: home.key,
        name: this.options.nameOf(home.key),
        ...(seen?.last != null && status?.email == null && { lastEmail: seen.last }),
        ...(seen?.former != null && { formerEmail: seen.former }),
        global: home.global,
        agent: home.agent,
        status,
        error,
        loginExpiresAt: times.loginExpiresAt === null || times.erased ? null : new Date(times.loginExpiresAt).toISOString(),
        needsLogin: signedOut,
        ...(terminalLogin !== undefined && { terminalLogin }),
        sessions: this.options.sessionsIn(home.key),
        working: this.options.workingIn?.(home.key) ?? false,
        projects: this.options.projectsOn(home.key),
        removing: this.options.removing(home.key),
        configPending: this.options.configPending(home.key),
        ...this.settingsOf(home),
        apiKey: isApiKey(status),
        keyReplaceable: isApiKey(status) && keyHeld,
        ...(cloud !== null && { cloud }),
        ...(this.checkedModels.has(home.key) && { checkedModel: this.checkedModels.get(home.key) ?? null }),
        ...(transport !== null && { transport }),
        limits: this.options.limits(home.key),
        usage: this.options.usage(home.key),
        ...(this.options.limitsOutdated?.(home.key) === true && { limitsOutdated: true }),
        lastLimitAt: this.options.lastLimit?.(home.key) ?? null,
        spendingLimit: this.credit.spendingLimit(home.key, now),
        ...(this.keys.limit(home.key) !== null && { keyLimit: this.keys.limit(home.key)! }),
        ...(openRouter && { managementKey: this.options.managementKeys.of(home.key) !== undefined }),
        ...(openRouter && this.balances.has(home.key) && { balance: this.balances.get(home.key)! }),
      }
    })
    return {
      active: this.options.active(),
      accounts,
      login: this.current,
      ...(this.globalCheck !== undefined && { globalCheck: this.globalCheck }),
      ...(this.aws !== undefined && { aws: this.aws }),
      ...(this.gcloud !== undefined && { gcloud: this.gcloud }),
      ...(this.azure !== undefined && { azure: this.azure }),
      loginBlock: this.options.loginBlock(),
      apps: this.options.apps.list(),
      pool: this.options.pool().filter((entry) => accounts.some((account) => account.key === entry.account && account.agent === entry.provider)),
      missing: this.absent,
    }
  }

  /**
   * The agents whose CLI is not found right now. `view` names them as of the last poll, up to a minute old, while the
   * page's CLI copy is read live: a CLI installed meanwhile closed the install window but left "CLI not found" (BTN-639).
   */
  missingNow(): string[] {
    return this.options.missing()
  }

  emailOf(key: string): string | null {
    return this.known.find((known) => known.home.key === key)?.status?.email ?? null
  }

  /** The account pays per token, with a key or on a cloud: no plan limits to poll or wait out. */
  apiKey(key: string): boolean {
    return paysPerToken(this.known.find((known) => known.home.key === key)?.status ?? null)
  }

  /**
   * The key's own limit, read between the hourly checks by a read of its spend (`readOpenRouterKey`, BTN-847); null — the
   * key has none. The page hears of a change at once.
   */
  noteKeyLimit(key: string, limit: KeyLimit | null): void {
    if (this.keys.noteLimit(key, limit, this.options.now())) this.options.onChange()
  }

  /**
   * Keeps an OpenRouter account's management key once it reads the balance (BTN-868), or removes it on an empty value;
   * a refused key or no answer is thrown and nothing is written. The page hears only that the account has one.
   */
  async setManagementKey(key: string, value: string | null): Promise<void> {
    if (this.options.homes.find(key) === undefined) throw fail('account.unknown', { key })
    if (this.known.find((known) => known.home.key === key)?.openRouter !== true) throw fail('account.managementKeyNotOpenRouter', {})
    const next = value?.trim() ?? ''
    if (next === '') {
      this.options.managementKeys.forget(key)
      this.balances.delete(key)
      this.options.onChange()
      return
    }
    const verdict = await this.options.readBalance(next)
    if (verdict.state === 'rejected') throw fail('account.managementKeyRejected', {})
    if (verdict.state === 'unknown') throw fail('account.managementKeyUnchecked', { reason: verdict.reason })
    this.options.managementKeys.save(key, next)
    this.balances.set(key, { usd: verdict.usd, at: this.options.now().toISOString() })
    this.options.onChange()
  }

  /** Reads the balance of an account that has a management key, between the hourly checks; the page hears of a change. */
  async readBalance(key: string): Promise<void> {
    if (await this.noteBalance(key)) this.options.onChange()
  }

  /** True when the balance changed; an answer that tells nothing, or a key replaced meanwhile, keeps the last one. */
  private async noteBalance(key: string): Promise<boolean> {
    const managementKey = this.options.managementKeys.of(key)
    if (managementKey === undefined) return false
    const verdict = await this.options.readBalance(managementKey)
    if (verdict.state === 'unknown' || this.options.managementKeys.of(key) !== managementKey) return false
    const at = this.options.now().toISOString()
    const before = this.balances.get(key)
    const next: ReadBalance = verdict.state === 'ok' ? { usd: verdict.usd, at } : { rejected: true, at }
    this.balances.set(key, next)
    return before === undefined || ('usd' in before ? !('usd' in next) || before.usd !== next.usd : 'usd' in next)
  }

  /** When an API key can pay again after a credit or spending refusal at `at`; asking keeps it checked. */
  creditBackAfter(key: string, at: string, text?: string): string | null {
    return this.credit.restoredAfter(key, at, this.options.now(), text)
  }

  /** The folders have been read once since the start; before that `view` lists none of them. */
  get ready(): boolean {
    return this.read
  }

  start(): void {
    if (this.timer !== undefined) return
    const tick = () => {
      void this.refresh().finally(() => {
        this.timer = setTimeout(tick, this.options.intervalMs)
      })
    }
    tick()
  }

  async refresh(): Promise<void> {
    await this.removeFinished()
    const homes = this.options.homes.list()
    const known = await Promise.all(homes.map((home) => this.check(home)))
    const keysChanged = await this.checkKeys(known)
    await this.checkCredit(homes)
    const absent = this.options.missing()
    const first = !this.read
    this.read = true
    if (!first && !keysChanged && JSON.stringify(known) === JSON.stringify(this.known) && absent.join() === this.absent.join()) return
    this.known = known
    this.absent = absent
    this.options.onChange()
  }

  /**
   * A new account of the agent, signed in in a folder of its own by `method` (`SIGN_INS`); `NO_SIGN_IN` places the folder
   * at once, named after the agent.
   */
  add(agent: string, method?: string): void {
    this.requireIdle()
    if (this.options.missing().includes(agent)) throw new NoticeError(missingNotice(agent))
    const known = SIGN_INS[agent]
    if (known !== undefined && (method === undefined || !known.includes(method))) throw fail('login.method', { method: method ?? '', known: [...known] })
    const pending = this.options.homes.pending(this.options.now(), agent)
    if (method !== NO_SIGN_IN) {
      this.begin(pending, true, method)
      return
    }
    this.claimShared(this.options.homes.place(pending, agent))
    void this.refresh().catch((error: unknown) => this.options.onError(error))
  }

  async discoverGlobal(agent: string): Promise<void> {
    this.globalCheck = { agent, account: null }
    const home = this.options.homes.availableGlobals().find((each) => each.agent === agent)
    if (home !== undefined && !this.options.missing().includes(agent)) {
      const status = await this.options.agentOf(home).authStatus(home)
      if (status.loggedIn) this.globalCheck = { agent, account: { key: home.key, status } }
    }
    this.options.onChange()
  }

  async useGlobal(agent: string): Promise<void> {
    this.requireIdle()
    await this.discoverGlobal(agent)
    const candidate = this.globalCheck?.account
    if (candidate === null || candidate === undefined) throw fail('account.unknown', { key: agent })
    const refused = secondFreeProblem(this.view.accounts, agent, candidate.status)
    if (refused !== undefined) throw new NoticeError(refused)
    const home = this.options.homes.availableGlobals().find((each) => each.key === candidate.key)!
    const shared = takesShared(this.options.pool(), this.options.homes.list(), home.agent)
    await this.options.homes.register(home)
    if (shared) this.options.makeShared(home.agent, home.key)
    this.globalCheck = undefined
    await this.refresh()
  }

  async addApiKey(name: string, key: string, agent: string): Promise<void> {
    const value = assertApiKey(key, agent)
    const verdict = await this.accepted(agent, value)
    const home = this.options.homes.addApiKey(name, value, agent)
    this.noteKey(home.key, verdict)
    this.options.name(home.key, name)
    this.claimShared(home)
    await this.refresh()
  }

  /** Reads the AWS profiles of the service's user for the cloud form; the page gets them in `view.aws`. */
  readAws(): void {
    this.aws = this.options.awsProfiles()
    this.options.onChange()
  }

  /** Reads the Google Cloud credentials of the service's user for the Vertex form, into `view.gcloud` (BTN-823). */
  readGcloud(): void {
    this.gcloud = this.options.gcloud()
    this.options.onChange()
  }

  /** Reads the Azure sign-in of the service's user for the Foundry form's Entra ID way, into `view.azure` (BTN-824). */
  readAzure(): void {
    this.azure = this.options.azure()
    this.options.onChange()
  }

  /**
   * A cloud account (BTN-822): the folder is made, one short turn runs on it, and a refusal removes it again with the
   * cloud's own reason (`cloudErrorNotice`), so no account is added that cannot run a session.
   */
  async addCloud(name: string, connection: CloudConnection): Promise<void> {
    const home = this.options.homes.addCloud(name, connection)
    let model: string | null
    try {
      model = (await this.options.checkCloud(home)).model
    } catch (reason) {
      await this.options.homes.remove(home)
      const text = reason instanceof Error ? reason.message : String(reason)
      const known = cloudErrorNotice(text, this.options.whose(), connection.cloud)
      throw known === undefined ? fail('account.cloudCheckFailed', { reason: text.slice(0, 500) }) : new NoticeError(known)
    }
    this.checkedModels.set(home.key, model)
    this.options.name(home.key, name)
    this.claimShared(home)
    await this.refresh()
  }

  /**
   * A new key in the folder of an API account (BTN-418): its name, roles and pools stay. Checked as a new account's key
   * is, and refused when the account's organization is known and the key's is another one. Running sessions go on with
   * the key they started with; new ones read the new one.
   */
  async replaceApiKey(key: string, value: string): Promise<void> {
    const home = this.options.homes.find(key)
    if (home === undefined) throw fail('account.unknown', { key })
    const next = this.options.homes.replacement(home, value)
    const verdict = await this.accepted(home.agent, next)
    const known = this.options.organizations.of(key)
    if (known !== undefined && verdict.organization !== undefined && verdict.organization !== known) {
      throw fail('account.keyOtherOrganization', { agent: home.agent })
    }
    this.options.homes.replaceApiKey(home, next)
    this.noteKey(key, verdict)
    await this.refresh()
  }

  /** The provider's verdict on a key it takes; a refusal or no answer is thrown. */
  private async accepted(agent: string, key: string): Promise<KeyVerdict & { state: 'ok' }> {
    const verdict = await this.options.checkKey(agent, key)
    const provider = keyProvider(agent, key)
    if (verdict.state === 'rejected') throw fail(REJECTED[provider], {})
    if (verdict.state === 'unknown') throw fail(UNCHECKED[provider], { reason: verdict.reason })
    return verdict
  }

  /** True when the verdict or the key's limit changed. */
  private noteKey(key: string, verdict: KeyVerdict): boolean {
    const changed = this.keys.note(key, verdict, this.options.now())
    if (verdict.state === 'ok' && verdict.organization !== undefined && verdict.organization !== this.options.organizations.of(key)) {
      this.options.organizations.note(key, verdict.organization)
    }
    return changed
  }

  renew(key: string): void {
    this.requireIdle()
    const home = this.options.homes.find(key)
    if (home === undefined) throw fail('account.unknown', { key })
    const blocked = key === this.options.active() ? this.options.loginBlock() : null
    if (blocked !== null) throw new NoticeError(loginBlockNotice(blocked))
    this.begin(home, false)
  }

  switchTo(key: string): void {
    const problem = switchProblem(this.view, key)
    if (problem !== undefined) throw new NoticeError(problem)
    this.options.activate(key)
  }

  async switchApp(app: string, key: string): Promise<void> {
    await this.options.apps.refresh()
    const problem = appSwitchProblem(this.view, app, key)
    if (problem !== undefined) throw new NoticeError(problem)
    const home = this.options.homes.find(key)!
    await this.options.prepare(home)
    this.options.apps.point(app as AppId, home)
    await this.options.apps.refresh()
  }

  async remove(key: string): Promise<void> {
    const problem = removeProblem(this.view, key)
    if (problem !== undefined) throw new NoticeError(problem)
    if (!this.options.sessionsKnown() || this.options.sessionsIn(key).length > 0) {
      this.options.markRemoving(key, true)
      this.options.onChange()
      return
    }
    await this.drop(key)
    await this.refresh()
  }

  keep(key: string): void {
    if (!this.options.removing(key)) throw fail('account.notRemoving', { key })
    this.options.markRemoving(key, false)
    this.options.onChange()
  }

  private settingsOf(home: AccountHome): Pick<AccountEntry, 'settingsEdits' | 'ownSettings'> {
    const settings = this.options.settings
    if (settings === undefined || home.global || home.agent !== CLAUDE) return {}
    const edits = settings.edits(home)
    const own = settings.own(home.key)
    return { ...(edits.length > 0 && { settingsEdits: edits }), ...(own.length > 0 && { ownSettings: own }) }
  }

  /** An edit right in the folder's `settings.json`: made shared, kept as the account's own or dropped, then transferred. */
  async resolveSettingsEdit(key: string, setting: string, choice: EditChoice): Promise<void> {
    const home = this.claudeHome(key)
    this.options.settings?.resolve(home, setting, choice)
    await this.options.prepare(home)
    this.options.onChange()
  }

  /** A key of the account's own layer goes, and the global value comes back at once. */
  async dropOwnSetting(key: string, setting: string): Promise<void> {
    const home = this.claudeHome(key)
    this.options.settings?.dropOwn(home, setting)
    await this.options.prepare(home)
    this.options.onChange()
  }

  private claudeHome(key: string): AccountHome {
    const home = this.options.homes.find(key)
    if (home === undefined || home.global || home.agent !== CLAUDE) throw fail('account.unknown', { key })
    return home
  }

  /** Only the name the page shows: the folder and its key stay as they are; a blank name goes back to the default. */
  rename(key: string, name: string): void {
    if (this.options.homes.find(key) === undefined) throw fail('account.unknown', { key })
    this.options.name(key, name)
    this.options.onChange()
  }

  private async removeFinished(): Promise<void> {
    if (!this.options.sessionsKnown()) return
    const view = this.view
    for (const entry of view.accounts) {
      if (!entry.removing || entry.sessions.length > 0 || removeProblem(view, entry.key) !== undefined) continue
      try {
        await this.drop(entry.key)
      } catch (error) {
        this.options.onError(error)
      }
    }
  }

  /** Asks each API account's provider about its key once per `keyCheckMs`; true when a verdict or a key's limit changed. */
  private async checkKeys(known: Known[]): Promise<boolean> {
    const now = this.options.now()
    const due = known.filter(({ home, status }) => isApiKey(status) && this.keys.due(home.key, now))
    const changes = await Promise.all(
      due.map(async ({ home, openRouter }) => {
        const key = this.options.homes.apiKeyOf(home)
        if (key === null) return false
        const checked = this.options.checkKey(home.agent, key).then((verdict) => this.noteKey(home.key, verdict))
        const [noted, balance] = await Promise.all([checked, openRouter ? this.noteBalance(home.key) : false])
        return noted || balance
      }),
    )
    return changes.includes(true)
  }

  private async checkCredit(homes: AccountHome[]): Promise<void> {
    const now = this.options.now()
    await Promise.all(
      this.credit.due(now).map(async (account) => {
        const home = homes.find((each) => each.key === account)
        const key = home === undefined ? null : this.options.homes.apiKeyOf(home)
        if (home === undefined || key === null) return
        const verdict = await this.options.checkCredit(home.agent, key)
        if (verdict.state === 'unknown') this.options.onError(new Error(`credit check of ${account}: ${verdict.reason}`))
        this.credit.note(account, verdict, now)
      }),
    )
  }

  private async drop(key: string): Promise<void> {
    const home = this.options.homes.find(key)!
    const status = this.known.find((known) => known.home.key === key)?.status
    if (!home.global && status?.loggedIn === true && !paysPerToken(status)) await this.options.agentOf(home).logout(home)
    await this.options.homes.remove(home)
    this.options.forget(key)
    this.keys.forget(key)
    this.credit.forget(key)
    this.checkedModels.delete(key)
    this.options.organizations.forget(key)
    this.options.managementKeys.forget(key)
    this.balances.delete(key)
  }

  code(code: string): void {
    if (this.running === undefined || this.current === null) throw fail('login.none', {})
    this.running.child.stdin.write(`${code}\n`)
    this.current = { ...this.current, codeSent: true }
    this.options.onChange()
  }

  cancel(): void {
    const running = this.running
    this.running = undefined
    this.current = null
    running?.child.kill()
    if (running?.adding) this.discard(running.home)
    this.options.onChange()
  }

  private async check(home: AccountHome): Promise<Known> {
    const before = this.known.find((known) => known.home.key === home.key)
    const apiKey = home.global ? null : this.options.homes.apiKeyOf(home)
    const keyHeld = apiKey !== null
    const openRouter = apiKey !== null && keyProvider(home.agent, apiKey) === 'openrouter'
    const cloud = this.options.homes.cloudOf(home)
    if (!(await this.options.online(home))) return { home, status: before?.status ?? null, error: before?.error ?? null, keyHeld, openRouter, cloud }
    try {
      return { home, status: withIdentity(await this.options.agentOf(home).authStatus(home), home.key), error: null, keyHeld, openRouter, cloud }
    } catch (reason) {
      const error = noticeOf(reason)
      if (!sameNotice(error, before?.error ?? null)) this.options.onError(reason)
      return { home, status: before?.status ?? null, error, keyHeld, openRouter, cloud }
    }
  }

  private requireIdle(): void {
    if (this.running !== undefined) throw fail('login.running', {})
  }

  private begin(home: AccountHome, adding: boolean, method?: string): void {
    const child = this.options.agentOf(home).login(home, method)
    const running = { child, home, adding }
    this.running = running
    this.output = ''
    this.current = {
      agent: home.agent,
      ...(method !== undefined && { method }),
      target: adding ? null : home.key,
      startedAt: this.options.now().toISOString(),
      urls: [],
      deviceCode: null,
      output: '',
      error: null,
      codeSent: false,
    }
    const timeout = setTimeout(() => {
      this.fail(running, notice('login.timeout', { minutes: Math.round(this.options.loginTimeoutMs / 60_000) }))
      child.kill()
    }, this.options.loginTimeoutMs)

    const read = (chunk: Buffer) => {
      if (this.running !== running || this.current === null) return
      this.output = (this.output + chunk.toString('utf8')).slice(-MAX_OUTPUT_CHARS)
      const urls = [...new Set([...this.current.urls, ...loginUrls(this.output)])]
      const deviceCode = loginCode(this.output) ?? this.current.deviceCode
      this.current = { ...this.current, urls, deviceCode, output: cleanOutput(this.output).trim().slice(-SHOWN_OUTPUT_CHARS) }
      this.options.onChange()
    }
    child.stdout.on('data', read)
    child.stderr.on('data', read)
    child.on('error', (error) => {
      clearTimeout(timeout)
      const absent = (error as NodeJS.ErrnoException).code === 'ENOENT'
      this.fail(running, absent ? missingNotice(home.agent) : notice('login.startFailed', {}, { detail: error.message }))
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0 && this.running === running) {
        void this.finish(running)
        return
      }
      const lastLine = cleanOutput(this.output).trim().split('\n').at(-1) ?? ''
      this.fail(running, notice('login.exited', { code: String(code) }, { detail: lastLine }))
    })
    this.options.onChange()
  }

  private async finish(running: Running): Promise<void> {
    try {
      if (running.adding) {
        const agent = this.options.agentOf(running.home)
        const status = await agent.authStatus(running.home)
        const refused = secondFreeProblem(this.view.accounts, running.home.agent, status)
        if (refused !== undefined) {
          await agent.logout(running.home).catch((error: unknown) => this.options.onError(error))
          this.fail(running, refused)
          return
        }
        const home = this.options.homes.place(running.home, status.email ?? running.home.agent)
        this.options.homes.share(home)
        this.claimShared(home)
      }
    } catch (error) {
      running.adding = false
      this.fail(running, notice('login.setupFailed', { dir: running.home.dir }, { cause: noticeOf(error) }))
      return
    }
    if (this.running !== running) return
    this.running = undefined
    this.current = null
    this.options.onChange()
    await this.refresh()
  }

  private fail(running: Running, error: Notice): void {
    if (this.running !== running || this.current === null) return
    this.running = undefined
    this.current = { ...this.current, error }
    if (running.adding) this.discard(running.home)
    this.options.onChange()
  }

  private claimShared(home: AccountHome): void {
    if (takesShared(this.options.pool(), this.options.homes.list(), home.agent)) this.options.makeShared(home.agent, home.key)
  }

  private discard(home: AccountHome): void {
    try {
      void this.options.homes.remove(home).catch((error: unknown) => this.options.onError(error))
    } catch (error) {
      this.options.onError(error)
    }
  }
}
