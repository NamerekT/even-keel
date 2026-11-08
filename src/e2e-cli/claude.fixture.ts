import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { killTree } from '../agent/process.js'
import { claude, CLAUDE_SDK } from '../claude/adapter.js'
import { CLAUDE } from '../claude/name.js'
import { claudeBinaryIn, fetchClaude } from '../claude/release.js'
import { parseSdkSession, SDK_KIND } from '../claude/sdk/registry.js'
import { fetchSdk, sdkModuleIn, sdkVersionOf } from '../claude/sdk/release.js'
import { ACCOUNT, type Harness } from '../e2e/service.fixture.js'
import { checkedCopy, type CliKit } from './kit.fixture.js'

/** The CLI's remote default that decides whether it reads a lone `AGENTS.md` (CLI 2.1.319, `cachedGrowthBookFeatures`). */
export const AGENTS_MD_FLAG = 'tengu_agents_md_mod'

/** The bench's key: any text, the scripted model reads none; the CLI takes it only once `.claude.json` approves it. */
const BENCH_KEY = 'local-only-scripted-bench'

/**
 * What a session may run with no one to ask. A custom base URL turns `auto` mode's safety check off (CLI 2.1.319: "its
 * safety check does not run for this session"), so every call that needs the check is denied; an allow rule is
 * honoured before it. The scenarios' git commands and the package server `notes`.
 */
const ALLOWED = ['Bash(git commit:*)', 'Bash(git -C:*)', 'mcp__notes']

/**
 * The checked Claude Code (`claude.checked`) on `--bg` sessions and its daemon, the account `ACCOUNT` of the bench
 * signed in by an API key against the scripted model's Messages API (`ANTHROPIC_BASE_URL`). The daemon is started by
 * the first launch with the service's environment and keeps it (`docs/accounts.md`), so the variables are set before
 * the service starts and the daemon is stopped after each scenario.
 */
export const claudeCode: CliKit = {
  title: 'Claude Code',
  agent: 'claude',
  binary: () => checkedCopy('claude', claude.checked, claudeBinaryIn, (folder) => fetchClaude(claude.checked, folder)),
  configure() {},
  prepare(run, binary, baseURL) {
    process.env.EVEN_KEEL_CLAUDE_BIN = binary
    signIn(run, baseURL)
  },
  release(run, binary) {
    const env = { ...process.env, CLAUDE_CONFIG_DIR: join(run.dir, 'accounts', ACCOUNT) }
    try {
      execFileSync(binary, ['daemon', 'stop', '--any'], { env, timeout: 60_000, windowsHide: true, stdio: 'ignore' })
    } catch {
      // No daemon was started, or it is gone already.
    }
  },
}

/** The checked SDK's module (`binary` of `claudeSdk`), kept for `prepare`, which runs once the bench's environment hides `EVEN_KEEL_E2E_CLI_DIR`. */
let sdkModule: string | undefined

/**
 * The same CLI and account on sessions of kind `sdk` (BTN-818): the Agent SDK of the CLI's version drives the CLI
 * through its executor. The SDK runs only on Even Keel's own pinned copy, which `EVEN_KEEL_CLAUDE_BIN` turns off, so
 * the checked copies of both are linked into the bench's `state/cli/` where the service keeps them, with
 * `cli.claude: checked`, and `execution.claude: sdk` picks the transport. An executor outlives the service, so each
 * scenario kills those its sessions left.
 */
