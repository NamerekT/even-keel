import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { cloudConnectionOf } from './account/cloud.js'
import type { BadgeSettings } from './badge/model.js'
import { BUILTIN_BODY_LIMITS, BUILTIN_QUERIES, BUILTIN_UPLOAD, builtinUpload } from './builtin/routes.js'
import { CHATS_BODY_LIMITS, CHATS_QUERIES } from './chats/routes.js'
import { checkReportOf } from './chain/checkreports.js'
import { statusMovesOf } from './chain/moves.js'
import { filesOf } from './review/outsider.js'
import { CLAUDE } from './claude/name.js'
import { DEFAULT_BRANCH, RULE_KEYS } from './config.js'
import { DICTATION_BODY_BYTES } from './dictation/transcribe.js'
import { formatEvent } from './events.js'
import type { GuardSettings, Visitor } from './guard.js'
import { accessRoute } from './access/routes.js'
import { isLanguage } from './language.js'
import { englishOf, fail, type Notice } from './notice/notice.js'
import { oauthCallback, PROFILE_QUERIES } from './profiles/routes.js'
import { guardedServer } from './server-guard.js'
import { cleanMachineSettings } from './service/machine-settings.js'
import { accountOf, answerOf, appOf, baseOf, browserOf, choiceOf, cloneOf, codeOf, commandTarget, draftOf, editChoiceOf, feedDraftOf, flagOf, hotkeysOf, joinRequestsOf, labelList, memoryFoldersOf, listOf, mapOf, nameOf, noticeKindOf, numberOf, optionalProjectOf, profileRulesOf, projectFormOf, projectOf, secretValuesOf, serverOf, sharedFormOf, switchOf, tallyDraftOf, tallyModeOf, taskOf, textOf } from './server-request.js'
import { eventWriter, readJsonBody, sendFailure, sendFile, sendJson, serveStatic } from './server-response.js'
import type { ApprovalDecision } from './sessions/approvals.js'
import { HOOK_EVENTS, type MailEvent } from './sessions/mail.js'
import type { HookMail } from './sessions/mailRelay.js'
import { restartConfirmation } from './sessions/silence.js'
import type { ProjectCheck } from './state.js'
import { isTaskId, parsePeriodQuery, parseStatsFilter, type StatsAnswer } from './stats/model.js'
import { parseChangeIds, parseCompareQuery, parseRulesQuery } from './stats/rules.js'
import { taskRunOf } from './sessions/runs.js'
import type { TaskCard } from './tracker/card.js'
import type { TaskFile, TrackerVocabulary } from './tracker/source.js'
export type { ProfilesControl } from './profiles/routes.js'
export type { AccountControl, AnswerRequest, ChainControl, PackagesControl, SecretsControl, ServerDeps, SessionControl, SettingsControl, StatsSource, TallyControl, TaskControl } from './server-control.js'
export { answerOf } from './server-request.js'

import type { ServerDeps } from './server-control.js'

type Command = (deps: ServerDeps, body: Record<string, unknown>) => void | Promise<void>

