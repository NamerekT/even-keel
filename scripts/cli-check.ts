/**
 * The live check of an agent's CLI version before it becomes the checked one (BTN-253, `docs/releases.md`): one session
 * of a cheap model goes through what the chain and the page do with a session, by the same `Agent` calls — the copy of
 * the version, the sign-in, a launch, a question, the answer from the chat, the chat's feed, a checkpoint, the context
 * window, the stop.
 *
 *   npm run cli-check -- claude <account> [version] [--model <model>] [--no-usage]
 *   npm run cli-check -- codex|opencode|copilot <account> [version] [--model <model>] [--no-usage]
 *
 * The version is the adapter's `checked` by default; its copy goes into `<state>/cli-check/cli/<agent>/<version>/`.
 * The account folder must have no live session: a Claude daemon on the checked version takes the folder over, and the
 * check stops it at the end, so the next chain launch starts one on the pinned version again. `/usage` is asked once
 * (more often than once per 5 minutes it answers 429): `--no-usage` leaves it out; OpenCode and Copilot skip it.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { accountsRoot, AccountHomes, type AccountHome } from '../src/account/homes.js'
import { AGENTS } from '../src/agent/adapters.js'
import type { Agent, SessionHandle } from '../src/agent/contract.js'
import { sessionBase } from '../src/agent/env.js'
import { CLAUDE } from '../src/claude/name.js'
import { CODEX } from '../src/codex/name.js'
import { COPILOT } from '../src/copilot/name.js'
import { runGit } from '../src/git/run.js'
import { stateDirOf } from '../src/locations.js'
import { englishOf, noticeOf } from '../src/notice/notice.js'
import { OPENCODE } from '../src/opencode/name.js'
import { isLive, type AgentEntry } from '../src/sessions/agents.js'
import { replyPrompt, type Ask } from '../src/sessions/ask.js'
import type { FeedLine } from '../src/sessions/transcript.js'

const USAGE = 'usage: npm run cli-check -- claude|codex|opencode|copilot <account> [version] [--model <model>] [--no-usage]'
const NAME = 'cli-check'
const QUESTION = 'Which colour?'
const ANSWER = 'Blue'
const FILE = 'answer.txt'
const CALL_TIMEOUT_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000
const TURN_TIMEOUT_MS = 3 * 60_000
const POLL_MS = 2_000

const FINISH = [
  `2. When the user answers, write the chosen colour into the file ${FILE} in the current folder: the word alone.`,
  `3. End your reply with this line, as it is: CHECKPOINT: ${FILE}`,
]
/** The agents other than Claude Code ask in plain text: a session is a turn per process, with no question tool. */
const IN_TEXT = [
  'This is an automated check of the CLI. Do exactly this and nothing else: no other commands, no other files.',
  `1. Reply with the line "${QUESTION} Red or ${ANSWER}?" and end your turn.`,
  ...FINISH,
].join('\n')
const PROMPTS: Record<string, string> = {
  [CLAUDE]: [
    'This is an automated check of the CLI. Do exactly this and nothing else: no other tools, no other files.',
    `1. Call the AskUserQuestion tool once, with the question "${QUESTION}" and the options "Red" and "${ANSWER}".`,
    ...FINISH,
  ].join('\n'),
  [CODEX]: IN_TEXT,
  [OPENCODE]: IN_TEXT,
  [COPILOT]: IN_TEXT,
}
/**
 * The cheapest model each takes: on a subscription (Codex 0.163.0 on a ChatGPT account refuses the `mini` ones),
 * OpenCode's free one that needs no sign-in; `null` — the CLI's own: Copilot 1.0.98 on a machine sign-in refused
 * every model named by `--model` (`gpt-5-mini`, `claude-haiku-4.5`) and ran only on its `auto`.
 */
