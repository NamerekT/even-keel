import {
  folderName,
  loginBlockNotice,
  loginCode,
  removeProblem,
  switchProblem,
  type AccountEntry,
  type AccountLogin,
  type AccountView,
  type AccountStatus,
  type PoolEntry,
} from '../../../src/account/model.js'
import { appSwitchProblem, type AppAccount } from '../../../src/account/apps.js'
import { cloudConnectionOf, cloudEnv, cloudOf, type AwsProfiles, type AzureCredentials, type GcloudCredentials } from '../../../src/account/cloud.js'
import { fail, notice, NoticeError, textNotice } from '../../../src/notice/notice.js'
import type { RateLimits } from '../../../src/limits/model.js'
import type { UsageHealth } from '../../../src/limits/usage.js'
import type { EvenKeelState } from '../../../src/state.js'
import { NO_SIGN_IN } from '../../../src/agent/providers.js'
import { CLAUDE } from '../../../src/claude/name.js'
import { CODEX } from '../../../src/codex/name.js'
import { COPILOT } from '../../../src/copilot/name.js'
import { OPENCODE } from '../../../src/opencode/name.js'
import { copilotModel } from '../../../src/opencode/support.js'

function ago(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString()
}

const FAKE_ACCOUNT: AccountStatus = {
  loggedIn: true,
  authMethod: 'claude.ai',
  email: 'john.doe@example.com',
  orgName: 'Example Org',
  subscriptionType: 'max',
}

/** The fake page's projects, all on the shared pool unless a mode gives one a folder of its own. */
const FAKE_PROJECTS = ['ABC', 'DEMO', 'XYZ', 'OPS']
const SHARED_POOL: PoolEntry[] = [
  { project: null, provider: CLAUDE, account: 'global' },
  { project: null, provider: CODEX, account: 'codex' },
]

const FAKE_LOGIN: AccountLogin = {
  agent: 'claude',
  target: null,
  startedAt: ago(1),
  urls: ['https://claude.example.com/oauth/authorize?code=true&state=example'],
  deviceCode: null,
  output: "Browser didn't open? Use the url below to sign in:\n\nhttps://claude.example.com/oauth/authorize?code=true&state=example",
  error: null,
  codeSent: false,
}

const FAKE_DEVICE_OUTPUT =
  'Follow these steps to sign in with ChatGPT using device code authorization:\n\n1. Open this link in your browser and sign in to your account\n   https://auth.openai.example.com/codex/device\n\n2. Enter this one-time code (expires in 15 minutes)\n   ABCD-1234\n\nContinue only if you started this login in Codex. If a website or another person gave you this code, cancel.\n'

const FAKE_DEVICE_LOGIN: AccountLogin = {
  ...FAKE_LOGIN,
  agent: 'codex',
  urls: ['https://auth.openai.example.com/codex/device'],
  deviceCode: loginCode(FAKE_DEVICE_OUTPUT),
  output: FAKE_DEVICE_OUTPUT.trim(),
}

const FAKE_OPENCODE_OUTPUT = '┌  Add credential\n│\n●  Go to: https://github.example.com/login/device\n│\n●  Enter code: WDJB-MJHT\n│\n◒  Waiting for authorization...\n'

const FAKE_OPENCODE_LOGIN: AccountLogin = {
  ...FAKE_DEVICE_LOGIN,
  agent: 'opencode',
  urls: ['https://github.example.com/login/device'],
  deviceCode: loginCode(FAKE_OPENCODE_OUTPUT),
  output: FAKE_OPENCODE_OUTPUT.trim(),
}

const FAKE_LOGINS: Record<string, AccountLogin> = { [CODEX]: FAKE_DEVICE_LOGIN, [OPENCODE]: FAKE_OPENCODE_LOGIN }

const FAKE_MODELS: Record<string, { models: string[]; complete: boolean }> = {
  [CLAUDE]: { models: ['opus', 'sonnet', 'haiku', 'opusplan', 'sonnet[1m]'], complete: false },
  [CODEX]: { models: ['gpt-6.1-sol', 'gpt-6-luna', 'gpt-5.6-terra'], complete: false },
  [OPENCODE]: { models: ['opencode/big-pickle', 'opencode/deepseek-v4.1-flash-free', 'anthropic/claude-sonnet-5-5'], complete: true },
}

const VENDORS = ['anthropic', 'openai', 'google', 'meta-llama', 'mistralai', 'deepseek', 'qwen', 'x-ai', 'cohere', 'nousresearch']

/** An OpenRouter-sized catalogue (BTN-858): hundreds of models behind one OpenCode key. */
const MANY_OPENCODE = Array.from({ length: 320 }, (_, index) => `openrouter/${VENDORS[index % VENDORS.length]}/model-${Math.floor(index / VENDORS.length) + 1}`)

/** Prompts of `?models=many` whose matches list a few, fold hundreds, or count them all. */
export const MANY_MODEL_PROMPTS: Record<string, string> = {
  '* | *sonnet*': 'Keep diffs small.',
  'OpenCode | openrouter/*': 'Prefer cheap models for reading.',
  'OpenCode | *': 'Run the tests before each commit.',
}

