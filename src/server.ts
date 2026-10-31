import { readFile } from 'node:fs/promises'
import type { LabelChange } from './tracker/labels.js'
import { restartConfirmation } from './sessions/silence.js'
import { projectOf, commandTarget, flagOf, taskOf, answerOf, baseOf, draftOf, feedDraftOf, projectFormOf, ownOf, sharedFormOf, updatesOf, statsOf, sharesOf, rulesOf, profileRulesOf, linesOf, textOf, numberOf, switchOf, briefOf, mapOf, ciOf, accountOf, appOf, nameOf, secretValuesOf, optionalProjectOf, choiceOf, tallyModeOf, tallyDraftOf, serverOf, codeOf, skillsOf, listOf } from './server-request.js'
export { answerOf } from './server-request.js'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ModelList } from './agent/contract.js'
import { formatEvent, type EventHub } from './events.js'
import type { GuardSettings } from './guard.js'
import { guardedServer } from './server-guard.js'
import { englishOf, fail, noticeOf, type Notice, type NoticeCode } from './notice/notice.js'
import {
  isTaskId,
  parsePeriodQuery,
  parseStatsFilter,
  type AccountSpend,
  type AccountTokens,
  type PeriodQuery,
  type StatsAnswer,
  type StatsFilter,
  type StatsHistory,
  type StatsPeriod,
  type StatsTaskDetail,
} from './stats/model.js'
import {
  parseChangeIds,
  parseCompareQuery,
  parseRulesQuery,
  type CompareQuery,
  type RuleDiffFile,
  type RulesQuery,
  type StatsCompare,
  type StatsRules,
} from './stats/rules.js'
import { statusMovesOf, type StatusMoves } from './chain/moves.js'
import type { ChainRules } from './chain/rules.js'
import { DEFAULT_CHANGELOG } from './changelog/file.js'
import { DEFAULT_CI } from './settings/defaults.js'
import { OWN_KEYS } from './settings/registry.js'
import { CLAUDE } from './claude/name.js'
import type { Language } from './language.js'
import type { ApprovalDecision } from './sessions/approvals.js'
import { HOOK_EVENTS, type MailEvent } from './sessions/mail.js'
import type { HookMail } from './sessions/mailRelay.js'
import type { CacheTtl, ChangelogOp, ChangelogView, CheckpointShares, CheckResult, CiSettings, ContextScale, FeedDraft, OwnValues, ProjectCheck, ProjectDraft, ProjectForm, ProjectTrust, SharedForm, Standard, StatsConfig } from './state.js'
import type { CompareSettings } from './stats/rules.js'
import { CI_KINDS, type CiKind } from './ci/model.js'
import type { Calibration } from './stats/calibration.js'
import { DEFAULT_SHARES, type CheckpointThreshold, type SessionCheckpoint } from './stats/checkpoint.js'
import type { TallyServerDraft } from './stats/connect.js'
import { isTallyMode, type TallyMode } from './stats/mode.js'
import type { StatsSteps } from './stats/steps.js'
import type { TaskCard } from './tracker/card.js'
import type { TaskStatus } from './tracker/model.js'
import type { TaskFile, TrackerProject, TrackerVocabulary } from './tracker/source.js'
import { PROFILE_RULE_KEYS, type ProfileRules } from './profiles/model.js'
import { RULE_KEYS } from './config.js'
import { oauthCallback, PROFILE_QUERIES, type ProfilesControl } from './profiles/routes.js'
export type { ProfilesControl } from './profiles/routes.js'

/** Files the browser may show in place; anything else is a download, so a tracker file never runs as the page. */
const SHOWN_IN_PLACE = /^(image\/(png|jpeg|gif|webp|avif|bmp)|video\/[\w.+-]+|audio\/[\w.+-]+|application\/pdf)$/

export interface StatsSource {
  history(filter: StatsFilter): Promise<StatsAnswer<StatsHistory>>
  period(query: PeriodQuery): Promise<StatsAnswer<StatsPeriod>>
  steps(query: PeriodQuery): Promise<StatsAnswer<StatsSteps>>
  task(task: string): Promise<StatsAnswer<StatsTaskDetail>>
  calibration(project: string, task: string | null): Promise<StatsAnswer<Calibration>>
  checkpoints(): Promise<StatsAnswer<CheckpointThreshold[]>>
  spend(tz: string): Promise<StatsAnswer<Record<string, AccountSpend>>>
  tokens(tz: string): Promise<StatsAnswer<Record<string, AccountTokens>>>
  rules(query: RulesQuery): Promise<StatsAnswer<StatsRules>>
  ruleDiff(ids: string[]): Promise<StatsAnswer<RuleDiffFile[]>>
  compare(query: CompareQuery): Promise<StatsAnswer<StatsCompare>>
}