const MODELS: Record<string, string | null> = { [CLAUDE]: 'haiku', [CODEX]: 'gpt-5.6-luna', [OPENCODE]: 'opencode/big-pickle', [COPILOT]: null }
/** The agents whose limits come from the CLI itself; OpenCode's and Copilot's are asked of ChatGPT or GitHub, not of the version checked. */
const CLI_USAGE = [CLAUDE, CODEX]

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
  return { agent, account, version, model: model === undefined ? (MODELS[agent] ?? null) : model, usage }
}

let failed = false

async function step<T>(title: string, run: () => Promise<T>, detail: (value: T) => string = () => ''): Promise<T> {
  try {
    const value = await run()
    const said = detail(value)
    console.log(`ok    ${title}${said === '' ? '' : ` — ${said}`}`)
    return value
  } catch (error) {
    failed = true
    console.log(`FAIL  ${title} — ${error instanceof Error ? englishOf(noticeOf(error)) : String(error)}`)
    throw error
  }
}

async function until<T>(what: string, probe: () => Promise<T | undefined>, timeoutMs = TURN_TIMEOUT_MS): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await probe()
    if (value !== undefined) return value
    await delay(POLL_MS)
  }
  throw new Error(`no ${what} within ${Math.round(timeoutMs / 1000)} s`)
}

function feedLine(line: FeedLine): string {
  const text = line.text.replace(/\s+/g, ' ').slice(0, 100)
  return `${line.kind}${line.name === undefined ? '' : ` ${line.name}`}: ${text}`
}

/**
 * A linked worktree of the repository the folder lies in, as a chain task's place is: from Claude Code 2.1.306 a
 * background session writes files only in one, and in a main checkout it is refused until it calls `EnterWorktree`.
 * Outside a repository a plain folder: the CLI guards no writes there. Either way it takes the trust of the checkout it
 * lies in. Returns the repository, or null for a plain folder.
 */
async function freshFolder(dir: string): Promise<string | null> {
  mkdirSync(dirname(dir), { recursive: true })
  const top = await runGit(dirname(dir), ['rev-parse', '--show-toplevel'])
  const repo = top.code === 0 && top.out !== '' ? top.out : null
  if (repo !== null) await dropFolder(repo, dir)
  rmSync(dir, { recursive: true, force: true })
  if (repo === null) {
    mkdirSync(dir, { recursive: true })
    return null
  }
  const added = await runGit(repo, ['worktree', 'add', '--detach', dir])
  if (added.code !== 0) throw new Error(`cli-check: git worktree add ${dir}: ${added.out}`)
  return repo
}

/** The folder is the check's own scratch, so its worktree goes with whatever the session left in it. */
async function dropFolder(repo: string, dir: string): Promise<void> {
  await runGit(repo, ['worktree', 'remove', '--force', dir])
  await runGit(repo, ['worktree', 'prune'])
}

