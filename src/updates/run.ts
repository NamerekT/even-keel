// The update process. `node run.js <plan.json>` — an update or a revert the service planned and started detached;
// The rebuild scripts run it in the foreground after a green push. It copies itself out of the checkout first.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { readCheckout } from './checkout.js'
import { autostartControl, launchdControl, systemdControl, windowsControl } from './control.js'
import { runningBeforeRebuild } from './rebuild.js'
import { COPY_MARK, copyRunner } from './launch.js'
import { ANSWER_MS, dependenciesChanged, LOG_FILE, readPlan, readRecord, RESULT_FILE, runPlan, SETTLE_MS, STEADY_MS, type UpdatePlan } from './runner.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const copied = existsSync(join(here, COPY_MARK))
const [first, ...rest] = process.argv.slice(2)

function namedControl(name: string) {
  if (process.platform === 'win32') return windowsControl(name)
  if (process.platform === 'darwin') return launchdControl(name, userInfo().uid, join(homedir(), 'Library', 'LaunchAgents', `${name}.plist`))
  return systemdControl(name)
}

async function rebuildPlan(args: string[]): Promise<UpdatePlan> {
  const options = { root: { type: 'string' }, state: { type: 'string' }, service: { type: 'string' }, autostart: { type: 'string' }, wait: { type: 'string' }, commit: { type: 'string' } } as const
  const { values } = parseArgs({ args, options })
  const { state, service, autostart } = values
  if (values.root === undefined || state === undefined || (service === undefined) === (autostart === undefined)) {
    throw new Error('rebuild needs --root, --state and one of --service and --autostart')
  }
  const root = resolve(values.root)
  const home = resolve(process.env.EVEN_KEEL_DATA || root)
  const control = autostart !== undefined ? autostartControl(autostart, [root, process.execPath]) : namedControl(service!)
  const checkout = await readCheckout(root)
  if (checkout === null) throw new Error(`${root} is not a git checkout`)
  if (values.commit !== undefined && checkout.commit !== values.commit) throw new Error('HEAD moved while compiling the update process')
  if (checkout.dirty) throw new Error('Commit or stash tracked changes before rebuilding')
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
  const response = await fetch(state, { signal: AbortSignal.timeout(5_000) })
  if (!response.ok) throw new Error(`Cannot read the running hub at ${state}: HTTP ${response.status}`)
  const result = join(home, RESULT_FILE)
  const running = runningBeforeRebuild(await response.json(), readRecord(result))
  return {
    mode: 'rebuild',
    install: dependenciesChanged(root) ? 'install' : null,
    root,
    home,
    target: { version, tag: checkout.commit },
    from: { version: running.version, commit: running.commit, branch: checkout.branch, tag: null, storage: null },
    service: control,
    state,
    startedAt: running.startedAt,
    legacyRollback: running.legacy,
    settleMs: values.wait === undefined ? SETTLE_MS : Number(values.wait) * 1000,
    answerMs: ANSWER_MS,
    steadyMs: STEADY_MS,
    log: join(home, LOG_FILE),
    result,
    echo: true,
  }
}

if (first === 'rebuild' && !copied) {
  const folder = copyRunner(here)
  const run = spawnSync(process.execPath, [join(folder, 'run.js'), ...process.argv.slice(2)], { stdio: 'inherit' })
  rmSync(folder, { recursive: true, force: true })
  process.exit(run.status ?? 1)
}

const plan = first === 'rebuild' ? await rebuildPlan(rest) : first === undefined ? undefined : readPlan(first)
if (plan === undefined) {
  console.error('usage: node run.js <plan.json> | rebuild --root <dir> --state <url> --service <name>|--autostart <exe> [--commit <sha>] [--wait <s>]')
  process.exit(2)
}
const record = await runPlan(plan)
if (copied && first !== 'rebuild') rmSync(here, { recursive: true, force: true })
process.exit(record.failed === null ? 0 : 1)