function takeOf(raw: unknown): 'kept' | 'other' {
  if (raw !== 'kept' && raw !== 'other') throw fail('request.required', { field: 'take' })
  return raw
}

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
  'chain/reassign': ({ control }, body) => control.reassign(projectOf(body), taskOf(body)),
  'chain/accept': ({ control }, body) => control.accept(projectOf(body), taskOf(body), textOf(body.sessionId, 'sessionId')),
  'chain/closeUnpushed': ({ control }, body) => control.closeUnpushed(projectOf(body), taskOf(body)),
  'chain/unattended': ({ control }, body) => control.setUnattended(flagOf(body)),
  'chain/trim': ({ control }, body) => control.setTrimTools(flagOf(body)),
  'chain/refresh': ({ tasks }, body) => tasks.refresh(projectOf(body)),
  'task/ready': ({ tasks }, body) => tasks.ready(taskOf(body)),
  'task/unready': ({ tasks }, body) => tasks.unready(taskOf(body)),
  'task/labels': ({ tasks }, body) => tasks.relabel(taskOf(body), { add: labelList(body.add, 'add'), remove: labelList(body.remove, 'remove') }),
  'task/run': ({ tasks }, body) => tasks.setRun(taskOf(body), taskRunOf(body)),
  'task/milestone':({ tasks }, body) => tasks.moveMilestone(taskOf(body), body.milestone === null ? null : textOf(body.milestone, 'milestone')),
  'session/answer': ({ sessions }, body) => sessions.answer(answerOf(body)),
  'session/mail/dismiss': ({ sessions }, body) => sessions.dismissMail(textOf(body.sessionId, 'sessionId')),
  'project/settings': ({ settings }, body) => settings.save(projectOf(body), projectFormOf(body), projectFormOf(baseOf(body))),
  'project/add': ({ settings }, body) => settings.add(draftOf(body)),
  'project/branch/adopt': ({ settings }, body) => settings.adoptBranch(projectOf(body), typeof body.machine === 'string' ? body.machine : undefined),
  'project/branch/restore': ({ settings }, body) => settings.restoreBranch(projectOf(body), typeof body.machine === 'string' ? body.machine : undefined),
  'project/remove': ({ settings }, body) => settings.remove(projectOf(body)),
  // Git is only turned on (BTN-1063): a tab open since before that, or a hand call, may still ask to turn it off.
  'project/git': ({ settings }, body) => {
    if (!switchOf(body.on, 'on')) throw fail('project.gitStaysOn', {})
    return settings.turnGitOn(projectOf(body), {
      slot: body.slot === undefined ? 0 : numberOf(body.slot, 'slot'),
      commit: body.commit === true,
      ...(body.branch === undefined ? {} : { branch: textOf(body.branch, 'branch') }),
    })
  },
  'project/feed/add': ({ settings }, body) => settings.addFeed(projectOf(body), feedDraftOf(body)),
  'project/feed/remove': ({ settings }, body) => settings.removeFeed(projectOf(body), textOf(body.feed, 'feed')),
  'project/feed/profile': ({ settings }, body) =>
    settings.linkFeed(projectOf(body), textOf(body.feed, 'feed'), body.profile === null ? null : textOf(body.profile, 'profile')),
  'project/feed/rules': ({ settings }, body) => settings.feedRules(projectOf(body), textOf(body.feed, 'feed'), profileRulesOf(body.rules, RULE_KEYS)),
  'project/moves': ({ settings }, body) =>
    settings.sourceMoves(projectOf(body), body.feed === null || body.feed === undefined ? null : textOf(body.feed, 'feed'), statusMovesOf(body.moves, 'moves')),
  'project/milestone-order': ({ settings }, body) => settings.milestoneOrder(projectOf(body), listOf(body, 'request.milestoneList')),
  'project/badge': ({ settings }, body) => settings.badge(projectOf(body), body.badge === null ? null : (body.badge as BadgeSettings)),
  settings:({ settings }, body) => settings.saveShared(sharedFormOf(body), sharedFormOf(baseOf(body))),
  'updates/dismiss': ({ settings }, body) => settings.dismissUpdate(textOf(body.version, 'version')),
  'updates/mute': ({ settings }) => settings.muteUpdates(),
  'view/tests': ({ settings }, body) => {
    if (body.page !== 'home' && body.page !== 'stats') throw fail('request.required', { field: 'page' })
    settings.showTests(body.page, switchOf(body.on, 'on'))
  },
  'notices/dismiss': ({ settings }, body) => settings.dismissNotices(mapOf<string>(body.entries, 'entries', (stamp) => typeof stamp === 'string')),
  'hotkeys/save': ({ settings }, body) => settings.saveHotkeys(browserOf(body), hotkeysOf(body)),
  'notices/mute': ({ settings }, body) =>
    settings.muteNotice(optionalProjectOf(body) ?? null, noticeKindOf(body.kind), body.shown === null ? null : switchOf(body.shown, 'shown')),
  'updates/install': ({ settings }) => settings.installUpdate(),
  'updates/revert': ({ settings }) => settings.revertUpdate(),
  'updates/seen': ({ settings }) => settings.closeUpdateResult(),
  'updates/warm': ({ settings }, body) => settings.warmAhead(numberOf(body.ms, 'ms')),
  'account/add': ({ account }, body) =>
    account.add(body.agent === undefined ? CLAUDE : textOf(body.agent, 'agent'), body.method === undefined ? undefined : textOf(body.method, 'method')),
  'account/discover': ({ account }, body) => account.discoverGlobal(textOf(body.agent, 'agent')),
  'cli/download': ({ cli }, body) => cli?.download(textOf(body.agent, 'agent'), body.source === 'latest' ? 'latest' : 'checked'),
  'cli/system': ({ cli }, body) => cli?.system(textOf(body.agent, 'agent')),
  'cli/checked': ({ cli }, body) => cli?.checked(textOf(body.agent, 'agent')),
  'cli/check': ({ cli }) => cli?.check(),
  'huly/install': ({ hulyClient }) => hulyClient?.install(),
  'storage/backup': ({ backup }) => backup?.copyNow(),
  'config/settleConflict': ({ configConflicts }, body) =>
    configConflicts?.settleConfig(textOf(body.file, 'file'), textOf(body.hash, 'hash'), takeOf(body.take)),
  'machines/revoke': ({ machines }, body) => machines?.revoke(textOf(body.machine, 'machine')),
  'machines/decline': ({ machineRequests }, body) => machineRequests?.decline(textOf(body.request, 'request')),
  'machines/join': ({ pool }, body) => pool?.join(textOf(body.machine, 'machine'), joinRequestsOf(body)),
  'machines/connect': ({ pool }, body) =>
    pool?.connect(projectOf(body), {
      machine: textOf(body.machine, 'machine'),
      clone: cloneOf(body.clone),
      ...(typeof body.folder === 'string' && body.folder.trim() !== '' && { folder: body.folder.trim() }),
      ...(typeof body.copyFrom === 'string' && body.copyFrom !== '' && { copyFrom: body.copyFrom }),
    }),
  'machines/enable': ({ pool }, body) => pool?.enable(projectOf(body), textOf(body.machine, 'machine'), switchOf(body.enabled, 'enabled')),
  'machines/settings': ({ pool }, body) => pool?.settings(projectOf(body), textOf(body.machine, 'machine'), cleanMachineSettings(body.settings)),
  'machines/capacity': ({ machinePage }, body) => machinePage?.capacity(textOf(body.machine, 'machine'), body.capacity as number),
  'machines/color': ({ machinePage }, body) => machinePage?.color(textOf(body.machine, 'machine'), body.color === null ? null : textOf(body.color, 'color')),
  'machines/update': ({ machinePage }, body) => machinePage?.update(textOf(body.machine, 'machine')),
  'machines/memory': ({ machinePage }, body) => machinePage?.memoryFolders(textOf(body.machine, 'machine'), memoryFoldersOf(body.folders)),
  'machines/gitIdentity': ({ machinePage }, body) => machinePage?.gitIdentity(textOf(body.machine, 'machine'), textOf(body.name, 'name'), textOf(body.email, 'email')),
  'machines/takeOver': ({ machines }, body) => machines?.takeOver(typeof body.machine === 'string' ? body.machine : undefined, textOf(body.project, 'project'), textOf(body.owner, 'owner')),
  'machines/login': ({ machines }, body) => machines?.login(
    textOf(body.machine, 'machine'),
    body.agent === undefined ? CLAUDE : textOf(body.agent, 'agent'),
    body.account === undefined ? undefined : textOf(body.account, 'account'),
    body.method === undefined ? undefined : textOf(body.method, 'method'),
  ),
  'machines/useGlobal': ({ machines }, body) => machines?.useGlobal(textOf(body.machine, 'machine'), textOf(body.agent, 'agent')),
  'machines/code': ({ machines }, body) => machines?.code(textOf(body.machine, 'machine'), codeOf(body)),
  'machines/token': ({ machines }, body) =>
    machines?.token(textOf(body.machine, 'machine'), textOf(body.account, 'account'), textOf(body.token, 'token'), typeof body.name === 'string' ? body.name : ''),
  'machines/sharedToken': ({ machines }, body) => machines?.sharedToken(textOf(body.machine, 'machine'), textOf(body.from, 'from')),
  'machines/cancel': ({ machines }, body) => machines?.cancel(textOf(body.machine, 'machine')),
  'machines/installCli': ({ machines }, body) => machines?.installCli(textOf(body.machine, 'machine'), textOf(body.agent, 'agent')),
  'machines/checkClis': ({ machines }, body) => machines?.checkClis(textOf(body.machine, 'machine')),
  'machines/account/remove': ({ machineAccounts }, body) => machineAccounts?.remove(textOf(body.machine, 'machine'), accountOf(body)),
  'machines/account/keep': ({ machineAccounts }, body) => machineAccounts?.keep(textOf(body.machine, 'machine'), accountOf(body)),
  'machines/account/app': ({ machineAccounts }, body) => machineAccounts?.app(textOf(body.machine, 'machine'), appOf(body), accountOf(body)),
  'machines/account/name': ({ machineAccounts }, body) =>
    machineAccounts?.rename(textOf(body.machine, 'machine'), accountOf(body), typeof body.name === 'string' ? body.name : ''),
  'machines/account/switch': ({ machineAccounts }, body) => machineAccounts?.switchTo(textOf(body.machine, 'machine'), accountOf(body)),
  'machines/key': ({ machineAccounts }, body) => machineAccounts?.key(textOf(body.machine, 'machine'), {
    agent: body.agent === undefined ? CLAUDE : textOf(body.agent, 'agent'),
    key: textOf(body.key, 'key'),
    name: typeof body.name === 'string' ? body.name : '',
    ...(typeof body.folder === 'string' && body.folder !== '' && { folder: body.folder }),
  }),
  // The page sends its language: on the first run none is chosen yet, and the demo speaks the one the person reads.
  'demo/start': async ({ demo }, body) => void (await demo?.start(isLanguage(body.language) ? body.language : undefined)),
  'demo/again': async ({ demo }, body) => void (await demo?.again(isLanguage(body.language) ? body.language : undefined)),
  'demo/remove': async ({ demo }) => demo?.remove(),
  'git/check': ({ git }) => git?.check(),
  'git/identity': ({ git }, body) => git?.identity(textOf(body.name, 'name'), textOf(body.email, 'email')),
  'git/init': ({ git }, body) => git?.init(textOf(body.repo, 'repo').trim(), textOf(body.branch, 'branch').trim() || DEFAULT_BRANCH),
  'job/retry': ({ jobs }, body) => jobs?.retry(textOf(body.id, 'id')),
  'job/cancel': ({ jobs }, body) => jobs?.cancel(textOf(body.id, 'id')),
  'job/close': ({ jobs }, body) => jobs?.close(textOf(body.id, 'id')),
  'account/global': ({ account }, body) => account.useGlobal(textOf(body.agent, 'agent')),
  'account/api': ({ account }, body) =>
    account.addApiKey(
      typeof body.name === 'string' ? body.name : '',
      textOf(body.key, 'key'),
      body.agent === undefined ? CLAUDE : textOf(body.agent, 'agent'),
      ...(body.provider === undefined ? [] : [textOf(body.provider, 'provider')]),
    ),
  'account/cloud': ({ account }, body) => account.addCloud(typeof body.name === 'string' ? body.name : '', cloudConnectionOf(body)),
  'account/token': ({ account }, body) =>
    account.addLongToken(
      typeof body.name === 'string' ? body.name : '',
      textOf(body.token, 'token'),
      ...(typeof body.sameAs === 'string' && body.sameAs !== '' ? [body.sameAs] : []),
    ),
  'account/aws': ({ account }) => account.readAws(),
  'account/gcloud': ({ account }) => account.readGcloud(),
  'account/azure': ({ account }) => account.readAzure(),
  'account/key': ({ account }, body) => account.replaceApiKey(accountOf(body), textOf(body.key, 'key')),
  'account/management-key': ({ account }, body) => account.setManagementKey(accountOf(body), body.key === null ? null : textOf(body.key, 'key')),
  'account/renew': ({ account }, body) => account.renew(accountOf(body)),
  'account/switch': ({ account }, body) => account.switchTo(accountOf(body)),
  'account/app': ({ account }, body) => account.switchApp(appOf(body), accountOf(body)),
  'account/remove': ({ account }, body) => account.remove(accountOf(body)),
  'account/keep': ({ account }, body) => account.keep(accountOf(body)),
  'account/name': ({ account }, body) => account.rename(accountOf(body), typeof body.name === 'string' ? body.name : ''),
  'account/settings-edit': ({ account }, body) => account.resolveSettingsEdit(accountOf(body), body.keys === undefined ? textOf(body.key, 'key') : labelList(body.keys, 'keys'), editChoiceOf(body.choice)),
  'account/own-setting': ({ account }, body) => account.dropOwnSetting(accountOf(body), textOf(body.key, 'key')),
  'account/remote': ({ account }, body) => account.enableRemote(accountOf(body)),
  'account/code': ({ account }, body) => account.code(codeOf(body)),
  'account/cancel': ({ account }) => account.cancel(),
  'account/installCli': ({ account }, body) => account.installCli(textOf(body.agent, 'agent')),
  'packages/install': ({ packages }, body) => packages.install(nameOf(body)),
  'packages/update': ({ packages }, body) => packages.update(nameOf(body)),
  'packages/check': ({ packages }) => packages.checkAll(),
  'packages/remove': ({ packages }, body) => packages.remove(nameOf(body)),
  'packages/marketplace': ({ packages }) => packages.addMarketplace(),
  'packages/plugin': ({ packages }, body) => packages.addPlugin(textOf(body.plugin, 'plugin'), textOf(body.marketplace, 'marketplace'), optionalProjectOf(body)),
  'packages/server': ({ packages }, body) => packages.addServer(nameOf(body), serverOf(body.server), optionalProjectOf(body)),
  'packages/import': ({ packages }, body) => packages.importRepo(projectOf(body)),
  'packages/project': ({ packages }, body) => packages.choose(projectOf(body), nameOf(body), choiceOf(body.choice)),
  'packages/default': ({ packages }, body) => packages.setDefault(nameOf(body), flagOf(body)),
  'packages/scripts': ({ packages }, body) => packages.setScripts(nameOf(body), flagOf(body)),
  'packages/setting': ({ packages }, body) =>
    packages.setSetting(nameOf(body), textOf(body.key, 'key'), body.value === null ? null : textOf(body.value, 'value'), optionalProjectOf(body)),
  'packages/key': ({ packages }, body) => packages.setKey(nameOf(body), textOf(body.value, 'value')),
  'secrets/set': ({ secrets }, body) => secrets.set(nameOf(body), textOf(body.value, 'value')),
  'secrets/remove': ({ secrets }, body) => secrets.remove(nameOf(body)),
  'secrets/update': ({ secrets }, body) => secrets.update(secretValuesOf(body.values)),
  'stats/tally': ({ tally }, body) => tally.set(tallyModeOf(body.mode), tallyDraftOf(body.server)),
  'profiles/remove': ({ profiles }, body) => profiles.remove(textOf(body.id, 'id')),
  'profiles/default': ({ profiles }, body) => profiles.setDefault(textOf(body.id, 'id')),
  'profiles/disable': ({ profiles }, body) => profiles.setDisabled(textOf(body.id, 'id'), body.disabled === true),
  'profiles/handSessions': ({ profiles }, body) => profiles.setHandSessions(textOf(body.id, 'id'), body.on === true),
  'profiles/rules': ({ profiles }, body) => profiles.setRules(textOf(body.id, 'id'), profileRulesOf(body.rules)),
  'profiles/moves': ({ settings }, body) => settings.profileMoves(textOf(body.id, 'id'), statusMovesOf(body.moves, 'moves')),
  'profiles/link': ({ profiles }, body) => profiles.link(projectOf(body), body.profile === null ? null : textOf(body.profile, 'profile')),
}