async function run(options: Options): Promise<void> {
  // A check started from a Claude Code session must not take that session's account folder for the global one.
  for (const name of Object.keys(process.env)) if (name.startsWith('CLAUDE')) delete process.env[name]
  const adapter = AGENTS[options.agent]!
  const version = options.version ?? adapter.checked
  const work = join(stateDirOf(), 'cli-check')
  const failures: string[] = []
  const agent: Agent = adapter.setup({
    env: () => sessionBase(process.env),
    timeoutMs: CALL_TIMEOUT_MS,
    workDir: work,
    checkedCli: () => true,
    version,
    log: (line) => {
      console.log(`      ${line}`)
      if (line.includes('could not download')) failures.push(line)
    },
    onCliChange: () => {},
  })
  const home = new AccountHomes(process.env, accountsRoot(process.env)).find(options.account)
  if (home === undefined || home.agent !== options.agent) throw new Error(`cli-check: no ${options.agent} account folder named ${options.account}`)
  console.log(`${adapter.title} ${version} on ${home.key} (${home.dir}), model ${options.model ?? "the CLI's default"}`)

  await step('the copy of the version', () =>
    until(
      'copy',
      async () => {
        if (failures.length > 0) throw new Error(failures[0])
        agent.installed?.()
        // The folder is renamed from its partial name once the download is whole; until then the installed CLI answers.
        if (!existsSync(join(work, 'cli', options.agent, version))) return undefined
        const said = await agent.version!()
        return said.includes(version) ? said.trim() : undefined
      },
      DOWNLOAD_TIMEOUT_MS,
    ),
  (said) => said)
  await step('signed in', async () => {
    const status = await agent.authStatus(home)
    if (!status.loggedIn) throw new Error('the account is not signed in')
    return status
  }, (status) => `${status.authMethod ?? '?'}, ${status.subscriptionType ?? 'no subscription'}`)
  await step('no live session in the folder', async () => {
    const live = (await agent.sessions(home)).filter(isLive)
    if (live.length > 0) throw new Error(`${live.length} live: ${live.map((each) => each.name ?? each.sessionId).join(', ')}; take another account`)
  })

  const cwd = join(work, 'session')
  const repo = await step('the working folder', () => freshFolder(cwd), (repo) => (repo === null ? `${cwd}, no repository` : `${cwd}, a worktree of ${repo}`))
  let handle: SessionHandle | undefined
  try {
    handle = await check(agent, home, options, version, cwd, (next) => (handle = next))
  } finally {
    if (handle !== undefined) await agent.stop(home, handle).catch(() => {})
    if (agent.stopDaemon !== undefined && agent.daemonVersion !== undefined) {
      const live = (await agent.sessions(home).catch(() => [])).filter(isLive)
      if (live.length === 0) await step('the daemon of the check stopped', () => agent.stopDaemon!(home)).catch(() => {})
    }
    if (repo !== null) await dropFolder(repo, cwd)
  }
  if (options.usage && CLI_USAGE.includes(options.agent)) {
    await step('/usage', async () => {
      const answer = await agent.usage!(home, new Date().toISOString())
      if (answer.kind !== 'limits') throw new Error(`${answer.kind}: ${englishOf(answer.reason)}`)
      return answer.limits
    }, (limits) => `5h ${limits.fiveHour?.usedPercentage ?? '-'} %, 7d ${limits.sevenDay?.usedPercentage ?? '-'} %`)
  }
}