export interface ChainControl {
  start(project: string): Promise<void>
  resume(project: string): void
  stop(project: string): void
  /** "Stop after this task": on — the chain stops once its current task is done and cleaned up instead of taking the next. */
  stopAfter(project: string, on: boolean): void
  dequeue(project: string): void
  reorder(project: string, order: string[]): void
  requeue(order: string[]): void
  skip(project: string, task: string): void
  unskip(project: string, task: string): void
  restart(project: string, task: string, confirmed?: import('./sessions/silence.js').SilentRestart): void
  dismiss(project: string, task: string): void
  setUnattended(on: boolean): void
  setTrimTools(on: boolean): void
}

export interface AccountControl {
  discoverGlobal(agent: string): Promise<void>
  useGlobal(agent: string): Promise<void>
  /** `method` — the agent's way to sign in, for an agent with several (`Agent.login`). */
  add(agent: string, method?: string): void
  /** An account of the agent paying from a key: Anthropic's for Claude, OpenAI's for Codex, either for OpenCode. */
  addApiKey(name: string, key: string, agent: string): Promise<void>
  /** A new key in the folder of an API account, its name, roles and pools kept (BTN-418). */
  replaceApiKey(account: string, key: string): Promise<void>
  renew(account: string): void
  switchTo(account: string): void
  switchApp(app: string, account: string): Promise<void>
  remove(account: string): Promise<void>
  keep(account: string): void
  /** The name the page shows for the account; blank — its default. */
  rename(account: string, name: string): void
  code(code: string): void
  cancel(): void
}

export interface TaskControl {
  /** `undefined` — no connected tracker gives a card for the task. */
  card(task: string): Promise<TaskCard | undefined>
  /** `undefined` — no connected tracker gives the file, or the task has no such file. */
  file(task: string, file: string): Promise<TaskFile | undefined>
  /** "Into the chain": puts the missing required label on and moves the task out of the backlog status. */
  ready(task: string): Promise<void>
  /** "To the backlog": the mirror of `ready`, refused for a task with a live session. */
  unready(task: string): Promise<void>
  relabel(task: string, change: LabelChange): Promise<void>
  /** `milestone` is an id from the card's `milestones`; `null` — out of any. */
  moveMilestone(task: string, milestone: string | null): Promise<void>
  /** Reads the project's tasks from its tracker now, out of turn. */
  refresh(project: string): Promise<void>
}

export interface AnswerRequest {
  project: string
  task: string
  sessionId: string
  /** The id of the `AskUserQuestion` answered; `null` — a reply to a turn that ended in plain text. */
  ask: string | null
  answers: Record<string, string>
  text: string
  files: { name: string; data: Uint8Array }[]
}

export interface SessionControl {
  answer(request: AnswerRequest): Promise<void>
  /** The chat's "Dismiss": the session's returned messages leave the chat window. */
  dismissMail(sessionId: string): void
}

export interface SettingsControl {
  /** Writes into the config file the project's settings that differ from `base`, the values the form started from. */
  save(project: string, form: ProjectForm, base: ProjectForm): void | Promise<void>
  /** Writes into the config file the shared settings that differ from `base`. */
  saveShared(form: SharedForm, base: SharedForm): void
  /** What the wizard's draft comes to: the repository, the config with it, the tracker's answer, Claude Code's trust. */
  check(draft: ProjectDraft): Promise<ProjectCheck>
  /** Claude Code's trust in the project's checkout as the Claude account folder `account` (blank — the project's own) sees it. */
  trust(project: string, account: string | null): ProjectTrust
  /** Adds the wizard's project to the config; refuses one the config would not parse. */
  add(draft: ProjectDraft): void
  /** Drops the project from the config; refuses while its chain, sessions or places still hold it. */
  remove(project: string): void
  /** Adds an extra task feed to the project (BTN-66); refuses one the config would not parse. */
  addFeed(project: string, draft: FeedDraft): void
  /** Drops the project's feed; the archive keeps the closed tasks it gave. */
  removeFeed(project: string, feed: string): void
  /** `null` — the feed reads on its tracker's default profile; refused once the chain has started its tasks. */
  linkFeed(project: string, feed: string, profile: string | null): void
  /** The feed's own chain rule keys (BTN-553), all of them at once; refuses ones that clash with its profile's. */
  feedRules(project: string, feed: string, rules: Partial<ChainRules>): void
  /** A tracker profile's status moves (BTN-554), all at once; refuses a status its rules would not take. */
  profileMoves(id: string, moves: StatusMoves): Promise<void>
  /** A task source's own status moves: the project's main tracker with `feed` null, else the feed; checked the same way. */
  sourceMoves(project: string, feed: string | null, moves: StatusMoves): Promise<void>
  /** The toast's "Close": no toast for this version, a later one shows it again. */
  dismissUpdate(version: string): void
  /** The toast's "Don't show again": no toasts about new versions until the switch on /settings. */
  muteUpdates(): void
  /** The update window's "Update" to the latest release (BTN-163): waits for the chains, then the update process takes over. */
  installUpdate(): Promise<void>
  /** Its "Revert" to the version the last update came from. */
  revertUpdate(): Promise<void>
  /** "Close" on how the last update or revert ended. */
  closeUpdateResult(): void
}

