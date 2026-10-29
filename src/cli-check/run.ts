/**
 * The live check of an agent's CLI version (BTN-253, `docs/releases.md`): one session of a cheap model goes through what
 * the chain and the page do with a session, by the same `Agent` calls — the copy of the version, the sign-in, a launch,
 * a question, the answer from the chat, the chat's feed, a checkpoint, the context window, the package hooks, the limits
 * shape, the stop. `scripts/cli-check.ts` runs it from a terminal, the service by itself (`CliChecks`, BTN-569).
 *
 * The account folder must have no live session: a Claude daemon on the checked version takes the folder over, and the
 * check stops it at the end, so the next chain launch starts one on the pinned version again.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { AccountHome } from '../account/homes.js'
import { AGENTS } from '../agent/adapters.js'
import type { Agent, SessionHandle, SessionStart, SessionTail } from '../agent/contract.js'
import { CLAUDE } from '../claude/name.js'
import { CODEX } from '../codex/name.js'
import { appServer } from '../codex/appserver.js'
import { resolveCodexBinary } from '../codex/cli.js'
import { CodexPlugins, pluginId } from '../codex/plugins.js'
import { codexBinaryIn, codexTarget } from '../codex/release.js'
import { rolloutFile } from '../codex/rollout.js'
import { COPILOT } from '../copilot/name.js'
import { runGit } from '../git/run.js'
import type { UsageAnswer } from '../limits/usage.js'
import { englishOf, noticeOf } from '../notice/notice.js'
import { OPENCODE } from '../opencode/name.js'
import { isLive, type AgentEntry } from '../sessions/agents.js'
import { replyPrompt, type Ask } from '../sessions/ask.js'
import type { FeedLine } from '../sessions/transcript.js'
import { checkCodexHookList, checkHookRequests, checkpointPackages, checkRolloutUsage, checkUsage, hookService, type HookRequest } from './support.js'

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
export const CHECK_MODELS: Record<string, string | null> = { [CLAUDE]: 'haiku', [CODEX]: 'gpt-5.6-luna', [OPENCODE]: 'opencode/big-pickle', [COPILOT]: null }
/** The agents whose limits come from the CLI itself; OpenCode's and Copilot's are asked of ChatGPT or GitHub, not of the version checked. */
const CLI_USAGE = [CLAUDE, CODEX]

export type Phase = 'question' | 'answer'

export interface CliCheckOptions<S> {
  agent: string
  home: AccountHome
  version: string
  model: string | null
  /** Ask Claude's `/usage` once; Codex's limits are always read from this check's rollout. */
  usage: boolean
  /** `<state>/cli-check`: the copies of the versions, the package catalog and the working folder. */
  work: string
  env: () => NodeJS.ProcessEnv
  /** A line of each step and of the agent's own log. */
  say: (line: string) => void
  /** Keeps the transcript at the question and after the answer (the terminal check saves them as samples). */
  capture?: (home: AccountHome, sessionId: string, tail: SessionTail, phase: Phase) => Promise<S>
}

export interface CliCheckReport<S> {
  version: string
  snapshots: S[]
  contextWindow: number
  usage?: { answer?: UsageAnswer; expected: string }
}

/** A failed check: the message names the first step that failed and why. */
export class CliCheckFailure extends Error {}

class Steps {
  failure: string | undefined

  constructor(private readonly say: (line: string) => void) {}