/** POST calls that answer with their own result rather than the state. */
const QUERIES: Record<string, (deps: ServerDeps, body: Record<string, unknown>, request: IncomingMessage) => Promise<unknown>> = {
  ...PROFILE_QUERIES,
  ...BUILTIN_QUERIES,
  ...CHATS_QUERIES,
  'changelog/open': ({ changelog }, body) => changelog(projectOf(body), textOf(body.milestone, 'milestone'), { op: 'open' }),
  'changelog/draft': ({ changelog }, body) => changelog(projectOf(body), textOf(body.milestone, 'milestone'), { op: 'draft' }),
  'changelog/again': ({ changelog }, body) => changelog(projectOf(body), textOf(body.milestone, 'milestone'), { op: 'again' }),
  'changelog/add': ({ changelog }, body) => changelog(projectOf(body), textOf(body.milestone, 'milestone'), { op: 'add' }),
  'changelog/edit': ({ changelog }, body) =>
    changelog(projectOf(body), textOf(body.milestone, 'milestone'), { op: 'edit', instruction: textOf(body.instruction, 'instruction') }),
  'changelog/write': ({ changelog }, body) => changelog(projectOf(body), textOf(body.milestone, 'milestone'), { op: 'write' }),
  'models/list': ({ models }, body) => models(textOf(body.account, 'account')),
  'project/branches': ({ settings }, body) => settings.branches(projectOf(body)),
  'project/git/changes': ({ settings }, body) => settings.gitChanges(projectOf(body)),
  'project/badge/check': ({ settings }, body) => settings.checkBadge(projectOf(body), textOf(body.url, 'url'), textOf(body.slug, 'slug')),
  'project/trust': async ({ settings }, body) => settings.trust(projectOf(body), typeof body.account === 'string' && body.account !== '' ? body.account : null),
  'machines/addresses': async ({ machines }) => machines?.addresses() ?? [],
  'machines/list': async ({ machines }) => (await machines?.list()) ?? [],
  'machines/admit': async ({ machineRequests }, body) => {
    if (machineRequests === undefined) throw fail('machines.requestGone', {})
    return { machine: await machineRequests.admit(textOf(body.request, 'request')) }
  },
  'machines/pool': async ({ pool }, body) => (await pool?.view(projectOf(body))) ?? { machines: [], others: [], servers: [] },
  'machines/cards': async ({ machineCards }) => (await machineCards?.()) ?? [],
  'machines/folder': async ({ pool }, body) => {
    if (pool === undefined) throw fail('machines.unknown', {})
    const of = body.project === undefined ? { remote: textOf(body.remote, 'remote') } : { project: projectOf(body) }
    return pool.probe(textOf(body.machine, 'machine'), textOf(body.folder, 'folder'), of)
  },
  'machines/view': async ({ machinePage }, body) => {
    if (machinePage === undefined) throw fail('machines.unknown', {})
    return machinePage.view(textOf(body.machine, 'machine'))
  },
  'machines/invite': async ({ machines }, body) =>
    machines?.invite(
      typeof body.name === 'string' ? body.name : '',
      typeof body.address === 'string' ? body.address : undefined,
      typeof body.color === 'string' ? body.color : undefined,
      body.proxied === true,
    ),
  'forward/carry': ({ carry }, body) => carry(projectOf(body)),
  'forward/resolve': ({ resolveCarry }, body) => resolveCarry(projectOf(body)),
  'history/events': async ({ history }) => history?.events() ?? [],
  'history/task': async ({ history }, body) => history?.task(textOf(body.task, 'task')) ?? { runs: [], sessions: [] },
  'archive/page': async ({ history }, body) =>
    (await history?.archive?.(projectOf(body), body.after === null || body.after === undefined ? null : textOf(body.after, 'after'), body.focus === undefined ? undefined : textOf(body.focus, 'focus'))) ?? { tasks: [], next: null },
  'outside/tasks': async ({ history }, body) => (await history?.outside?.(projectOf(body))) ?? [],
  'outside/archive': async ({ history }, body) =>
    (await history?.outsideArchive?.(projectOf(body), body.after === null || body.after === undefined ? null : textOf(body.after, 'after'))) ?? { tasks: [], next: null },
  'dictation/transcribe': async ({ dictation }, body) => {
    if (dictation === undefined) throw fail('dictation.off', {})
    return { text: await dictation.transcribe(textOf(body.audio, 'audio'), textOf(body.type, 'type')) }
  },
  'chat/menu': async ({ chatMenu }, body) =>
    (await chatMenu?.(projectOf(body), body.task === null || body.task === undefined ? null : textOf(body.task, 'task'))) ?? [],
}