/** `models/list` of the account folder `key`, by its agent; `mode` `many` gives OpenCode hundreds more. */
export function fakeModels(account: AccountView, key: string, mode: string | null = null): { models: string[]; complete: boolean } | null {
  const agent = account.accounts.find((entry) => entry.key === key)?.agent
  const known = agent === undefined ? null : (FAKE_MODELS[agent] ?? null)
  const list = known !== null && agent === OPENCODE && mode === 'many' ? { ...known, models: [...known.models, ...MANY_OPENCODE] } : known
  return agent === OPENCODE && list !== null ? { ...list, models: list.models.filter(model => !copilotModel(model)) } : list
}

export function fakeUsage(mode: string | null): UsageHealth {
  if (mode === 'unread') return { state: 'unread', reason: notice('usage.noWeek', {}), since: ago(12) }
  if (mode === 'off') return { state: 'off', reason: notice('usage.turns', { value: '1' }), since: ago(3) }
  if (mode === 'waiting') return { state: 'waiting', reason: null, since: null }
  return { state: 'ok', reason: null, since: ago(60) }
}

export const FAKE_LIMITS: RateLimits = {
  fiveHour: { usedPercentage: 37, resetsAt: new Date(Date.now() + 2 * 3_600_000).toISOString() },
  sevenDay: { usedPercentage: 64, resetsAt: new Date(Date.now() + 3 * 86_400_000).toISOString() },
  updatedAt: ago(0),
  source: 'usage',
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString()
}

/** An API account: the CLI reports no e-mail, so the folder key stands in for it (`withIdentity`). */
function apiEntry(key: string, patch: Partial<AccountEntry> = {}): AccountEntry {
  return fakeEntry({
    key,
    global: false,
    status: { loggedIn: true, authMethod: 'api_key', email: key, orgName: null, subscriptionType: null },
    loginExpiresAt: null,
    apiKey: true,
    keyReplaceable: true,
    ...patch,
  })
}

const OPENCODE_STATUS = { loggedIn: true, authMethod: 'none', email: null, orgName: null, subscriptionType: null }

const FAKE_AWS: AwsProfiles = {
  profiles: [
    { name: 'default', region: 'us-east-1', shortLived: false },
    { name: 'bedrock-prod', region: 'eu-central-1', shortLived: false },
    { name: 'sso-dev', region: 'us-west-2', shortLived: true },
  ],
  user: 'john',
  home: 'C:\\Users\\john',
}

const FAKE_GCLOUD: GcloudCredentials = {
  user: 'john',
  home: 'C:\\Users\\john',
  adcFile: 'C:\\Users\\john\\AppData\\Roaming\\gcloud\\application_default_credentials.json',
  adcType: 'authorized_user',
  environmentFile: null,
  projects: ['example-vertex-prod', 'example-sandbox'],
}

const FAKE_AZURE: AzureCredentials = {
  user: 'john',
  home: 'C:\\Users\\john',
  profileFile: 'C:\\Users\\john\\.azure\\azureProfile.json',
  signedIn: true,
  environment: false,
}

/** No limits, with why (`UsageAnswer` of kind `missing`). */
function stale(reason: ReturnType<typeof notice>): UsageHealth {
  return { state: 'stale', reason, since: ago(3) }
}

function codexEntry(key: string, email: string, plan: string, patch: Partial<AccountEntry> = {}): AccountEntry {
  return fakeEntry({
    key,
    global: false,
    agent: CODEX,
    status: { loggedIn: true, authMethod: 'chatgpt', email, orgName: null, subscriptionType: plan },
    loginExpiresAt: null,
    ...patch,
  })
}

/** A Claude account runs its sessions the way a real one does by default: an API key or a cloud through the Agent SDK, a subscription through `--bg`. */
function fakeEntry(patch: Partial<AccountEntry>): AccountEntry {
  const entry = rawEntry(patch)
  return entry.agent === 'claude' && entry.transport === undefined ? { ...entry, transport: entry.apiKey || entry.cloud ? 'sdk' : 'bg' } : entry
}

function rawEntry(patch: Partial<AccountEntry>): AccountEntry {
  return {
    key: 'global',
    name: null,
    global: true,
    agent: 'claude',
    status: FAKE_ACCOUNT,
    error: null,
    loginExpiresAt: inDays(24),
    needsLogin: false,
    sessions: [],
    projects: [],
    removing: false,
    configPending: false,
    apiKey: false,
    limits: null,
    usage: { state: 'ok', reason: null, since: ago(1) },
    ...patch,
  }
}