/** The page's commands on packages (`src/packages/service.ts`); a project is named by its key. */
export interface PackagesControl {
  install(name: string): Promise<void>
  update(name: string): Promise<void>
  remove(name: string): void
  addMarketplace(): Promise<void>
  addPlugin(plugin: string, marketplace: string, project?: string): void
  addServer(name: string, entry: Record<string, unknown>, project?: string): void
  wrapSkills(names: string[], project?: string): Promise<void>
  importRepo(project: string): void
  choose(project: string, name: string, choice: 'on' | 'off' | null): void
  setDefault(name: string, on: boolean): void
  setSetting(name: string, key: string, value: string | null, project?: string): void
  setKey(name: string, value: string): void
}

/** The `.env` credentials the page writes (`src/secrets/`): the page token alone, the stats classifier's together. */
export interface SecretsControl {
  set(name: string, value: string): void
  remove(name: string): void
  /** `null` removes the variable. */
  update(values: Record<string, string | null>): void
}

/** Where Tally writes (BTN-247): the page's stats setup and the stats settings. */
export interface TallyControl {
  /** `server` checks the connection first; `null` fields — the ones `.env` has. */
  set(mode: TallyMode, server: TallyServerDraft | null): Promise<void>
}

export interface ServerDeps {
  cli?: { download(agent: string): void; system(agent: string): void; checked(agent: string): void; check(): Promise<void> }
  hub: EventHub
  publicDir: string
  getState: () => unknown
  control: ChainControl
  account: AccountControl
  sessions: SessionControl
  settings: SettingsControl
  packages: PackagesControl
  secrets: SecretsControl
  tally: TallyControl
  profiles: ProfilesControl
  launches: () => unknown
  sessionRecord: (sessionId: string) => Promise<unknown>
  /** Lines of the whole transcript from index `after` on, and its last turn. */
  transcript: (sessionId: string, after: number) => Promise<unknown>
  /** Picture `index` of the result of call `tool` in the session's transcript; `undefined` — none. */
  transcriptImage: (sessionId: string, tool: string, index: number) => Promise<TaskFile | undefined>
  /** A file the user sent the session, by its name; `undefined` — the transcript names no such file or it is gone. */
  inboxFile: (sessionId: string, name: string) => Promise<TaskFile | undefined>
  /** File `index` the session sent the user by call `tool` (`SendUserFile`); `undefined` — no such file, outside its folders, or gone. */
  sharedFile: (sessionId: string, tool: string, index: number) => Promise<TaskFile | undefined>
  /** For the checkpoint hook; `undefined` for a session the chain did not start. */
  checkpoint: (sessionId: string) => Promise<SessionCheckpoint | undefined>
  /** For the checkpoint mark hook: the turn wrote the handoff note near its end (`noteAtEnd`); `undefined` as above. */
  handoffNote: (sessionId: string) => Promise<boolean | undefined>
  /**
   * For the merge hook: the project's check commands to run before the merge, empty — none, its main branch and its
   * standards (BTN-359), which the standards hook reads too; `undefined` for a session the chain did not start.
   */
  mergeCheck: (sessionId: string) => { commands: string[]; branch: string; standards: Standard[] } | undefined
  /**
   * For the mailbox hook: reserves the chat's messages until the response finishes, as one text;
   * `null` — none wait, or the task is over (BTN-558); `undefined` for a session the chain did not start (BTN-181).
   */
  mail: (sessionId: string, event: MailEvent) => Promise<HookMail | null> | undefined
  /**
   * For the permission hook started at `since` (ms): the user's decision on the tool call the session waits to have
   * approved; `null` — not yet; `undefined` for a session the chain did not start, or a call whose dialog is gone (BTN-269).
   */
  permission: (sessionId: string, tool: string, input: Record<string, unknown>, since: number) => ApprovalDecision | null | undefined
  /** `undefined` for a project the config does not know. */
  tools: (project: string) => Promise<unknown>
  /** By the project's id; `undefined` when the config does not know it or its tracker is off or names nothing. */
  vocabulary: (projectId: string) => Promise<TrackerVocabulary | undefined>
  /** The statuses of a tracker profile (BTN-554); `undefined` — no such profile, its kind moves none, or the tracker named none. */
  profileStatuses: (id: string) => Promise<TaskStatus[] | undefined>
  /** The models of the account folder `key` for the model fields (`Agent.models`); `null` — none known. */
  models: (key: string) => Promise<ModelList | null>
  tasks: TaskControl
  /** An operation on the milestone's changelog draft; its newest version (`src/changelog/drafts.ts`). */
  changelog: (project: string, milestone: string, op: ChangelogOp) => Promise<ChangelogView>
  /** "Carry now": the release project's branch into the branch of the project it merges into (BTN-172). */
  carry: (project: string) => Promise<void>
  /** "Resolve with the agent": a session resolves the release project's held conflict (BTN-369). */
  resolveCarry: (project: string) => Promise<void>
  stats: StatsSource
  /** Read per request: `allowedHosts` is live. */
  guard: () => GuardSettings
}

