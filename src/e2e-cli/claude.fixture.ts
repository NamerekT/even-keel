import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { claude } from '../claude/adapter.js'
import { claudeBinaryIn, fetchClaude } from '../claude/release.js'
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
    Object.assign(process.env, {
      EVEN_KEEL_CLAUDE_BIN: binary,
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
 * A project rules file of Claude's in a folder above `folder`, or `null`. The CLI reads such files above a checkout, and
 * a lone `AGENTS.md` below one is not read: on Windows `~/.claude/CLAUDE.md` is such a file for the bench's folder in
 * the user's temp once the account is another folder, the chain's worktree too (CLI 2.1.319, BTN-855).
 */
export function claudeRulesAbove(folder: string): string | null {
  for (let dir = dirname(folder); ; dir = dirname(dir)) {
    const found = ['CLAUDE.md', join('.claude', 'CLAUDE.md')].map((name) => join(dir, name)).find((path) => existsSync(path))
    if (found !== undefined) return found
    if (dirname(dir) === dir) return null
  }
}
