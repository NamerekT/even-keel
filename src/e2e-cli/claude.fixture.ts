import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { claude } from '../claude/adapter.js'
import { claudeBinaryIn, fetchClaude } from '../claude/release.js'
import { ACCOUNT } from '../e2e/service.fixture.js'
import { checkedCopy, type CliKit } from './kit.fixture.js'

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
