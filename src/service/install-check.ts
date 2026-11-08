import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { listenOf, localUrlOf } from '../config.js'
import { loadEnv } from '../locations.js'

export interface ServiceStatus {
  present: boolean
  running: boolean
  details: string
}

type Command = (file: string, args: string[]) => { ok: boolean; text: string }
const WAIT_MS = 60_000

const command: Command = (file, args) => {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 2_000 })
  return { ok: result.status === 0, text: [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n').trim() }
}

export function inspectService(platform: string, target: string, run: Command = command): ServiceStatus {
  if (platform === 'darwin') {
    const result = run('launchctl', ['print', target])
    const field = (name: string) => result.ok ? result.text.match(new RegExp(`^\\s*${name} = (.+)$`, 'm'))?.[1]?.trim() : undefined
    const pid = field('pid')
    const details = ['state', 'pid', 'last exit code'].map((name) => `${name} = ${field(name) ?? 'unavailable'}`).join('\n')
    return { present: result.ok, running: result.ok && /^[1-9]\d*$/.test(pid ?? ''), details: result.ok ? details : `${details}\n${result.text}` }
  }
  const result = run('systemctl', ['--user', 'is-active', target])
  const state = result.text.trim()
  return { present: result.ok || state === 'activating', running: result.ok && state === 'active', details: `state = ${state || 'unavailable'}` }
}

export async function waitForService(url: string, inspect: () => ServiceStatus): Promise<{ ready: boolean; status: ServiceStatus; reason?: string }> {
  const deadline = Date.now() + WAIT_MS
  let status = inspect()
  let answer = 'no HTTP answer'
  while (status.present && Date.now() < deadline) {
    if (status.running) {
      try {
        const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(Math.max(1, Math.min(1_000, deadline - Date.now()))) })
        await response.body?.cancel()
        answer = `HTTP ${response.status}`
        status = inspect()
        if (status.running && ((response.status >= 200 && response.status < 400) || [401, 403].includes(response.status))) return { ready: true, status }
        if (!status.present) break
      } catch {
        answer = 'no HTTP answer'
      }
    }
    const delay = Math.max(0, Math.min(1_000, deadline - Date.now()))
    await new Promise((resolve) => setTimeout(resolve, delay))
    status = inspect()
  }
  return { ready: false, status, reason: status.present ? `not ready at ${url} within 60 s (${answer})` : 'the service is no longer loaded or active' }
}

export async function checkInstallation(platform: string, target: string, log: string, failed = false): Promise<number> {
  const inspect = () => inspectService(platform, target)
  let status = inspect()
  let reason = 'the service manager refused to start the service'
  if (!failed) {
    try {
      loadEnv()
      const url = `${localUrlOf(listenOf(process.env))}/`
      const result = await waitForService(url, inspect)
      if (result.ready) return 0
      status = result.status
      reason = result.reason!
    } catch (error) {
      reason = String(error)
    }
  }
  console.error(`install: ${reason}\n${status.details}`)
  const tail = platform === 'darwin' ? command('tail', ['-n', '40', log]) : command('journalctl', ['--user', '-u', target, '-n', '40', '--no-pager'])
  console.error(`Recent service log:\n${tail.ok && tail.text ? tail.text : `unavailable${tail.text ? `: ${tail.text}` : ' (empty or missing)'}`}`)
  if (platform === 'darwin') console.error('Check System Settings → General → Login Items → Allow in the Background (the entry may be named node). Sign in to this user’s desktop and run the installer again. The agent is left installed.')
  else console.error(`Check systemctl --user status ${target}, fix the reported error and run the installer again. The unit is left installed.`)
  return 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = await checkInstallation(process.argv[2]!, process.argv[3]!, process.argv[4] ?? '', process.argv[5] === '--failed')
}