type Command = (deps: ServerDeps, body: Record<string, unknown>) => void | Promise<void>

const COMMANDS: Record<string, Command> = {
  'chain/start': ({ control }, body) => control.start(projectOf(body)),
  'chain/resume': ({ control }, body) => control.resume(projectOf(body)),
  'chain/stop': ({ control }, body) => control.stop(projectOf(body)),
  'chain/stopAfter': ({ control }, body) => control.stopAfter(projectOf(body), flagOf(body)),
  'chain/dequeue': ({ control }, body) => control.dequeue(projectOf(body)),
  'chain/order': ({ control }, body) => control.reorder(projectOf(body), listOf(body, 'request.taskList')),
  'chain/queue': ({ control }, body) => control.requeue(listOf(body, 'request.projectList')),
  'chain/skip': ({ control }, body) => control.skip(projectOf(body), taskOf(body)),
  'chain/unskip': ({ control }, body) => control.unskip(projectOf(body), taskOf(body)),
  'chain/restart': ({ control }, body) => control.restart(projectOf(body), taskOf(body), restartConfirmation(body.confirmed)),
  'chain/dismiss': ({ control }, body) => control.dismiss(projectOf(body), taskOf(body)),
  'chain/unattended': ({ control }, body) => control.setUnattended(flagOf(body)),
  'chain/trim': ({ control }, body) => control.setTrimTools(flagOf(body)),
  'chain/refresh': ({ tasks }, body) => tasks.refresh(projectOf(body)),
  'task/ready': ({ tasks }, body) => tasks.ready(taskOf(body)),
  'task/unready': ({ tasks }, body) => tasks.unready(taskOf(body)),
  'task/labels': ({ tasks }, body) => tasks.relabel(taskOf(body), { add: labelList(body.add, 'add'), remove: labelList(body.remove, 'remove') }),
  'task/milestone': ({ tasks }, body) => tasks.moveMilestone(taskOf(body), body.milestone === null ? null : textOf(body.milestone, 'milestone')),
  'session/answer': ({ sessions }, body) => sessions.answer(answerOf(body)),
  'session/mail/dismiss': ({ sessions }, body) => sessions.dismissMail(textOf(body.sessionId, 'sessionId')),
  'project/settings': ({ settings }, body) => settings.save(projectOf(body), projectFormOf(body), projectFormOf(baseOf(body))),
  'project/add': ({ settings }, body) => settings.add(draftOf(body)),
  'project/remove': ({ settings }, body) => settings.remove(projectOf(body)),
  'project/feed/add': ({ settings }, body) => settings.addFeed(projectOf(body), feedDraftOf(body)),
  'project/feed/remove': ({ settings }, body) => settings.removeFeed(projectOf(body), textOf(body.feed, 'feed')),
  'project/feed/profile': ({ settings }, body) =>
    settings.linkFeed(projectOf(body), textOf(body.feed, 'feed'), body.profile === null ? null : textOf(body.profile, 'profile')),
  'project/feed/rules': ({ settings }, body) => settings.feedRules(projectOf(body), textOf(body.feed, 'feed'), profileRulesOf(body.rules, RULE_KEYS)),
  'project/moves': ({ settings }, body) =>
    settings.sourceMoves(projectOf(body), body.feed === null || body.feed === undefined ? null : textOf(body.feed, 'feed'), statusMovesOf(body.moves, 'moves')),
  settings: ({ settings }, body) => settings.saveShared(sharedFormOf(body), sharedFormOf(baseOf(body))),
  'updates/dismiss': ({ settings }, body) => settings.dismissUpdate(textOf(body.version, 'version')),
  'updates/mute': ({ settings }) => settings.muteUpdates(),
  'updates/install': ({ settings }) => settings.installUpdate(),
  'updates/revert': ({ settings }) => settings.revertUpdate(),
  'updates/seen': ({ settings }) => settings.closeUpdateResult(),
  'account/add': ({ account }, body) =>
    account.add(body.agent === undefined ? CLAUDE : textOf(body.agent, 'agent'), body.method === undefined ? undefined : textOf(body.method, 'method')),
  'account/discover': ({ account }, body) => account.discoverGlobal(textOf(body.agent, 'agent')),
  'cli/download': ({ cli }, body) => cli?.download(textOf(body.agent, 'agent')),
  'cli/system': ({ cli }, body) => cli?.system(textOf(body.agent, 'agent')),
  'cli/checked': ({ cli }, body) => cli?.checked(textOf(body.agent, 'agent')),
  'cli/check': ({ cli }) => cli?.check(),
  'account/global': ({ account }, body) => account.useGlobal(textOf(body.agent, 'agent')),
  'account/api': ({ account }, body) =>
    account.addApiKey(
      typeof body.name === 'string' ? body.name : '',
      textOf(body.key, 'key'),
      body.agent === undefined ? CLAUDE : textOf(body.agent, 'agent'),
    ),
  'account/key': ({ account }, body) => account.replaceApiKey(accountOf(body), textOf(body.key, 'key')),
  'account/renew': ({ account }, body) => account.renew(accountOf(body)),
  'account/switch': ({ account }, body) => account.switchTo(accountOf(body)),
  'account/app': ({ account }, body) => account.switchApp(appOf(body), accountOf(body)),
  'account/remove': ({ account }, body) => account.remove(accountOf(body)),
  'account/keep': ({ account }, body) => account.keep(accountOf(body)),
  'account/name': ({ account }, body) => account.rename(accountOf(body), typeof body.name === 'string' ? body.name : ''),
  'account/code': ({ account }, body) => account.code(codeOf(body)),
  'account/cancel': ({ account }) => account.cancel(),
  'packages/install': ({ packages }, body) => packages.install(nameOf(body)),
  'packages/update': ({ packages }, body) => packages.update(nameOf(body)),
  'packages/remove': ({ packages }, body) => packages.remove(nameOf(body)),
  'packages/marketplace': ({ packages }) => packages.addMarketplace(),
  'packages/plugin': ({ packages }, body) => packages.addPlugin(textOf(body.plugin, 'plugin'), textOf(body.marketplace, 'marketplace'), optionalProjectOf(body)),
  'packages/server': ({ packages }, body) => packages.addServer(nameOf(body), serverOf(body.server), optionalProjectOf(body)),
  'packages/skills': ({ packages }, body) => packages.wrapSkills(skillsOf(body), optionalProjectOf(body)),
  'packages/import': ({ packages }, body) => packages.importRepo(projectOf(body)),
  'packages/project': ({ packages }, body) => packages.choose(projectOf(body), nameOf(body), choiceOf(body.choice)),
  'packages/default': ({ packages }, body) => packages.setDefault(nameOf(body), flagOf(body)),
  'packages/setting': ({ packages }, body) =>
    packages.setSetting(nameOf(body), textOf(body.key, 'key'), body.value === null ? null : textOf(body.value, 'value'), optionalProjectOf(body)),
  'packages/key': ({ packages }, body) => packages.setKey(nameOf(body), textOf(body.value, 'value')),
  'secrets/set': ({ secrets }, body) => secrets.set(nameOf(body), textOf(body.value, 'value')),
  'secrets/remove': ({ secrets }, body) => secrets.remove(nameOf(body)),
  'secrets/update': ({ secrets }, body) => secrets.update(secretValuesOf(body.values)),
  'stats/tally': ({ tally }, body) => tally.set(tallyModeOf(body.mode), tallyDraftOf(body.server)),
  'profiles/remove': ({ profiles }, body) => profiles.remove(textOf(body.id, 'id')),
  'profiles/default': ({ profiles }, body) => profiles.setDefault(textOf(body.id, 'id')),
  'profiles/rules': ({ profiles }, body) => profiles.setRules(textOf(body.id, 'id'), profileRulesOf(body.rules)),
  'profiles/moves': ({ settings }, body) => settings.profileMoves(textOf(body.id, 'id'), statusMovesOf(body.moves, 'moves')),
  'profiles/link': ({ profiles }, body) => profiles.link(projectOf(body), body.profile === null ? null : textOf(body.profile, 'profile')),
}