  async step<T>(title: string, run: () => Promise<T>, detail: (value: T) => string = () => ''): Promise<T> {
    try {
      const value = await run()
      const said = detail(value)
      this.say(`ok    ${title}${said === '' ? '' : ` — ${said}`}`)
      return value
    } catch (error) {
      const why = error instanceof Error ? englishOf(noticeOf(error)) : String(error)
      this.failure ??= `${title}: ${why}`
      this.say(`FAIL  ${title} — ${why}`)
      throw error
    }
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

function readSettings(dir: string, name = 'settings.json'): Record<string, unknown> | undefined {
  const file = join(dir, '.claude', name)
  const accountFile = join(dir, name)
  const found = existsSync(file) ? file : accountFile
  return existsSync(found) ? JSON.parse(readFileSync(found, 'utf8')) : undefined
}

/** Resolves with what the check saw; rejects with a `CliCheckFailure` naming the first failed step. */
export async function runCliCheck<S>(options: CliCheckOptions<S>): Promise<CliCheckReport<S>> {
  const steps = new Steps(options.say)
  try {
    const report = await checkVersion(options, steps)
    if (steps.failure !== undefined) throw new CliCheckFailure(steps.failure)
    return report
  } catch (error) {
    if (error instanceof CliCheckFailure) throw error
    throw new CliCheckFailure(steps.failure ?? (error instanceof Error ? error.message : String(error)))
  }
}

async function checkVersion<S>(options: CliCheckOptions<S>, steps: Steps): Promise<CliCheckReport<S>> {
  const { home, version, work, say } = options
  const step = steps.step.bind(steps)
  const adapter = AGENTS[options.agent]!
  let hookUrl: string | undefined
  const failures: string[] = []
  const agent: Agent = adapter.setup({
    env: () => ({ ...options.env(), ...(hookUrl === undefined ? {} : { EVEN_KEEL_URL: hookUrl }) }),
    timeoutMs: CALL_TIMEOUT_MS,
    workDir: work,
    checkedCli: () => true,
    version,
    log: (line) => {
      say(`      ${line}`)
      if (line.includes('could not download')) failures.push(line)
    },
    onCliChange: () => {},
  })
  if (home.agent !== options.agent) throw new Error(`cli-check: ${home.key} is a folder of ${home.agent}, not ${options.agent}`)
  say(`${adapter.title} ${version} on ${home.key} (${home.dir}), model ${options.model ?? "the CLI's default"}`)
  await agent.cli?.download()

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
  let report: CliCheckReport<S> | undefined
  let hooks: Awaited<ReturnType<typeof hookService>> | undefined
  try {
    const packages = await step('the checkpoint package', () => checkpointPackages(work, options.agent, (line) => say(`      ${line}`)))
    hooks = await step('the hook service', () => hookService(), (service) => service.url)
    hookUrl = hooks.url
    const set = packages.startOf(NAME, NAME, options.agent)
    if (options.agent === CODEX) {
      await step('all Codex package hooks trusted with the turn flags', async () => {
        const target = codexTarget(process.platform, process.arch)
        if (target === null) throw new Error('no Codex build for this platform')
        const bin = resolveCodexBinary(process.env, codexBinaryIn(join(work, 'cli', CODEX, version), target))
        const flags = await new CodexPlugins(() => bin, (home) => agent.env(home)).args(home, cwd, set.plugins ?? [])
        const [answer] = await appServer(bin, flags, cwd, agent.env(home), [['hooks/list', {}]])
        return (set.plugins ?? []).map((plugin) => checkCodexHookList(answer, pluginId(plugin))).join('; ')
      }, (answer) => answer)
    }
    const settings = JSON.stringify({ env: { EVEN_KEEL_URL: hooks.url }, enabledPlugins: packages.otherPlugins(NAME, NAME, [readSettings(home.dir), readSettings(cwd), readSettings(cwd, 'settings.local.json')]) })
    report = await check(agent, options, steps, { name: NAME, cwd, prompt: PROMPTS[options.agent]!, model: options.model, ...set, settings }, hooks.requests, (next) => (handle = next))
  } finally {
    if (handle !== undefined) await agent.stop(home, handle).catch(() => {})
    if (agent.stopDaemon !== undefined && agent.daemonVersion !== undefined) {
      const live = (await agent.sessions(home).catch(() => [])).filter(isLive)
      if (live.length === 0) await step('the daemon of the check stopped', () => agent.stopDaemon!(home)).catch(() => {})
    }
    await hooks?.close()
    if (repo !== null) await dropFolder(repo, cwd)
  }
  if (options.usage && options.agent !== CODEX && CLI_USAGE.includes(options.agent)) {
    await step('/usage shape', async () => {
      const answer = await agent.usage!(home, new Date().toISOString())
      const expected = checkUsage(answer)
      report!.usage = { answer, expected }
      return expected
    }, (answer) => answer)
  } else if (options.agent !== CODEX) say(`skip  /usage shape — ${options.usage ? 'limits come from the provider API, not this CLI' : '--no-usage'}`)
  return report!
}

async function check<S>(
  agent: Agent,
  options: CliCheckOptions<S>,
  steps: Steps,
  start: SessionStart,
  hookRequests: HookRequest[],
  held: (handle: SessionHandle) => void,
): Promise<CliCheckReport<S>> {
  const { home, version, say } = options
  const step = steps.step.bind(steps)
  const { cwd } = start
  const entryOf = async (sessionId: string) => (await agent.sessions(home)).find((each) => each.sessionId === sessionId)
  const handleOf = (entry: AgentEntry): SessionHandle => ({ agentId: entry.id ?? entry.sessionId, sessionId: entry.sessionId })
  const snapshots: S[] = []
  const capture = async (sessionId: string, phase: Phase) => {
    if (options.capture !== undefined) snapshots.push(await step(`capture the ${phase} transcript`, () => options.capture!(home, sessionId, tail, phase)))
  }

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
  await capture(entry.sessionId, 'question')

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
  for (const line of feed) say(`        ${feedLine(line)}`)

  await step('record and transcripts', async () => {
    if ((await agent.record(home, resumed)) === undefined) throw new Error('no record')
    if (!(await agent.transcripts(home)).includes(resumed)) throw new Error('not among the transcripts')
  })
  await step('the checkpoint package hook ran', () => until('a hook request from the checked session', async () => {
    try {
      return checkHookRequests(hookRequests, [launched, resumed])
    } catch {
      return undefined
    }
  }, 10_000).catch(() => checkHookRequests(hookRequests, [launched, resumed])), (answer) => answer)
  let usage: CliCheckReport<S>['usage']
  if (options.agent === CODEX) {
    const expected = await step('rate_limits shape in this session rollout', async () => {
      const file = await rolloutFile(home.dir, resumed)
      if (file === undefined) throw new Error(`no rollout for ${resumed}`)
      return checkRolloutUsage(readFileSync(file, 'utf8'))
    }, (answer) => answer)
    usage = { expected }
  }
  // The page's context bar and the checkpoint threshold's cap read the window: Claude's from `/context`, Codex's from the rollout.
  const contextWindow = await step('the context window', async () => {
    const asked = agent.contextWindow !== undefined
    const window = asked ? await agent.contextWindow!(home, options.model ?? '') : ((await agent.record(home, resumed))?.contextWindow ?? null)
    if (window === null) throw new Error(asked ? 'no window in the answer of /context' : 'no window in the transcript')
    return window
  }, (window) => `${window} tokens`)
  await step('stop', async () => {
    await agent.stop(home, handleOf(entry))
    const after = await entryOf(resumed)
    if (after !== undefined && isLive(after)) throw new Error('still live')
  })
  await capture(resumed, 'answer')
  return { version, snapshots, contextWindow, ...(usage === undefined ? {} : { usage }) }
}
