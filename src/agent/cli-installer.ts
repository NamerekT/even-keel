import { spawn as spawnProcess } from 'node:child_process'
import type { EventEmitter } from 'node:events'
import { posix, win32 } from 'node:path'
import { stripAnsi } from '../ansi.js'
import { fail } from '../notice/notice.js'
import { installCommand } from './install-command.js'

/** An install of an agent's CLI the page started (BTN-1502), under way or the last one ended, with what it printed. */
export interface CliInstallView {
  agent: string
  command: string
  startedAt: string
  /** stdout and stderr as they came, without terminal escapes, the last `INSTALL_OUTPUT_MAX` characters. */
  output: string
  /** `done` — the installer exited 0; `failed` — another exit, a timeout, or it did not start. */
  state: 'running' | 'done' | 'failed'
}

export const INSTALL_OUTPUT_MAX = 20_000
/** How long an installer may run before it is stopped and the install counts as failed. */
export const CLI_INSTALL_TIMEOUT_MS = 10 * 60_000

/** What the installer needs of a child process, so a test can give its own. */
export interface InstallerChild extends EventEmitter {
  stdout: EventEmitter | null
  stderr: EventEmitter | null
  kill(): boolean
}

export interface CliInstallerOptions {
  platform: NodeJS.Platform
  /** The agents whose CLI the service's user can install here (`installableClis`). */
  installable: () => string[]
  title: (agent: string) => string
  /** The service's environment, the installer's base. */
  env: () => NodeJS.ProcessEnv
  /** The node the service runs on: its folder goes first on the PATH, so `npm` and the scripts find a node. */
  execPath: string
  spawn?: (file: string, args: string[], options: { env: NodeJS.ProcessEnv }) => InstallerChild
  timeoutMs: number
  onChange: () => void
  /** After the installer ends, either way: the CLIs are looked for and asked their version again. */
  onEnd: () => Promise<void>
  log: (line: string) => void
  now: () => Date
}

/** The shell the command runs in: the one the page's command is written for, PowerShell on Windows. */
export function installerLine(command: string, platform: NodeJS.Platform): { file: string; args: string[] } {
  return platform === 'win32'
    ? { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command] }
    : { file: '/bin/sh', args: ['-c', command] }
}

function withNodeFirst(env: NodeJS.ProcessEnv, execPath: string, platform: NodeJS.Platform): NodeJS.ProcessEnv {
  const path = platform === 'win32' ? win32 : posix
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH'
  const folders = [path.dirname(execPath), ...(env[key] ?? '').split(path.delimiter).filter((folder) => folder !== '')]
  return { ...env, [key]: [...new Set(folders)].join(path.delimiter) }
}

const spawnInstaller = (file: string, args: string[], options: { env: NodeJS.ProcessEnv }): InstallerChild =>
  spawnProcess(file, args, { env: options.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })

/**
 * Runs the official installer of an agent's CLI as the service's user (BTN-1502), one at a time: the command the page
 * showed before the press, its output into the accounts panel (`AccountView.install`). The user's own CLI: Even Keel's
 * copies are downloaded by `cli/download`, not here.
 */
export class CliInstaller {
  private current: CliInstallView | null = null

  constructor(private readonly options: CliInstallerOptions) {}

  /** The command of each agent this machine can install, the page's "Install" and the line it shows above. */
  commands(): Record<string, string> {
    return Object.fromEntries(this.options.installable().flatMap((agent) => {
      const command = installCommand(agent, this.options.platform)
      return command === '' ? [] : [[agent, command]]
    }))
  }

  /** A copy: the machine's facts compare the panel with the one posted before. */
  view(): CliInstallView | null {
    return this.current === null ? null : { ...this.current }
  }

  /** "Check again" after an install by hand: the CLIs looked for and asked their version, as after the button's. */
  recheck(): Promise<void> {
    return this.options.onEnd()
  }

  start(agent: string): void {
    const title = this.options.title(agent)
    if (this.current?.state === 'running') throw fail('agent.installRunning', { title: this.options.title(this.current.agent) })
    const command = this.commands()[agent]
    if (command === undefined) throw fail('agent.installNone', { title })
    const view: CliInstallView = { agent, command, startedAt: this.options.now().toISOString(), output: '', state: 'running' }
    this.current = view
    this.options.log(`agents: installing ${title}: ${command}`)
    const append = (text: string) => {
      view.output = (view.output + stripAnsi(text)).slice(-INSTALL_OUTPUT_MAX)
      this.options.onChange()
    }
    let ended = false
    const end = (state: CliInstallView['state'], why: string) => {
      if (ended) return
      ended = true
      clearTimeout(timer)
      view.state = state
      this.options.log(`agents: the installer of ${title} ${why}`)
      this.options.onChange()
      void this.options.onEnd().catch((error: unknown) => this.options.log(`agents: after installing ${title}: ${String(error)}`))
    }
    const { file, args } = installerLine(command, this.options.platform)
    const child = (this.options.spawn ?? spawnInstaller)(file, args, { env: withNodeFirst(this.options.env(), this.options.execPath, this.options.platform) })
    const timer = setTimeout(() => {
      append(`\nStopped after ${Math.round(this.options.timeoutMs / 60_000)} min.\n`)
      child.kill()
      end('failed', 'ran out of time')
    }, this.options.timeoutMs)
    timer.unref?.()
    child.stdout?.on('data', (chunk: Buffer) => append(chunk.toString()))
    child.stderr?.on('data', (chunk: Buffer) => append(chunk.toString()))
    child.on('error', (error: Error) => {
      append(`${error.message}\n`)
      end('failed', `did not start: ${error.message}`)
    })
    child.on('close', (code: number | null) => end(code === 0 ? 'done' : 'failed', `exited with ${code}`))
    this.options.onChange()
  }
}