/** POST calls that answer with their own result rather than the state. */
const QUERIES: Record<string, (deps: ServerDeps, body: Record<string, unknown>, request: IncomingMessage) => Promise<unknown>> = {
  ...PROFILE_QUERIES,
  'changelog/open': ({ changelog }, body) => changelog(projectOf(body), textOf(body.milestone, 'milestone'), { op: 'open' }),
  'changelog/again': ({ changelog }, body) => changelog(projectOf(body), textOf(body.milestone, 'milestone'), { op: 'again' }),
  'changelog/add': ({ changelog }, body) => changelog(projectOf(body), textOf(body.milestone, 'milestone'), { op: 'add' }),
  'changelog/edit': ({ changelog }, body) =>
    changelog(projectOf(body), textOf(body.milestone, 'milestone'), { op: 'edit', instruction: textOf(body.instruction, 'instruction') }),
  'changelog/write': ({ changelog }, body) => changelog(projectOf(body), textOf(body.milestone, 'milestone'), { op: 'write' }),
  'models/list': ({ models }, body) => models(textOf(body.account, 'account')),
  'project/trust': async ({ settings }, body) => settings.trust(projectOf(body), typeof body.account === 'string' && body.account !== '' ? body.account : null),
  'forward/carry': ({ carry }, body) => carry(projectOf(body)),
  'forward/resolve': ({ resolveCarry }, body) => resolveCarry(projectOf(body)),
}

