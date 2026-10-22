import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UpdatePlan } from './runner.js'

/** Marks a copy of the update process, so `run.js` knows it runs outside the checkout. */
export const COPY_MARK = '.even-keel-update'

/**
 * Copies the compiled update process (`dist/updates/`) into a new folder of the OS's temp: the checkout, `npm ci` and the
 * build then never touch the code running them. ESM needs its `package.json` there too.
 */
export function copyRunner(compiled: string): string {
  if (!existsSync(join(compiled, 'run.js'))) throw new Error(`${join(compiled, 'run.js')} is missing: run npm run build`)
  const folder = mkdtempSync(join(tmpdir(), 'even-keel-update-'))
  cpSync(compiled, folder, { recursive: true, filter: (path) => !path.endsWith('.map') })
  writeFileSync(join(folder, 'package.json'), '{ "type": "module" }\n')
  writeFileSync(join(folder, COPY_MARK), '')
  return folder
}

/**
 * Starts the update process on its own: detached and with no pipe to this one, so it outlives the stop of the service.
 * The Windows service host kills only its node; `KillMode=process` and launchd's `AbandonProcessGroup` keep it alive
 * on Linux and macOS.
 */
export function launchRunner(plan: UpdatePlan, onError: (error: Error) => void): void {
  const folder = copyRunner(join(plan.root, 'dist', 'updates'))
  try {
    const file = join(folder, 'plan.json')
    writeFileSync(file, JSON.stringify(plan, null, 2))
    const child = spawn(process.execPath, [join(folder, 'run.js'), file], { cwd: plan.root, detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', onError)
    child.unref()
  } catch (error) {
    rmSync(folder, { recursive: true, force: true })
    throw error
  }
}
