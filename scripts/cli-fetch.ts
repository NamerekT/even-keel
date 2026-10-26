import { execFile } from 'node:child_process'
import { appendFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { isMuslLinux } from '../src/agent/npm.js'
import { claude } from '../src/claude/adapter.js'
import { claudeBinaryIn, claudePlatform, fetchClaude } from '../src/claude/release.js'
import { fetchSdk, sdkModuleIn, sdkVersionOf } from '../src/claude/sdk/release.js'
import { codex } from '../src/codex/adapter.js'
import { codexBinaryIn, codexTarget, fetchCodex } from '../src/codex/release.js'
import { copilot } from '../src/copilot/adapter.js'
import { copilotBinaryIn, copilotPackage, fetchCopilot } from '../src/copilot/release.js'
import { opencode } from '../src/opencode/adapter.js'
import { fetchOpenCode, openCodeBinaryIn, openCodePackage } from '../src/opencode/release.js'
import { checkDownloads, downloadSummary, type DownloadCheck } from './cli-fetch-support.js'

const run = promisify(execFile)
const musl = isMuslLinux()
const platform = `${process.platform}-${process.arch}${musl ? '-musl' : ''}`
const codexBuild = codexTarget(process.platform, process.arch)
const sdkVersion = sdkVersionOf(claude.checked)

function native(agent: string, version: string, target: string | null, fetch: (version: string, into: string) => Promise<void>, binary: (into: string) => string): DownloadCheck {
  return {
    agent, version, target,
    async check(into) {
      await mkdir(into)
      await fetch(version, into)
      const { stdout } = await run(binary(into), ['--version'], {
        cwd: into, timeout: 60_000, windowsHide: true,
        env: { ...process.env, COPILOT_AUTO_UPDATE: 'false' },
      })
      return stdout
    },
  }
}

const checks: DownloadCheck[] = [
  native('claude', claude.checked, claudePlatform(process.platform, process.arch, musl), fetchClaude, claudeBinaryIn),
  {
    agent: 'claude-sdk', version: sdkVersion ?? 'unknown', target: '@anthropic-ai/claude-agent-sdk',
    async check(into) {
      if (sdkVersion === null) throw new Error(`no SDK version paired with Claude ${claude.checked}`)
      await mkdir(into)
      await fetchSdk(sdkVersion, into)
      // The SDK has no --version binary: load its module in a separate process and read its package version.
      const { stdout } = await run(process.execPath, ['--input-type=module', '-e', `
        import { readFileSync } from 'node:fs';
        import { pathToFileURL } from 'node:url';
        const sdk = await import(pathToFileURL(process.argv[1]).href);
        if (typeof sdk.query !== 'function') throw new Error('SDK has no query export');
        console.log(JSON.parse(readFileSync(process.argv[2], 'utf8')).version);
      `, sdkModuleIn(into), join(into, 'package.json')], { cwd: into, timeout: 60_000, windowsHide: true })
      return stdout
    },
  },
  native('codex', codex.checked, codexBuild === null ? null : `@openai/codex@${codex.checked}-${codexBuild.suffix} (${codexBuild.triple})`, fetchCodex, (into) => codexBinaryIn(into, codexBuild!)),
  native('opencode', opencode.checked, openCodePackage(process.platform, process.arch, musl), fetchOpenCode, openCodeBinaryIn),
  native('copilot', copilot.checked, copilotPackage(process.platform, process.arch, musl), fetchCopilot, copilotBinaryIn),
]

async function main(): Promise<void> {
  const temp = join(process.cwd(), '.temp')
  await mkdir(temp, { recursive: true })
  const root = await mkdtemp(join(temp, 'cli-fetch-'))
  console.log(`cli-fetch: ${platform}, Node ${process.version}`)
  try {
    const { rows, failed } = await checkDownloads(checks, root, platform)
    console.table(rows)
    if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, downloadSummary(rows))
    process.exitCode = failed ? 1 : 0
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 3 })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