const MAX_BODY_BYTES = 64 * 1024
/** An answer carries its files in base64. */
const MAX_ANSWER_BYTES = 64 * 1024 * 1024
const BODY_LIMITS: Record<string, number> = { '/api/session/answer': MAX_ANSWER_BYTES }

function labelList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((label) => typeof label !== 'string' || label.trim() === '')) throw fail('request.required', { field })
  return value as string[]
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
}

export function createEvenKeelServer(deps: ServerDeps): Server {
  return guardedServer(deps.guard, (request, response) => route(deps, request, response))
}

/**
 * The page alone, for a service that started nothing — its storage is from a newer Even Keel or cannot be migrated:
 * `/api/events` sends the reason as the event `blocked`, the other API calls get 503.
 */
export function createBlockedServer(deps: { guard: () => GuardSettings; publicDir: string; reason: Notice }): Server {
  return guardedServer(deps.guard, async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    if (request.method === 'GET' && path === '/api/events') {
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' })
      response.write(formatEvent('blocked', deps.reason))
      return
    }
    if (path.startsWith('/api/')) sendJson(response, 503, { error: englishOf(deps.reason), notice: deps.reason })
    else if (request.method === 'GET') await serveStatic(deps.publicDir, path, response)
    else response.writeHead(405).end()
  })
}