export const claudeSdk: CliKit = {
  title: 'Claude Code (SDK)',
  agent: 'claude',
  kind: SDK_KIND,
  async binary() {
    const version = sdkVersionOf(claude.checked)
    if (version === null) throw new Error(`no Agent SDK goes with Claude Code ${claude.checked}`)
    sdkModule = await checkedCopy(CLAUDE_SDK, version, sdkModuleIn, (folder) => fetchSdk(version, folder))
    return claudeCode.binary()
  },
  configure(run) {
    run.config.cli = { [CLAUDE]: 'checked' }
    run.config.execution = { [CLAUDE]: 'sdk' }
  },
  prepare(run, binary, baseURL) {
    signIn(run, baseURL)
    for (const [name, file] of [[CLAUDE, binary], [CLAUDE_SDK, sdkModule!]] as const) {
      const link = join(stateOf(run), 'cli', name, basename(dirname(file)))
      mkdirSync(dirname(link), { recursive: true })
      symlinkSync(dirname(file), link, 'junction')
    }
  },
  async release(run) {
    const sessions = join(stateOf(run), CLAUDE_SDK, 'sessions')
    for (const name of existsSync(sessions) ? readdirSync(sessions) : []) {
      const session = parseSdkSession(readFileSync(join(sessions, name), 'utf8'))
      if (session !== undefined && session.stopped !== true) await killTree(session.executor, 'SIGKILL')
    }
    // The links go before the bench's folder, so that its removal never reaches into the copies.
    for (const name of [CLAUDE, CLAUDE_SDK]) {
      const folder = join(stateOf(run), 'cli', name)
      for (const version of existsSync(folder) ? readdirSync(folder) : []) unlinkSync(join(folder, version))
    }
  },
}

/** The bench service's `state/`. */
function stateOf(run: Harness): string {
  return join(run.dir, 'data', 'state')
}

/**
 * Signs the account `ACCOUNT` in by the bench's key against the scripted model at `baseURL` (with `/v1`), in the
 * service's environment, which every session inherits.
 */
function signIn(run: Harness, baseURL: string): void {
  Object.assign(process.env, {
    ANTHROPIC_BASE_URL: baseURL.replace(/\/v1$/, ''),
    ANTHROPIC_API_KEY: BENCH_KEY,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
    // A package's MCP tools come in the requests themselves, not behind ToolSearch, so the script finds them by name.
    ENABLE_TOOL_SEARCH: 'false',
  })
  const dir = join(run.dir, 'accounts', ACCOUNT)
  // A key from the environment asks the user once at the first interactive start; `--bg` has no one to ask.
  writeFileSync(join(dir, '.claude.json'), JSON.stringify({ hasCompletedOnboarding: true, customApiKeyResponses: { approved: [BENCH_KEY.slice(-20)], rejected: [] } }, null, 2))
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ permissions: { allow: ALLOWED } }, null, 2))
}

/**
 * Gives the account's sessions the CLI's remote defaults, as a live session has them. Under the bench's
 * `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` the CLI neither fetches its flags nor reads their cache in `.claude.json`:
 * so the switch goes before the daemon starts (in `start`'s `prepared`). Without it a `--bg` session takes the flags
 * fresh from Anthropic before its first request, and falls back on the cache when they do not come in time, so one
 * `claude -p` against the scripted model, which must answer meanwhile, fills the cache first. Resolves to the cached
 * flags; none — the CLI reached no Anthropic server, and the sessions run on its built-in defaults. The bench's key is
 * no Anthropic key: the flags are what an API-key user with no account gets.
 */
export function remoteDefaults(run: Harness, binary: string): Promise<Record<string, unknown>> {
  delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
  const dir = join(run.dir, 'accounts', ACCOUNT)
  const child = spawn(binary, ['-p', 'Say ok.'], { cwd: run.dir, env: { ...process.env, CLAUDE_CONFIG_DIR: dir }, windowsHide: true, stdio: 'ignore' })
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', () => {
      const config = JSON.parse(readFileSync(join(dir, '.claude.json'), 'utf8')) as { cachedGrowthBookFeatures?: Record<string, unknown> }
      resolve(config.cachedGrowthBookFeatures ?? {})
    })
  })
}

/**
 * A project rules file of Claude's in a folder above `folder`, or `null`. A lone `AGENTS.md` below one is not read by
 * the CLI, so Even Keel passes it itself (`agentsFallback`) and the scenarios on the CLI's own reading have nothing to
 * check: on Windows `~/.claude/CLAUDE.md` is such a file for the bench's folder in the user's temp once the account is
 * another folder (CLI 2.1.319, BTN-855).
 */
export { claudeRulesAbove } from '../claude/instructions.js'