const MAX_BODY_BYTES = 64 * 1024
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
/** An answer carries its files in base64. */
const MAX_ANSWER_BYTES = 64 * 1024 * 1024
const BODY_LIMITS: Record<string, number> = {
  '/api/session/answer': MAX_ANSWER_BYTES,
  '/api/dictation/transcribe': DICTATION_BODY_BYTES,
  ...BUILTIN_BODY_LIMITS,
  ...CHATS_BODY_LIMITS,
}

export function createEvenKeelServer(deps: ServerDeps): Server {
  return guardedServer(deps.guard, (request, response, visitor) => route(deps, request, response, visitor))
}

/**
 * The page alone, for a service that started nothing — its storage is from a newer Even Keel or cannot be migrated:
 * `/api/events` sends the reason as the event `blocked`, the other API calls get 503.
 */
export function createBlockedServer(deps: { guard: () => GuardSettings; publicDir: string; reason: Notice }): Server {
  return guardedServer(deps.guard, async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname
    if (request.method === 'GET' && path === '/api/events') {
      eventWriter(response).write(formatEvent('blocked', deps.reason))
      return
    }
    if (path.startsWith('/api/')) sendJson(response, 503, { error: englishOf(deps.reason), notice: deps.reason })
    else if (request.method === 'GET') await serveStatic(deps.publicDir, path, response)
    else response.writeHead(405).end()
  })
}

