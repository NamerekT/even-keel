// The update process. `node run.js <plan.json>` — an update or a revert the service planned and started detached;
// `node dist/src/updates/run.js rebuild --root <dir> --state <url> --service <name>|--autostart <exe> [--wait <s>]` —
// `service/rebuild.ps1` after a green push, in the foreground: it copies itself out of the checkout first and runs the copy.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { readCheckout } from './checkout.js'
import { autostartControl, systemdControl, windowsControl, type ServiceControl } from './control.js'
import { COPY_MARK, copyRunner } from './launch.js'
import { ANSWER_MS, dependenciesChanged, LOG_FILE, readPlan, RESULT_FILE, runPlan, SETTLE_MS, STEADY_MS, type UpdatePlan } from './runner.js'

const here = fileURLToPath(new URL('.', import.meta.url))
const copied = existsSync(join(here, COPY_MARK))
const [first, ...rest] = process.argv.slice(2)

async function rebuildPlan(args: string[]): Promise<UpdatePlan> {
  const options = { root: { type: 'string' }, state: { type: 'string' }, service: { type: 'string' }, autostart: { type: 'string' }, wait: { type: 'string' } } as const
  const { values } = parseArgs({ args, options })
  const { state, service, autostart } = values
  if (values.root === undefined || state === undefined || (service === undefined) === (autostart === undefined)) {
    throw new Error('rebuild needs --root, --state and one of --service and --autostart')
  }
  const root = resolve(values.root)
  const control: ServiceControl =
    autostart !== undefined ? autostartControl(autostart, [root, process.execPath]) : process.platform === 'win32' ? windowsControl(service!) : systemdControl(service!)
  const checkout = await readCheckout(root)
  if (checkout === null) throw new Error(`${root} is not a git checkout`)
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string }
  const startedAt = await fetch(state, { signal: AbortSignal.timeout(5_000) })
    .then(async (response) => ((await response.json()) as { startedAt?: string }).startedAt ?? null)
    .catch(() => null)
  return {
    mode: 'rebuild',
    install: dependenciesChanged(root) ? 'install' : null,
    root,
    home: root,
    target: null,
    from: { version, commit: checkout.commit, branch: checkout.branch, tag: null, storage: null },
    service: control,
    state,
    startedAt,
    settleMs: values.wait === undefined ? SETTLE_MS : Number(values.wait) * 1000,
    answerMs: ANSWER_MS,
    steadyMs: STEADY_MS,
    log: join(root, LOG_FILE),
    result: join(root, RESULT_FILE),
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
  console.error('usage: node run.js <plan.json> | rebuild --root <dir> --state <url> --service <name>|--autostart <exe> [--wait <s>]')
  process.exit(2)
}
const record = await runPlan(plan)
if (copied && first !== 'rebuild') rmSync(here, { recursive: true, force: true })
process.exit(record.failed === null ? 0 : 1)
