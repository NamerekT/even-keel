/**
 * The live check of an agent's CLI version before it becomes the checked one (BTN-253, `docs/releases.md`); the steps
 * are `runCliCheck` (`src/cli-check/run.ts`), which the service also runs by itself (BTN-569).
 *
 *   npm run cli-check -- claude <account> [version] [--model <model>] [--no-usage]
 *   npm run cli-check -- codex|opencode|copilot <account> [version] [--model <model>] [--no-usage]
 *
 * The version is the adapter's `checked` by default; its copy goes into `<state>/cli-check/cli/<agent>/<version>/`.
 * The account folder must have no live session. `/usage` is asked once (more often than once per 5 minutes it answers
 * 429): `--no-usage` leaves it out; OpenCode and Copilot skip it. Codex's limits shape is always checked in this
 * session's rollout, without a usage API request. The transcripts are saved as anonymized samples in `test/fixtures/cli`.
 */
import { join } from 'node:path'
import { hostname, homedir, userInfo } from 'node:os'
import { accountsRoot, AccountHomes } from '../src/account/homes.js'
import { AGENTS } from '../src/agent/adapters.js'
import { sessionBase } from '../src/agent/env.js'
import { CHECK_MODELS, runCliCheck } from '../src/cli-check/run.js'
import { root, stateDirOf } from '../src/locations.js'
import { captureSnapshot } from './cli-sample-capture.js'
import { anonymizeSample, saveSample } from './cli-samples.js'

const USAGE = 'usage: npm run cli-check -- claude|codex|opencode|copilot <account> [version] [--model <model>] [--no-usage]'

interface Options {
  agent: string
  account: string
  version: string | undefined
  model: string | null
  usage: boolean
}

function parseArgs(args: string[]): Options {
  const positional: string[] = []
  let model: string | null | undefined
  let usage = true
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--no-usage') usage = false
    else if (args[index] === '--model') model = args[++index] ?? null
    else positional.push(args[index]!)
  }
  const [agent, account, version] = positional
  if (agent === undefined || account === undefined || AGENTS[agent] === undefined) throw new Error(USAGE)
  return { agent, account, version, model: model === undefined ? (CHECK_MODELS[agent] ?? null) : model, usage }
}

async function run(options: Options): Promise<void> {
  // A check started from a Claude Code session must not take that session's account folder for the global one.
  for (const name of Object.keys(process.env)) if (name.startsWith('CLAUDE')) delete process.env[name]
  const home = new AccountHomes(process.env, accountsRoot(process.env)).all().find((home) => home.key === options.account)
  if (home === undefined || home.agent !== options.agent) throw new Error(`cli-check: no ${options.agent} account folder named ${options.account}`)
  const work = join(stateDirOf(), 'cli-check')
  const cwd = join(work, 'session')
  const report = await runCliCheck({
    ...options,
    home,
    version: options.version ?? AGENTS[options.agent]!.checked,
    work,
    env: () => sessionBase(process.env),
    say: (line) => console.log(line),
    capture: captureSnapshot,
  })
  const privateValues = [homedir(), userInfo().username, hostname(), home.dir, cwd,
    ...Object.entries(process.env).filter(([key]) => /token|secret|password|api_?key/i.test(key)).map(([, value]) => value ?? '')]
  const file = saveSample(join(root, 'test/fixtures/cli'), anonymizeSample({ provider: options.agent, ...report }, privateValues))
  console.log(`ok    anonymized transcript sample — ${file}`)
}

run(parseArgs(process.argv.slice(2))).then(
  () => {
    console.log('cli-check: passed')
    process.exit(0)
  },
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    console.log('cli-check: FAILED')
    process.exit(1)
  },
)