export function fakeAccount(mode: string | null, idle: boolean, limits: RateLimits): AccountView {
  if (mode === 'codex-only') {
    const view = fakeAccount('codex', idle, limits)
    return { ...view, accounts: view.accounts.filter((entry) => entry.agent === CODEX) }
  }
  if (mode === 'overage' || mode === 'overage-long' || mode === 'overage-permitted') {
    const base = fakeAccount(mode === 'overage-long' ? 'rows-long' : 'rows', idle, limits)
    const token = fakeAccount('copilot', idle, limits).accounts.find((entry) => entry.key === 'github')!
    const credits = { source: 'chatgpt' as const, unit: 'credits' as const, balance: 12.4, available: true, unlimited: false, updatedAt: ago(1) }
    return { ...base, accounts: [...base.accounts, token].map((entry) => {
      if (entry.key === 'global') return { ...entry, working: true, limits: { ...entry.limits!, source: 'sdk', overage: { source: 'claude-sdk', using: true, available: true, updatedAt: ago(1) } } }
      if (entry.key === 'codex') return { ...entry, working: true, sessions: ['OPS-1'], limits: { ...entry.limits!, overage: credits } }
      if (entry.key === 'opencode-2') return { ...entry, limits: { ...entry.limits!, overage: credits } }
      if (entry.key === 'github') return { ...entry, limits: { ...entry.limits!, overage: { source: 'github-quota', enabled: mode === 'overage-permitted', count: 0, updatedAt: ago(1) } } }
      return entry
    }) }
  }
  if (mode === 'rows' || mode === 'rows-noCodex' || mode === 'rows-long') {
    const base = fakeAccount('opencode', idle, limits)
    const copilot = fakeAccount('copilot', idle, limits).accounts.filter((entry) => entry.agent === COPILOT && !entry.apiKey)
    const lost = apiEntry('old-key', { name: 'Test API', needsLogin: true, sessions: ['Key session'] })
    const accounts = [...base.accounts, ...copilot, lost].map((entry) => entry.key === 'global'
      ? { ...entry, limits: { ...limits, fiveHour: null, sevenDay: { ...limits.sevenDay!, usedPercentage: 99 } }, ...(mode === 'rows-long' ? { name: 'Example organization account with a very long display name that needs truncation' } : {}) }
      : entry.key === 'codex' ? { ...entry, limits: { ...entry.limits!, sevenDay: { ...limits.sevenDay!, usedPercentage: 100 } } } : entry)
    return { ...base, accounts: mode === 'rows-noCodex' ? accounts.filter((entry) => entry.agent !== CODEX) : accounts }
  }
  if (mode === 'empty' || mode === 'cli' || mode === 'cli-long' || mode === 'cli-error') return {
    ...fakeAccount(null, idle, limits), accounts: [], active: 'global', apps: [], pool: [],
    ...(mode !== 'empty' && { globalCheck: { agent: CLAUDE, account: { key: 'global', status: {
      ...FAKE_ACCOUNT, email: mode === 'cli-long' ? 'example-team-with-a-very-long-account-name@department.example.com' : FAKE_ACCOUNT.email,
      ...(mode === 'cli-error' && { orgName: 'refused' }),
    } } } }),
  }
  const global = fakeEntry({ limits, projects: FAKE_PROJECTS, sessions: idle ? [] : ['ABC-1', 'ABC-2', 'ABC-3', 'ABC-4', 'ABC-5', 'Scratch notes'] })
  const work = fakeEntry({
    key: 'jane.roe',
    global: false,
    status: { ...FAKE_ACCOUNT, email: 'jane.roe@example.com', subscriptionType: 'pro' },
    loginExpiresAt: inDays(5),
    usage: { state: 'stale', reason: null, since: ago(30) },
  })
  const vscode: AppAccount = { app: 'vscode', account: 'jane.roe', dir: 'C:\\Users\\john\\.claude-accounts\\jane.roe', error: null, sessions: [] }
  const signedIn: AccountView = {
    active: 'global',
    accounts: [global, work],
    apps: [vscode],
    pool: SHARED_POOL,
    missing: [],
    login: null,
    loginBlock: idle
      ? null
      : {
          chains: ['ABC'],
          sessions: [
            { name: 'ABC-5', status: 'busy', waitingFor: null },
            { name: 'Scratch notes', status: 'waiting', waitingFor: 'permission' },
          ],
        },
  }
  if (mode === 'connections') {
    // Every connection of every agent at once, the windows each plan really has: ChatGPT Pro without five hours, Free
    // with a month, Copilot's allowance; keys with their dollars, Zen and the machine's Copilot with their tokens.
    const month = (used: number, left?: number) => ({ usedPercentage: used, resetsAt: inDays(18), ...(left === undefined ? {} : { left }) })
    const chatgpt = { ...limits, source: 'api' as const, pool: 'chatgpt:acc-1' }
    const key = (name: string, agent: string, patch: Partial<AccountEntry> = {}) => apiEntry(name, { agent, name: agent === CLAUDE ? 'Test API' : 'Test API 2', ...patch })
    const opencode = (name: string, label: string, providers: string | null, patch: Partial<AccountEntry> = {}) => fakeEntry({
      key: name, name: label, global: false, agent: OPENCODE, loginExpiresAt: null,
      status: { ...OPENCODE_STATUS, authMethod: providers === null ? 'none' : 'oauth', subscriptionType: providers }, ...patch,
    })
    const accounts = [
      global, work, key('api', CLAUDE),
      codexEntry('codex', 'john.doe@example.com', 'plus', { limits: chatgpt, projects: ['OPS'] }),
      codexEntry('codex-pro', 'jane.doe@example.com', 'pro', { limits: { fiveHour: null, sevenDay: { usedPercentage: 41, resetsAt: inDays(4) }, updatedAt: ago(1), source: 'api' } }),
      codexEntry('codex-free', 'sam.roe@example.com', 'free', { limits: { fiveHour: null, sevenDay: null, month: month(12), updatedAt: ago(1), source: 'api' } }),
      key('codex-key', CODEX, { spendingLimit: { resetsAt: null } }),
      opencode('opencode', 'OpenCode Zen', null, { usage: stale(notice('usage.openCodeNone', {})) }),
      opencode('opencode-zen', 'OpenCode Zen 2', null, { usage: stale(notice('usage.openCodeNone', {})) }),
      opencode('opencode-2', 'OpenCode', 'openai', { limits: { fiveHour: null, sevenDay: null, month: month(12), updatedAt: ago(1), source: 'api' } }),
      opencode('opencode-copilot', 'OpenCode 2', 'github-copilot', { limits: { fiveHour: null, sevenDay: null, month: month(17, 166), updatedAt: ago(2), source: 'api' } }),
      key('opencode-anthropic', OPENCODE, { name: 'OpenCode keys', status: { ...OPENCODE_STATUS, authMethod: 'api_key', subscriptionType: 'anthropic' } }),
      key('opencode-openai', OPENCODE, { name: 'Test API', status: { ...OPENCODE_STATUS, authMethod: 'api_key', subscriptionType: 'openai' }, spendingLimit: { resetsAt: null } }),
      key('opencode-openrouter', OPENCODE, { name: 'OpenRouter', status: { ...OPENCODE_STATUS, authMethod: 'api_key', subscriptionType: 'openrouter' },
        keyLimit: { remaining: 7.42, limit: 10, reset: 'monthly', at: ago(3) }, managementKey: false }),
      ...fakeAccount('copilot', idle, limits).accounts.filter((entry) => entry.agent === COPILOT),
    ]
    return { ...signedIn, accounts, pool: [...SHARED_POOL, { project: 'OPS', provider: CODEX, account: 'codex' }] }
  }
  if (mode === 'model-weeks') {
    // BTN-805: the models' own weeks of the plans in `test/fixtures/limits/` — Max with all three, a verified Ultra
    // without five hours, a Team seat without the all-models week; the reset of a model week may be unknown.
    const fable = (usedPercentage: number, resetsAt: string | null) => ({ weeks: [{ model: 'Fable', usedPercentage, resetsAt }], updatedAt: ago(1) })
    const claude = (key: string, email: string, plan: string, patch: Partial<RateLimits>) => fakeEntry({
      key, global: false, loginExpiresAt: inDays(20), status: { ...FAKE_ACCOUNT, email, subscriptionType: plan },
      limits: { ...limits, updatedAt: ago(1), ...patch },
    })
    const accounts = [
      { ...global, limits: { ...limits, models: fable(100, null) } },
      claude('ultra', 'sam.roe@example.com', 'max', { fiveHour: null, sevenDay: { usedPercentage: 4, resetsAt: inDays(5) }, absent: ['fiveHour'], models: fable(0, null) }),
      claude('team', 'alex.doe@example.com', 'team', { sevenDay: null, absent: ['sevenDay'], models: fable(41, inDays(2)) }),
      { ...work, limits: { ...limits, models: { weeks: [], updatedAt: ago(1) } } },
    ]
    return { ...signedIn, accounts }
  }
  if (mode === 'out') {
    const out = { ...global, status: { loggedIn: false, authMethod: 'none', email: null, orgName: null, subscriptionType: null }, needsLogin: true }
    return { ...signedIn, accounts: [out, work] }
  }
  if (mode === 'mixup') {
    // BTN-528: a folder named after another account, a second folder of the global account, two signed out.
    const out = { loggedIn: false, authMethod: 'none', email: null, orgName: null, subscriptionType: null }
    const same = { ...work, status: { ...work.status!, email: global.status!.email } }
    const gone = { ...work, status: out, needsLogin: true, loginExpiresAt: null, limits: null }
    return { ...signedIn, accounts: [global, { ...same, formerEmail: 'jane.roe@example.com' }, { ...same, key: 'work' },
      { ...gone, key: 'sam.roe', lastEmail: 'sam.roe@example.com' }, { ...gone, key: 'spare' }] }
  }
  if (mode === 'expired') return { ...signedIn, accounts: [{ ...global, loginExpiresAt: ago(60), needsLogin: true, limits: null }, work] }
  if (mode === 'login') return { ...signedIn, login: FAKE_LOGIN, loginBlock: null }
  if (mode === 'failed') {
    return { ...signedIn, login: { ...FAKE_LOGIN, error: notice('login.exited', { code: '1' }, { detail: 'OAuth error' }) }, loginBlock: null }
  }
  if (mode === 'cliMissing') return { ...signedIn, login: { ...FAKE_LOGIN, error: notice('login.claudeMissing', {}), output: '' }, loginBlock: null }
  if (mode === 'secondFree') {
    const output = `${FAKE_DEVICE_LOGIN.output}\n\nSuccessfully logged in`
    const error = notice('account.secondFree', { account: 'john.doe@example.com' })
    return { ...signedIn, login: { ...FAKE_DEVICE_LOGIN, deviceCode: null, output, error }, loginBlock: null }
  }
  if (mode === 'unknown') return { ...signedIn, accounts: [{ ...global, status: null, error: textNotice('claude: auth status timed out') }, work] }
  if (mode === 'outdated') {
    const old = { ...limits, sevenDay: { ...limits.sevenDay!, usedPercentage: 45 }, updatedAt: ago(17 * 60), source: 'statusline' as const }
    return { ...signedIn, accounts: [{ ...global, limits: old, usage: fakeUsage('waiting'), limitsOutdated: true }, work] }
  }
  const workSessions = ['ABC-7', 'ABC-8']
  if (mode === 'pending') return { ...signedIn, accounts: [global, { ...work, sessions: workSessions, configPending: true }] }
  if (mode === 'removing') return { ...signedIn, accounts: [global, { ...work, sessions: workSessions, removing: true }] }
  if (mode === 'vscode-chats') {
    const sessions = [
      { name: 'Header colours on the accounts page', session: 'example-12', account: 'jane.roe', status: 'busy' as const },
      { name: 'Scratch', session: 'example-13', account: 'jane.roe', status: 'idle' as const },
    ]
    return { ...signedIn, accounts: [global, { ...work, sessions: ['example-12', 'example-13'] }], apps: [{ ...vscode, sessions }] }
  }
  if (mode === 'many') {
    const window = (usedPercentage: number, hours: number) => ({ usedPercentage, resetsAt: new Date(Date.now() + hours * 3_600_000).toISOString() })
    const spare = (key: string, fiveHour: number, week: number, patch: Partial<AccountEntry>) =>
      fakeEntry({
        key,
        global: false,
        status: { ...FAKE_ACCOUNT, email: `${key}@example.com`, subscriptionType: 'pro' },
        loginExpiresAt: inDays(25),
        sessions: ['ABC-9'],
        limits: { ...limits, fiveHour: window(fiveHour, 2.8), sevenDay: window(week, 100) },
        ...patch,
      })
    // The shared pool moved to jane.roe; XYZ and OPS kept a folder of their own.
    const spent = { ...global, projects: [], limits: { ...limits, fiveHour: null, sevenDay: window(100, 10.5) } }
    const pool = [
      { project: null, provider: CLAUDE, account: 'jane.roe' },
      { project: null, provider: CODEX, account: 'codex' },
      { project: 'XYZ', provider: CLAUDE, account: 'richard.roe' },
      { project: 'OPS', provider: CLAUDE, account: 'baby.doe' },
    ]
    const accounts = [
      spent,
      { ...work, projects: ['ABC', 'DEMO'], limits },
      spare('richard.roe', 96, 36, { projects: ['XYZ'] }),
      spare('baby.doe', 99, 14, { projects: ['OPS'] }),
    ]
    return { ...signedIn, active: 'jane.roe', accounts, pool }
  }
  if (mode === 'api-noAdc') return { ...fakeAccount('api', idle, limits), gcloud: { ...FAKE_GCLOUD, adcType: null } }
  if (mode === 'api-noAz') return { ...fakeAccount('api', idle, limits), azure: { ...FAKE_AZURE, signedIn: false } }
  if (mode === 'api' || mode === 'spend' || mode === 'spendUnknown') {
    const lost = apiEntry('old-key', { status: { loggedIn: false, authMethod: 'none', email: null, orgName: null, subscriptionType: null }, needsLogin: true })
    const spendingLimit = mode === 'api' ? null : { resetsAt: mode === 'spendUnknown' ? null : '2026-11-01T00:00:00.000Z' }
    const bedrock = apiEntry('bedrock', {
      name: 'AWS work',
      apiKey: false,
      keyReplaceable: false,
      cloud: { cloud: 'bedrock', region: 'eu-central-1', way: 'profile', profile: 'bedrock-prod', models: {}, shortLived: false },
      status: { loggedIn: true, authMethod: 'third_party', email: 'bedrock', orgName: null, subscriptionType: null },
    })
    const vertex = apiEntry('vertex', {
      name: 'Vertex prod',
      apiKey: false,
      keyReplaceable: false,
      cloud: { cloud: 'vertex', region: 'global', way: 'keyFile', project: 'example-vertex-prod', models: {}, shortLived: false },
      status: { loggedIn: true, authMethod: 'third_party', email: 'vertex', orgName: null, subscriptionType: null },
    })
    const foundry = apiEntry('foundry', {
      name: 'Foundry team',
      apiKey: false,
      keyReplaceable: false,
      cloud: { cloud: 'foundry', region: null, way: 'apiKey', resource: 'example-foundry', models: { sonnet: 'my-sonnet', haiku: 'my-haiku' }, shortLived: false },
      checkedModel: 'my-sonnet',
      status: { loggedIn: true, authMethod: 'third_party', email: 'foundry', orgName: null, subscriptionType: null },
    })
    const accounts = [global, work, apiEntry('ci-key', { name: 'CI key', sessions: ['ABC-5'], spendingLimit }), lost, bedrock, vertex, foundry]
    return { ...signedIn, active: 'ci-key', accounts }
  }
  if (mode === 'codex') {
    const codex = codexEntry('codex', 'john.doe@example.com', 'free', {
      global: true,
      limits: { ...limits, fiveHour: null, sevenDay: null, month: { usedPercentage: 12, resetsAt: new Date(Date.now() + 11 * 86_400_000).toISOString() } },
    })
    // OPS runs on Codex, on a paid folder of its own.
    const paid = codexEntry('jane.roe-2', 'jane.roe@example.com', 'plus', { limits, projects: ['OPS'] })
    // A plan that turned free next to the free one: held, with the warning on its card.
    const extra = codexEntry('baby.doe', 'baby.doe@example.com', 'free')
    const own = { ...global, projects: FAKE_PROJECTS.filter((project) => project !== 'OPS') }
    const pool = [...SHARED_POOL, { project: 'OPS', provider: CODEX, account: 'jane.roe-2' }]
    return { ...signedIn, accounts: [own, work, apiEntry('ci-key', { name: 'CI key' }), codex, paid, extra], pool }
  }
  if (mode === 'opencodeCopilot') {
    const base = fakeAccount('opencode', idle, limits)
    const copilot = fakeEntry({
      key: 'opencode-2', name: 'OpenCode 2', agent: OPENCODE, global: false, loginExpiresAt: null,
      status: { ...OPENCODE_STATUS, authMethod: 'oauth', subscriptionType: 'github-copilot' },
      limits: { fiveHour: null, sevenDay: null, month: { usedPercentage: 20, left: 40, resetsAt: new Date(Date.now() + 9 * 86_400_000).toISOString() }, source: 'api', updatedAt: ago(2) },
    })
    const mixed = { ...copilot, key: 'opencode-mixed', name: 'OpenCode with API key', status: { ...copilot.status!, subscriptionType: 'github-copilot, anthropic' }, apiKey: true }
    return { ...base, accounts: [...base.accounts.filter(entry => entry.key !== copilot.key), copilot, mixed] }
  }
  if (mode === 'opencode') {
    // OPS runs on OpenCode's free models, which have no limits; a second folder signs in with the ChatGPT account the
    // Codex folder is on, and shows their one limit.
    const none = stale(notice('usage.openCodeNone', {}))
    const free = fakeEntry({
      key: 'opencode',
      global: false,
      agent: OPENCODE,
      status: { ...OPENCODE_STATUS, authMethod: 'none' },
      loginExpiresAt: null,
      projects: ['OPS'],
      usage: none,
      lastLimitAt: ago(95),
    })
    const shared = { ...limits, source: 'api' as const, pool: 'chatgpt:acc-1' }
    const chatgpt = fakeEntry({
      key: 'opencode-2',
      global: false,
      agent: OPENCODE,
      status: { ...OPENCODE_STATUS, authMethod: 'oauth', subscriptionType: 'openai' },
      loginExpiresAt: null,
      limits: shared,
      projects: ['DEMO'],
    })
    const codex = codexEntry('codex', 'john.doe@example.com', 'plus', { limits: { ...shared, source: 'usage' } })
    const own = { ...global, projects: FAKE_PROJECTS.filter((project) => project !== 'OPS' && project !== 'DEMO') }
    const pool = [...SHARED_POOL, { project: 'OPS', provider: OPENCODE, account: 'opencode' }, { project: 'DEMO', provider: OPENCODE, account: 'opencode-2' }]
    return { ...signedIn, accounts: [own, work, free, chatgpt, codex], pool }
  }
  if (mode === 'copilot' || mode === 'copilot-out' || mode === 'copilot-unknown' || mode === 'copilot-out-cmd') {
    // OPS runs on the machine's own Copilot sign-in, which has no allowance to read; a second folder has a token of its
    // own and shows what is left of its month. `copilot-out`: the CLI sees no sign-in in the folder (EKR-73).
    const out = mode === 'copilot-out' || mode === 'copilot-out-cmd'
    const machine = fakeEntry({
      key: 'copilot',
      global: false,
      agent: COPILOT,
      status: { ...OPENCODE_STATUS, authMethod: 'none', loggedIn: mode === 'copilot-unknown' ? null : !out },
      loginExpiresAt: null,
      projects: ['OPS'],
      usage: stale(notice('usage.copilotMachine', {})),
      ...(out && { needsLogin: true, terminalLogin: mode === 'copilot-out-cmd'
        ? 'cmd /d /v:off /c set "COPILOT_GITHUB_TOKEN=" ^& set "GH_TOKEN=" ^& set "GITHUB_TOKEN=" ^& set "COPILOT_HOME=C:\\Fake path\\copilot" ^& "C:\\Fake bin\\copilot.exe" login'
        : "(unset COPILOT_GITHUB_TOKEN GH_TOKEN GITHUB_TOKEN; COPILOT_HOME='/home/node/.copilot-accounts/copilot' 'copilot' login)" }),
    })
    const month = { usedPercentage: 60, resetsAt: new Date(Date.now() + 9 * 86_400_000).toISOString(), left: 120 }
    const allowance = { fiveHour: null, sevenDay: null, month, updatedAt: ago(2), source: 'api' as const }
    const token = fakeEntry({
      key: 'github',
      global: false,
      agent: COPILOT,
      status: { ...OPENCODE_STATUS, authMethod: 'api_key' },
      apiKey: true,
      loginExpiresAt: null,
      limits: allowance,
      projects: ['DEMO'],
    })
    const own = { ...global, projects: FAKE_PROJECTS.filter((project) => project !== 'OPS' && project !== 'DEMO') }
    const pool = [...SHARED_POOL, { project: 'OPS', provider: COPILOT, account: 'copilot' }, { project: 'DEMO', provider: COPILOT, account: 'github' }]
    return { ...signedIn, accounts: [own, work, machine, token], pool }
  }
  if (mode === 'vscode-broken') {
    return { ...signedIn, apps: [{ ...vscode, account: null, dir: null, error: notice('vscode.notJson', {}) }] }
  }
  return signedIn
}