async function route(deps: ServerDeps, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const path = url.pathname

  if (request.method === 'GET' && path === '/api/profiles/oauth/callback') return oauthCallback(deps.profiles, url.searchParams, response)

  if (request.method === 'GET' && path === '/api/state') {
    sendJson(response, 200, deps.getState())
    return
  }

  if (request.method === 'GET' && path === '/api/launches') {
    sendJson(response, 200, deps.launches())
    return
  }

  const checkpoint = /^\/api\/sessions\/([^/]+)\/checkpoint$/.exec(path)
  if (request.method === 'GET' && checkpoint !== null) {
    const found = await deps.checkpoint(decodeURIComponent(checkpoint[1]!))
    if (found === undefined) response.writeHead(404).end()
    else sendJson(response, 200, found)
    return
  }

  const handoffNote = /^\/api\/sessions\/([^/]+)\/note$/.exec(path)
  if (request.method === 'GET' && handoffNote !== null) {
    const note = await deps.handoffNote(decodeURIComponent(handoffNote[1]!))
    if (note === undefined) response.writeHead(404).end()
    else sendJson(response, 200, { note })
    return
  }

  const mergeCheck = /^\/api\/sessions\/([^/]+)\/check$/.exec(path)
  if (request.method === 'GET' && mergeCheck !== null) {
    const check = deps.mergeCheck(decodeURIComponent(mergeCheck[1]!))
    if (check === undefined) response.writeHead(404).end()
    else sendJson(response, 200, check)
    return
  }

  const standards = /^\/api\/sessions\/([^/]+)\/standards$/.exec(path)
  if (request.method === 'GET' && standards !== null) {
    const check = deps.mergeCheck(decodeURIComponent(standards[1]!))
    if (check === undefined) response.writeHead(404).end()
    else sendJson(response, 200, { standards: check.standards })
    return
  }

  const sessionFile = /^\/api\/sessions\/([^/]+)\/(?:(images|shared)\/([^/]+)\/(\d+)|files\/([^/]+))$/.exec(path)
  if (request.method === 'GET' && sessionFile !== null) {
    const [, id, kind, tool, index, name] = sessionFile.map((part) => (part === undefined ? undefined : decodeURIComponent(part)))
    let found: TaskFile | undefined
    try {
      found = await (tool === undefined
        ? deps.inboxFile(id!, name!)
        : kind === 'shared'
          ? deps.sharedFile(id!, tool, Number(index))
          : deps.transcriptImage(id!, tool, Number(index)))
    } catch (error) {
      sendFailure(response, error)
      return
    }
    if (found === undefined) response.writeHead(404).end()
    else await sendFile(response, found)
    return
  }

  const session = /^\/api\/sessions\/([^/]+)(\/transcript)?$/.exec(path)
  if (request.method === 'GET' && session !== null) {
    const id = decodeURIComponent(session[1]!)
    const after = Math.max(0, Number.parseInt(url.searchParams.get('after') ?? '', 10) || 0)
    let record: unknown
    try {
      record = await (session[2] === undefined ? deps.sessionRecord(id) : deps.transcript(id, after))
    } catch (error) {
      sendFailure(response, error)
      return
    }
    if (record === undefined) response.writeHead(404).end()
    else sendJson(response, 200, record)
    return
  }

  const tools = /^\/api\/projects\/([^/]+)\/tools$/.exec(path)
  if (request.method === 'GET' && tools !== null) {
    let view: unknown
    try {
      view = await deps.tools(decodeURIComponent(tools[1]!))
    } catch (error) {
      sendFailure(response, error)
      return
    }
    if (view === undefined) response.writeHead(404).end()
    else sendJson(response, 200, view)
    return
  }

  const vocabulary = /^\/api\/projects\/([^/]+)\/vocabulary$/.exec(path)
  if (request.method === 'GET' && vocabulary !== null) {
    let found: TrackerVocabulary | undefined
    try {
      found = await deps.vocabulary(decodeURIComponent(vocabulary[1]!))
    } catch (error) {
      sendFailure(response, error)
      return
    }
    if (found === undefined) response.writeHead(404).end()
    else sendJson(response, 200, found)
    return
  }

  const calibration = /^\/api\/projects\/([A-Z][A-Z0-9]*)\/calibration$/.exec(path)
  if (request.method === 'GET' && calibration !== null) {
    const task = url.searchParams.get('task')
    if (task !== null && !isTaskId(task)) {
      sendFailure(response, fail('request.taskId', {}))
      return
    }
    sendJson(response, 200, await deps.stats.calibration(calibration[1]!, task))
    return
  }

  const card = /^\/api\/tasks\/([^/]+)$/.exec(path)
  if (request.method === 'GET' && card !== null) {
    let view: TaskCard | undefined
    try {
      const task = decodeURIComponent(card[1]!)
      if (!isTaskId(task)) throw fail('request.taskId', {})
      view = await deps.tasks.card(task)
    } catch (error) {
      sendFailure(response, error)
      return
    }
    if (view === undefined) response.writeHead(404).end()
    else sendJson(response, 200, view)
    return
  }

  const file = /^\/api\/tasks\/([^/]+)\/files\/([^/]+)$/.exec(path)
  if (request.method === 'GET' && file !== null) {
    let found: TaskFile | undefined
    try {
      const task = decodeURIComponent(file[1]!)
      if (!isTaskId(task)) throw fail('request.taskId', {})
      found = await deps.tasks.file(task, decodeURIComponent(file[2]!))
    } catch (error) {
      sendFailure(response, error)
      return
    }
    if (found === undefined) response.writeHead(404).end()
    else await sendFile(response, found)
    return
  }

  const stats = /^\/api\/stats\/(history|period|steps|checkpoints|spend|tokens|rules|rules\/diff|rules\/compare|task\/([^/]+))$/.exec(path)
  if (request.method === 'GET' && stats !== null) {
    let read: () => Promise<StatsAnswer<unknown>>
    try {
      if (stats[1] === 'history') {
        const filter = parseStatsFilter(url.searchParams)
        read = () => deps.stats.history(filter)
      } else if (stats[1] === 'period') {
        const query = parsePeriodQuery(url.searchParams)
        read = () => deps.stats.period(query)
      } else if (stats[1] === 'steps') {
        const query = parsePeriodQuery(url.searchParams)
        read = () => deps.stats.steps(query)
      } else if (stats[1] === 'checkpoints') {
        read = () => deps.stats.checkpoints()
      } else if (stats[1] === 'spend') {
        const { tz } = parseStatsFilter(url.searchParams)
        read = () => deps.stats.spend(tz)
      } else if (stats[1] === 'tokens') {
        const { tz } = parseStatsFilter(url.searchParams)
        read = () => deps.stats.tokens(tz)
      } else if (stats[1] === 'rules') {
        const query = parseRulesQuery(url.searchParams)
        read = () => deps.stats.rules(query)
      } else if (stats[1] === 'rules/diff') {
        const ids = parseChangeIds(url.searchParams)
        read = () => deps.stats.ruleDiff(ids)
      } else if (stats[1] === 'rules/compare') {
        const query = parseCompareQuery(url.searchParams)
        read = () => deps.stats.compare(query)
      } else {
        const task = decodeURIComponent(stats[2]!)
        if (!isTaskId(task)) throw fail('request.taskId', {})
        read = () => deps.stats.task(task)
      }
    } catch (error) {
      sendFailure(response, error)
      return
    }
    sendJson(response, 200, await read())
    return
  }

  const mail = /^\/api\/sessions\/([^/]+)\/mail$/.exec(path)
  if (request.method === 'POST' && mail !== null) {
    let delivery: HookMail | null | undefined
    try {
      const body = await readJsonBody(request, MAX_BODY_BYTES)
      if (!HOOK_EVENTS.includes(body.event as MailEvent)) throw fail('request.required', { field: 'event' })
      delivery = await deps.mail(decodeURIComponent(mail[1]!), body.event as MailEvent)
    } catch (error) {
      sendFailure(response, error)
      return
    }
    if (delivery === undefined) response.writeHead(404).end()
    else {
      const finish = (delivered: boolean) => {
        response.off('finish', sent)
        response.off('close', closed)
        response.off('error', closed)
        delivery?.finish(delivered)
      }
      const sent = () => finish(true)
      const closed = () => finish(false)
      response.once('finish', sent)
      response.once('close', closed)
      response.once('error', closed)
      if (response.destroyed) closed()
      else {
        try {
          sendJson(response, 200, { message: delivery?.message ?? null })
        } catch (error) {
          closed()
          throw error
        }
      }
    }
    return
  }

  const permission = /^\/api\/sessions\/([^/]+)\/permission$/.exec(path)
  if (request.method === 'POST' && permission !== null) {
    let decision: ApprovalDecision | null | undefined
    try {
      const body = await readJsonBody(request, MAX_BODY_BYTES)
      const { input, since } = body
      if (typeof input !== 'object' || input === null || Array.isArray(input)) throw fail('request.required', { field: 'input' })
      if (typeof since !== 'number') throw fail('request.required', { field: 'since' })
      decision = deps.permission(decodeURIComponent(permission[1]!), textOf(body.tool, 'tool'), input as Record<string, unknown>, since)
    } catch (error) {
      sendFailure(response, error)
      return
    }
    if (decision === undefined) response.writeHead(404).end()
    else sendJson(response, 200, { decision })
    return
  }

  if (request.method === 'POST' && path === '/api/project/check') {
    let check: ProjectCheck
    try {
      check = await deps.settings.check(draftOf(await readJsonBody(request, MAX_BODY_BYTES)))
    } catch (error) {
      sendFailure(response, error)
      return
    }
    sendJson(response, 200, check)
    return
  }

  const query = request.method === 'POST' ? QUERIES[path.slice('/api/'.length)] : undefined
  if (query !== undefined) {
    let result: unknown
    try {
      result = await query(deps, await readJsonBody(request, MAX_BODY_BYTES), request)
    } catch (error) {
      sendFailure(response, error)
      return
    }
    sendJson(response, 200, result)
    return
  }

  if (request.method === 'POST' && path.startsWith('/api/')) {
    const command = COMMANDS[path.slice('/api/'.length)]
    if (command === undefined) {
      response.writeHead(404).end()
      return
    }
    try {
      const body = await readJsonBody(request, BODY_LIMITS[path] ?? MAX_BODY_BYTES)
      await command(deps, body)
      if (path.startsWith('/api/chain/') || path === '/api/session/answer') {
        console.log(`page: ${path.slice('/api/'.length)} ${commandTarget(body)}`.trimEnd())
      }
    } catch (error) {
      sendFailure(response, error)
      return
    }
    sendJson(response, 200, deps.getState())
    return
  }

  if (request.method === 'GET' && path === '/api/events') {
    streamEvents(deps, request, response)
    return
  }

  if (request.method === 'GET') {
    await serveStatic(deps.publicDir, path, response)
    return
  }

  response.writeHead(405).end()
}

