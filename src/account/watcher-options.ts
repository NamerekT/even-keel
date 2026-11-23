import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { CliInstaller } from '../agent/cli-installer.js'
import type { Agent } from '../agent/contract.js'
import type { RateLimits } from '../limits/model.js'
import type { UsageHealth } from '../limits/usage.js'
import type { Notice } from '../notice/notice.js'
import type { AppAccount, AppId } from './apps.js'
import type { AccountHome, AccountHomes } from './homes.js'
import type { CreditVerdict } from './credit.js'
import type { KeyVerdict } from './keycheck.js'
import type { BalanceVerdict } from './management.js'
import type { AccountSettings } from './settingsLayer.js'
import type { AwsProfiles, AzureCredentials, CloudSummary, GcloudCredentials } from './cloud.js'
import type { Whose } from './cloud-errors.js'
import type { LongToken } from './longToken.js'
import type { Transport } from './transport.js'
import type { AccountStatus, LoginBlock, PoolEntry } from './model.js'

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
  /** Optional. By agent, the version of the CLI its sessions run on (`cliReport`, BTN-1502), read at each view. */
  clis?: () => Record<string, string | null>
  /** Optional. Installs an agent's CLI with its official installer from the page (BTN-1502). */
  installer?: Pick<CliInstaller, 'commands' | 'view' | 'start' | 'recheck'>
  /** Whether the account's provider answers: its sign-in is not asked before, as asking may renew it into the void (EKR-15). */
  online: (home: AccountHome) => Promise<boolean>
  sessionsKnown: () => boolean
  removing: (key: string) => boolean
  markRemoving: (key: string, on: boolean) => void
  configPending: (key: string) => boolean
  /** Optional. The edits made right in a Claude folder's `settings.json` and the account's own layer (BTN-901). */
  settings?: Pick<AccountSettings, 'changes' | 'own' | 'resolve' | 'dropOwn'>
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
  /** The account's balance, read with its own key or its management key (`readOpenRouterBalance`). */
  readBalance: (key: string) => Promise<BalanceVerdict>
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

export interface Known {
  home: AccountHome
  status: AccountStatus | null
  error: Notice | null
  /** The folder keeps its key itself, so the page may replace it (`AccountHomes.replacement`). */
  keyHeld: boolean
  /** The key it keeps is OpenRouter's, so a management key may read the account's balance (BTN-868). */
  openRouter: boolean
  /** The cloud the folder's `settings.json` connects to (BTN-822). */
  cloud: CloudSummary | null
  /** The long token the folder runs on (BTN-1005). */
  longToken: LongToken | null
  /** Whether a Claude folder's `settings.json` starts Remote Control; null for another agent's. */
  remote: boolean | null
}

export interface Running {
  child: ChildProcessWithoutNullStreams
  home: AccountHome
  adding: boolean
}