async function check(
  agent: Agent,
  home: AccountHome,
  options: Options,
  version: string,
  cwd: string,
  held: (handle: SessionHandle) => void,
): Promise<SessionHandle> {
  const start = { name: NAME, cwd, prompt: PROMPTS[options.agent]!, model: options.model, mcp: [], plugins: [] }
  const entryOf = async (sessionId: string) => (await agent.sessions(home)).find((each) => each.sessionId === sessionId)
  const handleOf = (entry: AgentEntry): SessionHandle => ({ agentId: entry.id ?? entry.sessionId, sessionId: entry.sessionId })

  const launched = await step('launch', () => agent.launch(home, start), (id) => id)
  let entry = await step('the session is live', () => until('live session', async () => {
    const found = await entryOf(launched)
    return found !== undefined && isLive(found) ? found : undefined
  }), (found) => `pid ${found.pid ?? '-'}, status ${found.status ?? '-'}${found.resting === true ? ', resting' : ''}`)
  held(handleOf(entry))
  if (agent.daemonVersion !== undefined) {
    await step('the daemon runs the version', async () => {
      const running = await agent.daemonVersion!(home)
      if (running !== version) throw new Error(`the daemon is on ${running ?? 'nothing'}`)
      return running
    }, (running) => running)
  }

  const tail = agent.tail(home, entry)
  const asked = await step('the question as the page sees it', () => until('question', async () => {
    const found = await entryOf(entry.sessionId)
    if (found === undefined) return undefined
    entry = found
    if (found.ask !== undefined) return found.ask
    tail.follow(found)
    await tail.read()
    const summary = tail.summary()
    if (summary.ask !== null) return summary.ask
    // A session asking in plain text (Codex): its turn ended with the question as the last message.
    const ended = found.status !== 'busy' && (found.resting === true || found.status === 'idle')
    return ended && summary.lastMessage?.includes(ANSWER) === true ? null : undefined
  }), (ask: Ask | null) => (ask === null ? `in text: ${tail.summary().lastMessage ?? ''}` : ask.questions.map((each) => each.question).join(' | ')))

  const reply = { from: 'page' as const, answers: asked === null ? {} : { [asked.questions[0]!.question]: ANSWER }, text: asked === null ? ANSWER : '', files: [] }
  const prompt = replyPrompt(reply, asked, 'en')
  const resumed = await step('the answer from the chat (stop, then resume)', async () => {
    await agent.stop(home, handleOf(entry))
    return agent.resume(home, handleOf(entry), { ...start, prompt })
  }, (id) => (id === entry.sessionId ? id : `${id}, a new id`))
  entry = await until('resumed session', async () => entryOf(resumed))
  held(handleOf(entry))

  const done = await step('the turn after the answer', () => until('finished turn', async () => {
    const found = await entryOf(resumed)
    if (found === undefined) return undefined
    entry = found
    tail.follow(found)
    await tail.read()
    const summary = tail.summary()
    const written = existsSync(join(cwd, FILE)) ? readFileSync(join(cwd, FILE), 'utf8').trim() : ''
    return summary.checkpoint !== null && found.status !== 'busy' && written !== '' ? { checkpoint: summary.checkpoint, written } : undefined
  }), ({ checkpoint, written }) => `${FILE}: "${written}", checkpoint ${checkpoint}`)
  if (done.written !== ANSWER) await step(`${FILE} holds the answer`, () => Promise.reject(new Error(`"${done.written}"`)))

  const feed = await step("the chat's feed", async () => {
    const read = await agent.feed(home, resumed, 0)
    if (read === undefined) throw new Error('no transcript')
    const lines = read.lines
    const question = lines.some((line) => line.ask !== undefined || (line.kind === 'text' && line.text.includes(ANSWER)))
    const answer = lines.some((line) => line.answers !== undefined || ((line.kind === 'answer' || line.kind === 'prompt') && line.text.includes(ANSWER)))
    const last = lines.some((line) => line.kind === 'text' && line.text.includes('CHECKPOINT'))
    const missing = [question ? '' : 'the question', answer ? '' : 'the answer', last ? '' : 'the last reply'].filter(Boolean)
    if (missing.length > 0) throw new Error(`no ${missing.join(', ')} in ${lines.length} lines:\n${lines.map((line) => `        ${feedLine(line)}`).join('\n')}`)
    return lines
  }, (lines) => `${lines.length} lines`)
  for (const line of feed) console.log(`        ${feedLine(line)}`)

  await step('record and transcripts', async () => {
    if ((await agent.record(home, resumed)) === undefined) throw new Error('no record')
    if (!(await agent.transcripts(home)).includes(resumed)) throw new Error('not among the transcripts')
  })
  // The page's context bar and the checkpoint threshold's cap read the window: Claude's from `/context`, Codex's from the rollout.
  await step('the context window', async () => {
    const asked = agent.contextWindow !== undefined
    const window = asked ? await agent.contextWindow!(home, options.model) : ((await agent.record(home, resumed))?.contextWindow ?? null)
    if (window === null) throw new Error(asked ? 'no window in the answer of /context' : 'no window in the transcript')
    return window
  }, (window) => `${window} tokens`)
  await step('stop', async () => {
    await agent.stop(home, handleOf(entry))
    const after = await entryOf(resumed)
    if (after !== undefined && isLive(after)) throw new Error('still live')
  })
  return handleOf(entry)
}

run(parseArgs(process.argv.slice(2))).then(
  () => {
    console.log(failed ? 'cli-check: FAILED' : 'cli-check: passed')
    process.exit(failed ? 1 : 0)
  },
  (error: unknown) => {
    if (!failed) console.error(error instanceof Error ? error.message : String(error))
    console.log('cli-check: FAILED')
    process.exit(1)
  },
)