// `error` stays for scripts; the page translates `notice`.
function sendFailure(response: ServerResponse, error: unknown): void {
  const notice = noticeOf(error)
  sendJson(response, 400, { error: englishOf(notice), notice })
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

async function sendFile(response: ServerResponse, file: TaskFile): Promise<void> {
  const shown = SHOWN_IN_PLACE.test(file.type)
  response.writeHead(200, {
    'content-type': file.type || 'application/octet-stream',
    ...(file.size === null ? {} : { 'content-length': String(file.size) }),
    'content-disposition': shown ? 'inline' : 'attachment',
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, max-age=3600',
    ...(shown ? {} : { 'content-security-policy': 'sandbox' }),
  })
  try {
    await pipeline(Readable.from(file.body), response)
  } catch {
    response.destroy()
  }
}

async function readJsonBody(request: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > limit) throw fail('request.tooLarge', {})
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (text === '') return {}
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    throw fail('request.notJson', {})
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw fail('request.notObject', {})
  return body as Record<string, unknown>
}


function streamEvents(deps: ServerDeps, request: IncomingMessage, response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
  })
  response.write(formatEvent('state', deps.getState()))
  const unsubscribe = deps.hub.subscribe(
    (frame) => response.write(frame),
    () => response.end(),
  )
  request.on('close', unsubscribe)
}

async function serveStatic(publicDir: string, path: string, response: ServerResponse): Promise<void> {
  const root = normalize(publicDir + sep)
  const isClientRoute = !path.startsWith('/api/') && extname(path) === ''
  const file = normalize(join(root, isClientRoute ? 'index.html' : decodeURIComponent(path)))
  if (!file.startsWith(root)) {
    response.writeHead(404).end()
    return
  }
  let body: Buffer
  try {
    body = await readFile(file)
  } catch {
    if (isClientRoute) {
      response.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('The web client is not built: run npm run build')
      return
    }
    response.writeHead(404).end()
    return
  }
  response.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  response.end(body)
}
