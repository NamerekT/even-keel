import { exec } from 'node:child_process'
import type { AccountHome } from '../account/homes.js'
import type { CheckFailure } from '../chain/model.js'
import { fail } from '../notice/notice.js'

export type Shell = (command: string, cwd: string) => Promise<{ code: number; out: string }>

export interface SetupRun {
  task: string
  cwd: string
  shell: Shell
  log: (line: string) => void
}

const COMMAND_TIMEOUT_MS = 20 * 60_000
/** Lines of a failed command's output that go into the notice; the whole output is in the service log. */
const TAIL_LINES = 40

/** The project's `commands.beforeStart`, in order, in the task's folder; the first failure stops the rest. */
export async function runBeforeStart(commands: string[], { task, cwd, shell, log }: SetupRun): Promise<void> {
  for (const command of commands) {
    log(`setup: ${task}: ${command} in ${cwd}`)
    const { code, out } = await shell(command, cwd)
    const lines = out.split(/\r?\n/).filter((line) => line.trim() !== '')
    for (const line of lines) log(`setup: ${task}: | ${line}`)
    if (code !== 0) throw fail('setup.failed', { task, command, code }, { detail: lines.slice(-TAIL_LINES).join('\n') })
  }
}

/** The project's `commands.check` on main, in order, in the task's folder; the first failure is returned, the rest do not run. */
export function runCheck(commands: string[], run: SetupRun): Promise<CheckFailure | null> {
  return runUntilFailure('check', commands, run)
}

/** The project's `commands.afterGreen`, in order, in its checkout (`task` is the project); the first failure is returned, the rest do not run. */
export function runAfterGreen(commands: string[], run: SetupRun): Promise<CheckFailure | null> {
  return runUntilFailure('afterGreen', commands, run)
}

async function runUntilFailure(stage: string, commands: string[], { task, cwd, shell, log }: SetupRun): Promise<CheckFailure | null> {
  for (const command of commands) {
    log(`${stage}: ${task}: ${command} in ${cwd}`)
    const { code, out } = await shell(command, cwd)
    if (code === 0) continue
    for (const line of out.split(/\r?\n/).filter((each) => each.trim() !== '')) log(`${stage}: ${task}: | ${line}`)
    return { command, code, output: out }
  }
  return null
}

/**
 * The environment of a project's commands: that of the account the task's session runs on, through that account's
 * agent, or the service's own `own` while the account has no folder — a Codex-only install has no Claude one (EKR-26).
 */
export function accountEnv(
  account: string,
  find: (key: string) => AccountHome | undefined,
  envOf: (home: AccountHome) => NodeJS.ProcessEnv,
  own: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const home = find(account)
  return home === undefined ? own : envOf(home)
}

/** Runs a command through the system shell (`cmd.exe` on Windows), output and errors together. */
export function systemShell(env: () => NodeJS.ProcessEnv): Shell {
  return (command, cwd) =>
    new Promise((resolve) => {
      exec(command, { cwd, env: env(), timeout: COMMAND_TIMEOUT_MS, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        const out = [stdout, stderr].map((text) => text.trim()).filter(Boolean).join('\n')
        if (error === null) resolve({ code: 0, out })
        else resolve({ code: typeof error.code === 'number' ? error.code : -1, out: out || error.message })
      })
    })
}