async function route(deps: ServerDeps, request: IncomingMessage, response: ServerResponse, visitor: Visitor): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const path = url.pathname

  if (await accessRoute(deps.access, request, response, visitor)) return
  // A visitor not signed in gets the page's files only: the guard lets nothing else through, this holds it twice.
  if (!visitor.signedIn && (request.method !== 'GET' || path.startsWith('/api/'))) {
    response.writeHead(401, { 'cache-control': 'no-store' }).end()
    return
  }

  if (request.method === 'GET' && path === '/api/profiles/oauth/callback') return oauthCallback(deps.profiles, url.searchParams, response)

  if (request.method === 'GET' && path === '/api/state') {
    sendJson(response, 200, deps.getState())
    return
  }

  if (request.method === 'GET' && path === '/api/tray') {
    sendJson(response, 200, deps.getTray())
    return
  }

  if (request.method === 'GET' && path === '/api/launches') {
    sendJson(response, 200, deps.launches())
    return
  }

  const badge = /^\/api\/projects\/([^/]+)\/badge\.svg$/.exec(path)
  if (request.method === 'GET' && badge !== null) {
    const svg = deps.badge?.(decodeURIComponent(badge[1]!), url.searchParams.get('theme') === 'light' ? 'light' : 'dark', url.searchParams.get('still') === '1')
    if (svg === undefined) response.writeHead(404).end()
    else response.writeHead(200, { 'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'no-store' }).end(svg)
    return
  }

  const checkpoint = /^\/api\/sessions\/([^/]+)\/checkpoint$/.exec(path)
  if (request.method === 'GET' && checkpoint !== null) {
    let found: Awaited<ReturnType<typeof deps.checkpoint>>
    try {
      found = await deps.checkpoint(decodeURIComponent(checkpoint[1]!))
    } catch (error) {
      sendFailure(response, error)
      return
    }
    if (found === undefined) response.writeHead(404).end()
    else sendJson(response, 200, found)
    return
  }

  const handoffNote = /^\/api\/sessions\/([^/]+)\/note$/.exec(path)
  if (request.method === 'GET' && handoffNote !== null) {
    let note: string | null | undefined
    try {
      note = await deps.handoffNote(decodeURIComponent(handoffNote[1]!))
    } catch (error) {
      sendFailure(response, error)
      return
    }
    if (note === undefined) response.writeHead(404).end()
    else sendJson(response, 200, note === null ? { note: false } : { note: true, path: note })
    return
  }

  const mergeCheck = /^\/api\/sessions\/([^/]+)\/check$/.exec(path)
  if (request.method === 'GET' && mergeCheck !== null) {
    const check = deps.mergeCheck(decodeURIComponent(mergeCheck[1]!))
    if (check === undefined) response.writeHead(404).end()
    else sendJson(response, 200, check)
    return
  }
  if (request.method === 'POST' && mergeCheck !== null) {
    let known: boolean
    try {
      const report = checkReportOf(await readJsonBody(request, MAX_BODY_BYTES))
      if (report === null) throw fail('request.required', { field: 'tree' })
      known = deps.checkReport(decodeURIComponent(mergeCheck[1]!), report)
    } catch (error) {
      sendFailure(response, error)
      return
    }
    if (known) sendJson(response, 200, { ok: true })
    else response.writeHead(404).end()
    return
  }

  const outsider = /^\/api\/sessions\/([^/]+)\/outsider$/.exec(path)
  if (request.method === 'POST' && outsider !== null) {
    let held: string[] | undefined
    try {
      const files = filesOf(await readJsonBody(request, MAX_BODY_BYTES))
      if (files === null) throw fail('request.required', { field: 'files' })
      held = deps.outsiderFiles(decodeURIComponent(outsider[1]!), files)
    } catch (error) {
      sendFailure(response, error)
      return
    }
    if (held === undefined) response.writeHead(404).end()
    else sendJson(response, 200, { held })
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
      // The time comes with the card (BTN-1097): the page does not ask Tally itself. Stats off, failing or slow — no time.
      const [found, activeS] = await Promise.all([deps.tasks.card(task), activeTimeOf(deps.stats, task)])
      view = found === undefined ? undefined : { ...found, activeS }
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
    let context: string | null = null
    let inboxWanted = false
    try {
      const body = await readJsonBody(request, MAX_BODY_BYTES)
      if (!HOOK_EVENTS.includes(body.event as MailEvent)) throw fail('request.required', { field: 'event' })
      const sessionId = decodeURIComponent(mail[1]!)
      delivery = await deps.mail(sessionId, body.event as MailEvent)
      if (delivery !== undefined) {
        context = deps.mailContext?.(sessionId, body.event as MailEvent) ?? null
        inboxWanted = deps.inboxWanted?.(sessionId) === true
      }
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
          sendJson(response, 200, { message: delivery?.message ?? null, ...(context === null ? {} : { context }), ...(inboxWanted ? { inbox: true } : {}) })
        } catch (error) {
          closed()
          throw error
        }
      }
    }
    return
  }

  // The session's own key comes only from a hook on this machine, never over the network (BTN-1322).
  const inbox = /^\/api\/sessions\/([^/]+)\/inbox$/.exec(path)
  if (request.method === 'POST' && inbox !== null) {
    if (deps.inbox === undefined || !LOOPBACK.has(request.socket.remoteAddress ?? '')) {
      response.writeHead(404).end()
      return
    }
    try {
      const body = await readJsonBody(request, MAX_BODY_BYTES)
      const known = deps.inbox(decodeURIComponent(inbox[1]!), textOf(body.socket, 'socket'), textOf(body.token, 'token'))
      response.writeHead(known ? 204 : 400).end()
    } catch (error) {
      sendFailure(response, error)
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
      const body = await readJsonBody(request, MAX_BODY_BYTES)
      check = await deps.settings.check(draftOf(body), { tracker: body.askTracker !== false })
    } catch (error) {
      sendFailure(response, error)
      return
    }
    sendJson(response, 200, check)
    return
  }

  if (request.method === 'POST' && path === BUILTIN_UPLOAD) {
    let attached: unknown
    try {
      attached = await builtinUpload(deps, url.searchParams, request)
    } catch (error) {
      sendFailure(response, error)
      return
    }
    sendJson(response, 200, attached)
    return
  }

  const query = request.method === 'POST' ? QUERIES[path.slice('/api/'.length)] : undefined
  if (query !== undefined) {
    let result: unknown
    try {
      await deps.catchUp?.()
      result = await query(deps, await readJsonBody(request, BODY_LIMITS[path] ?? MAX_BODY_BYTES), request)
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
      await deps.catchUp?.(true)
      await command(deps, body)
      if (path.startsWith('/api/chain/') || path === '/api/session/answer') {
        console.log(`page: ${path.slice('/api/'.length)} ${commandTarget(body)}`.trimEnd())
      }
    } catch (error) {
      sendFailure(response, error)
      return
    }
    sendJson(response, 200, { ok: true })
    setImmediate(() => deps.hub.broadcastSoon('state', deps.getState))
    return
  }

  if (request.method === 'GET' && path === '/api/events') {
    streamEvents(deps, response, visitor.device?.id)
    return
  }

  if (request.method === 'GET') {
    await serveStatic(deps.publicDir, path, response)
    return
  }

  response.writeHead(405).end()
}

/** How long the card waits for Tally's time before it goes without one. */
const CARD_TIME_WAIT_MS = 1_500

async function activeTimeOf(stats: ServerDeps['stats'], task: string): Promise<number | null> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), CARD_TIME_WAIT_MS)))
  const read = stats.activeTime(task).then((answer) => (answer.state === 'ok' ? answer.data : null), () => null)
  try {
    return await Promise.race([read, late])
  } finally {
    clearTimeout(timer)
  }
}

/** Tagged by the device's token: signing the device out closes its stream (`EventHub.closeTagged`). */
function streamEvents(deps: ServerDeps, response: ServerResponse, device: string | undefined): void {
  const writer = eventWriter(response)
  const unsubscribe = deps.hub.join('state', deps.getState(), writer.write, writer.end, device)
  response.once('close', unsubscribe)
}