/** The state with `account`: a folder added for an agent with no account in the shared pool becomes it, as `claimShared` does. */
export function withAccount(state: EvenKeelState, account: AccountView): EvenKeelState {
  const before = new Set(state.account.accounts.map((entry) => entry.key))
  let shared = state.config.shared.accounts
  for (const entry of account.accounts) {
    if (before.has(entry.key)) continue
    const current = shared[entry.agent]
    if (current !== undefined && account.accounts.some((each) => each.key === current && each.agent === entry.agent)) continue
    shared = { ...shared, [entry.agent]: entry.key }
  }
  return { ...state, account, config: { ...state.config, shared: { ...state.config.shared, accounts: shared } } }
}

export function accountCommand(account: AccountView, name: string, body: Record<string, unknown>): AccountView {
  if (name === 'account/discover') {
    const agent = String(body.agent)
    return account.globalCheck?.agent === agent ? account : { ...account, globalCheck: { agent, account: null } }
  }
  if (name === 'account/global') {
    const candidate = account.globalCheck?.account
    if (candidate == null) throw fail('account.unknown', { key: String(body.agent) })
    if (candidate.status.orgName === 'refused') throw fail('account.needsLogin', { account: candidate.status.email ?? '' })
    const entry = fakeEntry({ key: candidate.key, agent: String(body.agent), status: candidate.status, global: true })
    return { ...account, globalCheck: undefined, accounts: [...account.accounts, entry] }
  }
  const key = String(body.account)
  if (name === 'account/add' || name === 'account/renew') {
    if (account.login !== null && account.login.error === null) throw fail('login.running', {})
    if (name === 'account/renew' && key === account.active && account.loginBlock !== null) throw new NoticeError(loginBlockNotice(account.loginBlock))
    const target = name === 'account/add' ? null : key
    const agent = name === 'account/add' ? String(body.agent ?? CLAUDE) : (account.accounts.find((entry) => entry.key === key)?.agent ?? CLAUDE)
    const method = typeof body.method === 'string' ? body.method : undefined
    // OpenCode's free models and the machine's Copilot sign-in add a folder at once, as the service does.
    if (method === NO_SIGN_IN) {
      const key = folderName(agent, account.accounts.map((entry) => entry.key))
      const placed = rawEntry({ key, agent, global: false, status: OPENCODE_STATUS, loginExpiresAt: null })
      return { ...account, accounts: [...account.accounts, placed] }
    }
    return { ...account, login: { ...(FAKE_LOGINS[agent] ?? FAKE_LOGIN), agent, ...(method !== undefined && { method }), target, startedAt: ago(0) } }
  }
  // A management key reads the balance before it is kept (BTN-868): "rejected" and "offline" in it act out the refusals.
  if (name === 'account/management-key') {
    const value = body.key === null ? '' : String(body.key).trim()
    if (value.includes('rejected')) throw fail('account.managementKeyRejected', {})
    if (value.includes('offline')) throw fail('account.managementKeyUnchecked', { reason: 'fetch failed' })
    const read = value === '' ? { managementKey: false, balance: undefined } : { managementKey: true, balance: { usd: 42.17, at: ago(0) } }
    return { ...account, accounts: account.accounts.map((entry) => (entry.key === key ? { ...entry, ...read } : entry)) }
  }
  if (name === 'account/api' || name === 'account/key') {
    const agent = name === 'account/key' ? (account.accounts.find((entry) => entry.key === key)?.agent ?? CLAUDE) : body.agent
    const value = String(body.key).trim()
    const kind = agent === COPILOT ? 'copilotToken' : agent === CODEX ? 'codexKey' : 'apiKey'
    const token = kind !== 'copilotToken' || /^(github_pat_|gho_|ghu_)/.test(value)
    if (!/^\S{21,}$/.test(value) || !token) throw fail(`account.${kind}Invalid`, {})
    if (value.includes('rejected')) throw fail(`account.${kind}Rejected`, {})
    if (value.includes('offline')) throw fail(`account.${kind}Unchecked`, { reason: 'fetch failed' })
    // A key of another organization than the account's is another account (BTN-418).
    if (name === 'account/key') {
      if (value.includes('other-org')) throw fail('account.keyOtherOrganization', { agent: String(agent) })
      const working = { needsLogin: false, status: { loggedIn: true, authMethod: 'api_key', email: key, orgName: null, subscriptionType: null } }
      return { ...account, accounts: account.accounts.map((entry) => (entry.key === key ? { ...entry, ...working } : entry)) }
    }
    const given = String(body.name ?? '').trim()
    const folder = folderName(given || 'api', account.accounts.map((entry) => entry.key))
    const entry = apiEntry(folder, { name: given || null, agent: String(body.agent ?? CLAUDE) })
    return { ...account, accounts: [...account.accounts, entry] }
  }
  if (name === 'account/aws') return { ...account, aws: FAKE_AWS }
  if (name === 'account/gcloud') return { ...account, gcloud: account.gcloud ?? FAKE_GCLOUD }
  if (name === 'account/azure') return { ...account, azure: account.azure ?? FAKE_AZURE }
  if (name === 'account/cloud') {
    // The service checks with one turn: a profile, a project or a resource named "missing" fails as the cloud answers when it finds no credentials.
    const connection = cloudConnectionOf(body)
    if (connection.cloud === 'bedrock' && connection.auth.way === 'profile' && connection.auth.profile === 'missing') {
      throw new NoticeError(notice('cloud.awsCredentials', { user: FAKE_AWS.user, home: FAKE_AWS.home }))
    }
    if (connection.cloud === 'vertex' && connection.projectId === 'missing') {
      throw new NoticeError(notice('cloud.gcpCredentials', { user: FAKE_GCLOUD.user, home: FAKE_GCLOUD.home }))
    }
    if (connection.cloud === 'foundry' && 'resource' in connection.endpoint && connection.endpoint.resource === 'missing') {
      throw new NoticeError(notice('cloud.azureCredentials', { user: FAKE_AZURE.user, home: FAKE_AZURE.home }))
    }
    const given = String(body.name ?? '').trim()
    const folder = folderName(given || connection.cloud, account.accounts.map((entry) => entry.key))
    const cloud = cloudOf(
      cloudEnv(connection),
      (profile) => FAKE_AWS.profiles.some((each) => each.name === profile && each.shortLived),
      (keyFile) => keyFile === null && FAKE_GCLOUD.adcType === 'authorized_user',
    )!
    const checkedModel =
      connection.cloud === 'vertex' ? 'claude-sonnet-4-5@20250929'
      : connection.cloud === 'foundry' ? (connection.models.sonnet ?? connection.models.opus ?? connection.models.haiku)
      : 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
    const entry = apiEntry(folder, { name: given || null, apiKey: false, keyReplaceable: false, cloud, checkedModel,
      status: { loggedIn: true, authMethod: 'third_party', email: folder, orgName: null, subscriptionType: null } })
    return { ...account, accounts: [...account.accounts, entry] }
  }
  if (name === 'account/switch') {
    const problem = switchProblem(account, key)
    if (problem !== undefined) throw new NoticeError(problem)
    return { ...account, active: key }
  }
  if (name === 'account/app') {
    const problem = appSwitchProblem(account, String(body.app), key)
    if (problem !== undefined) throw new NoticeError(problem)
    return { ...account, apps: account.apps.map((app) => (app.app === body.app ? { ...app, account: key } : app)) }
  }
  if (name === 'account/remove') {
    const problem = removeProblem(account, key)
    if (problem !== undefined) throw new NoticeError(problem)
    const busy = account.accounts.some((entry) => entry.key === key && entry.sessions.length > 0)
    if (busy) return { ...account, accounts: account.accounts.map((entry) => (entry.key === key ? { ...entry, removing: true } : entry)) }
    return { ...account, accounts: account.accounts.filter((entry) => entry.key !== key) }
  }
  if (name === 'account/keep') {
    return { ...account, accounts: account.accounts.map((entry) => (entry.key === key ? { ...entry, removing: false } : entry)) }
  }
  if (name === 'account/name') {
    const given = String(body.name ?? '').trim()
    return { ...account, accounts: account.accounts.map((entry) => (entry.key === key ? { ...entry, name: given === '' ? null : given } : entry)) }
  }
  if (name === 'account/cancel') return { ...account, login: null }
  if (name === 'account/code') {
    const { login } = account
    if (login === null) throw fail('login.none', {})
    if (String(body.code).trim() === 'fail') {
      return { ...account, login: { ...login, error: notice('login.exited', { code: '1' }, { detail: 'Invalid code' }) } }
    }
    const renewed = { loginExpiresAt: inDays(30), needsLogin: false }
    if (login.target === null) {
      const added =
        login.agent === CODEX
          ? codexEntry('richard.roe', 'richard.roe@example.com', 'plus')
          : fakeEntry({ key: 'richard.roe', agent: login.agent, global: false, status: { ...FAKE_ACCOUNT, email: 'richard.roe@example.com' }, ...renewed })
      return { ...account, accounts: [...account.accounts, added], login: null }
    }
    const accounts = account.accounts.map((entry) =>
      entry.key === login.target ? { ...entry, ...renewed, status: entry.status ?? FAKE_ACCOUNT } : entry,
    )
    return { ...account, accounts, login: null }
  }
  throw new Error(`fake: ${name} is not supported`)
}
