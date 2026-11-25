import { fail, notice, textNotice } from '../../../src/notice/notice.js'
import { prepareHeaderLevels, withHeaderLevels } from './fakeHeaderLevels.js'
import { fixName } from '../../../src/chain/fix.js'
import type { TrackerLinkState } from '../../../src/tracker/health.js'
import type { FeedLine } from '../../../src/sessions/transcript.js'
import { isLanguage } from '../../../src/language.js'
import { COPILOT } from '../../../src/copilot/name.js'
import { OPENCODE } from '../../../src/opencode/name.js'
import { isTallyMode, TALLY_DISABLED, TALLY_UNCHOSEN } from '../../../src/stats/mode.js'
import type { EvenKeelState, GitSetupView, SessionView } from '../../../src/state.js'
import type { Link, LiveSnapshot, LiveSource } from './connection.js'
import { deviceLogin } from '../accounts.js'
import { accountCommand, fakeAccount, fakeModels, FAKE_LIMITS, MANY_MODEL_PROMPTS, withAccount } from './fakeAccounts.js'
import { fakeCi, fakeMainCi } from './fakeCi.js'
import { EVENT_MS, fakeEvent } from './fakeEvents.js'
import { fakeUpdates } from './fakeUpdates.js'
import { fakeBackup } from './fakeBackup.js'
import { fakeConfigConflictCommand, fakeConfigConflicts } from './fakeConfigConflicts.js'
import { FAKE_PROJECTS, FAKE_PULL_READINESS, FAKE_VOCABULARY, fakeHandEdit } from './fakeConfig.js'
import { withCarry } from './fakeCarry.js'
import { withCompletionFailure, withMoveFailure } from './fakeCompletion.js'
import { withProtection } from './fakeProtection.js'
import { finishFakeCli, withCliCopies } from './fakeCliCopies.js'
import { withFix } from './fakeFix.js'
import { withLiveMilestones, withMilestonePreview, withSavedMilestoneOrder } from './fakeMilestones.js'
import { withDragPreview } from './fakeDrag.js'
import { isGroupFamilies, withFamilies, withGroupFamilies } from './fakeFamilies.js'
import { withBacklogLinks, withChangedText, withLongBacklog, withLongChain } from './fakeBacklog.js'
import { fakeCompare, fakeRuleDiff, fakeRules } from './fakeRules.js'
import { fakeSteps } from './fakeSteps.js'
import { fakeCheckpoints, fakeHistory, fakePeriod, fakeSpend, fakeTask, fakeTokens } from './fakeStats.js'
import { fakeCard } from './fakeCards.js'
import { builtinVocabulary, fakeAttach, fakeBuiltinCard, fakeBuiltinQuery, isBuiltinCard, withBuiltinTracker } from './fakeBuiltin.js'
import { addFakeReport, fakeExportQuery, withMovedRefs } from './fakeExport.js'
import { fakeImportQuery } from './fakeImport.js'
import { fakeBadgeCheck, fakeBadgeUrl, withFakeBadge } from './fakeBadge.js'
import { fakeDeliverMail, fakeImageUrl, fakeMailbox, fakeSentFileUrl, fakeSharedUrl, fakeAsk, FAKE_UNSAVED_ASK } from './fakeChat.js'
import { fakeTools } from './fakeTools.js'
import { fakePackages } from './fakePackages.js'
import { fakeSecrets } from './fakeSecrets.js'
import { fakeChangelog } from './fakeChangelog.js'
import { fakeAuthQuery, fakeDevicesChanged } from './fakeAuth.js'
import { PAGE_TOKEN } from '../../../src/secrets/catalog.js'
import { fakeChats, fakeDictation } from './fakeChats.js'
import { fakeProfiles, fakeProfileStatuses, fakeProfilesQuery, fakeSaved } from './fakeProfiles.js'
import { fakeTrackerProblems, withFeedScopeRefusal, withOrgScopeRefusal, withProfileOff, withPublicSources, withScopeRefusal, withTemplateLabels, withTrackerDown } from './fakeTrackers.js'
import { fakeJob } from './fakeCreation.js'
import { FakeNetwork, fakeMachineColors, fakeMachineCommand, fakeMachineLaneWait, fakeMachineNames, fakeMachineRequests, fakeMachineSignIns } from './fakeMachines.js'
import { fakeCheck, fakeGitChanges, fakeNoProjects } from './fakeProjects.js'
import { fixGroupSteps, withFixGroupBase } from './fakeFixGroup.js'
import { REORDER_MS, reorderStep } from './fakeReorder.js'
import { GROUP_STEP_MS, GROUP_STEPS, withGroupBase } from './fakeGroup.js'
import { fakeBranchCommand, fakeBranchDrift, fakeMachineDrift, fakeRepoBranches } from './fakeBranches.js'
import { ago, FEED_STEPS, minutes, session, task, turnStartedAt } from './fakeSessions.js'
import { closeCurrent, failedRenew, fakeCommand, finishCurrent, setPaused, startChain, startStages, takeNext } from './fakeCommands.js'
import { fakeCheckpoint, fakeHandedTranscript, fakeRecord, fakeTranscript } from './fakeTranscript.js'
import { withTrustPause } from './fakeTrust.js'
import { fakeTaskHistory, withHistoryLeft } from './fakeHistory.js'
import { fakeArchiveCount, fakeArchivePage, withFakeArchive } from './fakeArchive.js'
import { fakeOutside, fakeOutsideArchive } from './fakeOutside.js'
import { withFeeds, withLongNames, withMixedNames } from './fakeLong.js'
import { withFakeLanding } from './fakeLandings.js'
import { fakeLaunches, fakeState, withFakeSpent, KEY_LIMIT_AGENTS } from './fakeState.js'

const TICK_MS = 2_000
const ANSWER_MS = 300
const SLOW_VOCABULARY_MS = 4000
const SLOW_SAVE_MS = 3_000
const SAVES = new Set(['settings', 'project/settings', 'profiles/rules', 'profiles/moves'])
const CLOSE_TICKS = 5
const HANDOVER_MS = 1_000
const DEVICE_MS = 8_000
/** How long a started sign-in waits for the CLI's link, as the service's does: the dialog opens before it. */
const LINK_MS = 1_500
const START_STAGE_MS = 3_000
/** How long a message waits in the fake mailbox before the hook takes it. */
const MAIL_MS = 4_000
/** `?config=edited`: time to open the settings and start a draft before the file changes under it. */
const HAND_EDIT_MS = 15_000

function isLink(value: string | null): value is Link {
  return value === 'connecting' || value === 'live' || value === 'stale'
}

function isHulyState(value: string | null): value is TrackerLinkState {
  return value === 'off' || value === 'connecting' || value === 'live' || value === 'down'
}

export function createFakeSource(search: string): LiveSource {
  const params = new URLSearchParams(search)
  // `?host=terminal` — Even Keel runs from `npm start` or the tray: the trust commands give no `runas` (BTN-687).
  const asService = params.get('host') !== 'terminal'
  const requested = params.get('link')
  const link: Link = isLink(requested) ? requested : 'live'
  const requestedHuly = params.get('huly')
  const huly: TrackerLinkState = isHulyState(requestedHuly) ? requestedHuly : 'live'
  const listeners = new Set<() => void>()
  const launches = fakeLaunches(params.get('launches') === 'favorite')
  const idle = params.get('chain') === 'idle'
  const contextTokens = Number(params.get('ctx') ?? 61_000)
  const delay = params.has('delay') ? Number(params.get('delay')) : null
  const answer = () => new Promise((resolve) => setTimeout(resolve, delay ?? ANSWER_MS))
  // Stats turned off or never chosen answer as the service does, whatever `stats=` asks for.
  const statsMode = () => (current.state?.tally === 'off' ? TALLY_DISABLED : current.state?.tally === null ? TALLY_UNCHOSEN : params.get('stats'))
  let current: LiveSnapshot = {
    state: link === 'connecting' ? null : fakeState(huly, idle, contextTokens, launches, params.get('account'), params.get('limit'), params.get('usage')),
    link,
  }
  if (params.get('window') === 'unknown') {
    const session = current.state?.sessions.find((view) => view.task === 'ABC-5')
    if (session !== undefined) session.contextWindow = null
  }
  const language = params.get('lang')
  if (params.get('limit')?.startsWith('codex') && !KEY_LIMIT_AGENTS[params.get('limit')!] && current.state !== null) {
    current.state.account = fakeAccount('codex', idle, FAKE_LIMITS)
    const entry = current.state.account.accounts.find((each) => each.key === 'codex')!
    entry.name = params.get('limit') === 'codexLong' ? 'Build account for the documentation and integration project with a deliberately long display name' : 'Build account'
  }
  if (current.state !== null) current.state.chain.active = current.state.chain.active.map((lane) => withFakeSpent(current.state!, lane))
  if (params.has('badgeState') && current.state !== null) current.state = withFakeBadge(current.state, params.get('badgeState')!)
  if (params.has('fillMilestone') && current.state !== null) current.state = withMilestonePreview(current.state, params.get('fillMilestone')!)
  if (params.has('landing') && current.state !== null) current.state = withFakeLanding(current.state, params.get('landing')!)
  if (params.get('models') === 'many' && current.state !== null) current.state.config.shared.modelPrompts = MANY_MODEL_PROMPTS
  if (params.has('signInOn') && current.state !== null) current.state.signInOn = true
  const builtinTracker = params.get('tracker') === 'builtin'
  if (builtinTracker && current.state !== null) current.state = withBuiltinTracker(current.state)
  if (params.get('long') === 'on' && current.state !== null) current.state = withLongNames(current.state)
  if (params.get('long') === 'mixed' && current.state !== null) current.state = withMixedNames(current.state)
  if (params.has('feeds') && current.state !== null) current.state = withFeeds(current.state, params.get('feeds')!)
  if (params.get('families') === '3' && current.state !== null) current.state = withFamilies(current.state)
  if (params.has('archive') && current.state !== null) current.state = withFakeArchive(current.state, fakeArchiveCount(params.get('archive')))
  // The "Test projects" switches as stored before a reload (BTN-1364): `showTests=home,stats`.
  const shownTests = params.get('showTests')?.split(',') ?? []
  if (current.state !== null) current.state.showTests = { home: shownTests.includes('home'), stats: shownTests.includes('stats') }
  // `remote=off`: the Claude sessions' account starts no Remote Control (EKR-148).
  if (params.get('remote') === 'off' && current.state !== null) {
    const state = current.state
    const off = new Set(state.sessions.filter((each) => each.agent === 'claude').map((each) => each.account))
    state.sessions = state.sessions.map((each) => (off.has(each.account) ? { ...each, remoteUrl: null, remoteOff: 'disabled' } : each))
    state.account.accounts = state.account.accounts.map((entry) =>
      entry.agent === 'claude' && (off.has(entry.key) || off.has(entry.status?.email ?? null)) ? { ...entry, remoteOff: true } : entry)
  }
  const keyAgent = KEY_LIMIT_AGENTS[params.get('limit') ?? '']
  const keyAccount = current.state?.account.accounts.find((entry) => entry.key === 'ci-key')
  if (keyAgent && keyAccount) keyAccount.agent = keyAgent
  if (isLanguage(language) && current.state !== null) current.state.language = language
  if (params.has('platform') && current.state !== null) current.state.platform = params.get('platform')!
  const start = params.get('start')
  const restart: Pick<GitSetupView, 'restart'> =
    start === 'none' ? {} : { restart: start === 'service' ? { by: 'service', name: 'EvenKeel' } : start === 'console' ? { by: 'console' } : { by: 'tray' } }
  if (params.get('git') === 'missing' && current.state !== null) current.state.git = { version: null, name: null, email: null, install: 'winget install --id Git.Git -e', ...restart }
  if (params.get('git') === 'bare' && current.state !== null) current.state.git = { version: null, name: null, email: null, ...restart }
  if (params.get('git') === 'anon' && current.state !== null) current.state.git = { version: '2.47.1', name: null, email: null }
  const fakeStepJob = fakeJob(params.get('job'))
  if (fakeStepJob !== null && current.state !== null) current.state.jobs = [fakeStepJob]
  if (params.has('machines') && current.state !== null) {
    current.state.machineSignIns = fakeMachineSignIns(current.state, params.get('machines'))
    current.state.machineNames = fakeMachineNames(params.get('machines'))
    Object.assign(current.state, fakeMachineColors(current.state.machineNames))
  }
  if (params.has('machineRequest') && current.state !== null) current.state.machineRequests = fakeMachineRequests(params.get('machineRequest'))
  if (params.get('git') === 'plain' && current.state !== null) {
    const { projects } = current.state.config
    projects.OPS = { ...projects.OPS!, git: false, repo: 'C:/Users/EvenKeelSvc/AppData/Local/even-keel/projects/ops-3f9a1c2e', ci: { ...projects.OPS!.ci, guard: false }, pullRequests: false, slot: 0 }
    const found = params.get('gitFound')
    if (found !== null) current.state.gitFound = { OPS: { branch: found === '' ? null : found, since: 1_763_000_000_000 } }
  }
  if (params.has('ci') && current.state !== null) {
    current.state.ci = fakeCi(params.get('ci'))
    const { mainCi, ciWait } = fakeMainCi(params.get('ci'))
    current.state.mainCi = mainCi
    const abc = current.state.chain.active.find((each) => each.project === 'ABC')
    if (abc !== undefined && ciWait !== undefined) abc.ciWait = ciWait
  }
  if (params.get('log') === 'empty' && current.state !== null) current.state.eventLog = []
  if (params.get('history') === 'left' && current.state !== null) current.state = withHistoryLeft(current.state)
  if (params.get('trackers') === 'problems' && current.state !== null) current.state.trackers = fakeTrackerProblems(current.state.trackers)
  if (params.get('trackers') === 'public' && current.state !== null) current.state = withPublicSources(current.state)
  if (params.get('trackers') === 'templates' && current.state !== null) current.state = withTemplateLabels(current.state)
  if (params.get('trackers') === 'scope' && current.state !== null) current.state = withScopeRefusal(current.state)
  if (params.get('trackers') === 'feedScope' && current.state !== null) current.state = withFeedScopeRefusal(current.state)
  if (params.get('trackers') === 'orgScope' && current.state !== null) current.state = withOrgScopeRefusal(current.state)
  if (params.get('trackers') === 'off' && current.state !== null) current.state = withProfileOff(current.state)
  if (params.get('trackers') === 'down' && current.state !== null) current.state = withTrackerDown(current.state)
  if (params.get('hulyClient') === 'installing' && current.state !== null) current.state.hulyClient = notice('huly.clientInstalling', {})
  if (params.get('hulyClient') === 'failed' && current.state !== null) {
    current.state.hulyClient = notice('huly.clientFailed', {}, { detail: 'npm ERR! code ECONNRESET npm ERR! network aborted' })
  }
  if (current.state !== null) current.state.updates = fakeUpdates(params)
  if (current.state !== null) current.state.backup = fakeBackup(params.get('backup'))
  if (current.state !== null) current.state.configConflicts = fakeConfigConflicts(params.get('configConflict'))
  if (params.get('memoryMirror') === 'on' && current.state !== null) {
    const address = 'ssh://git@git.example.com/john-doe/even-keel-memory.git'
    current.state.memoryMirror = notice('memory.mirrorPrivate', { address })
    current.state.config.shared.memoryMirror = address
  }
  if (params.get('cli') === 'unchecked' && current.state !== null) {
    const unchecked = (agent: string, title: string, installed: string, checked: string) => ({
      agent,
      account: null,
      installed,
      checked,
      notice: { code: 'agent.uncheckedVersion' as const, params: { title, installed, checked } },
    })
    current.state.cliVersions = [unchecked('claude', 'Claude Code', '2.1.303', '2.1.301'), unchecked('codex', 'Codex', '0.163.0', '0.162.1')]
  }
  if (params.get('cli') === 'daemon' && current.state !== null) {
    const params = { title: 'Claude Code', account: 'global', running: '2.1.303', wanted: '2.1.301' }
    current.state.cliVersions = [{ agent: 'claude', account: 'global', installed: '2.1.303', checked: '2.1.301', notice: { code: 'agent.daemonVersion', params } }]
  }
  if (params.get('cliCheck') === 'mixed' && current.state !== null) {
    const at = Date.now() - 3 * 60_000
    current.state.cliChecks = [
      { agent: 'claude', at, notice: { code: 'cliCheck.waiting', params: { title: 'Claude Code', version: '2.1.312', account: 'Main account' } } },
      { agent: 'codex', at, notice: { code: 'cliCheck.failed', params: { title: 'Codex', version: '0.164.0' }, detail: 'a launch: no session within 120 s' } },
    ]
  }
  if (params.get('cliCheck') === 'passed' && current.state !== null) {
    current.state.cliChecks = [{ agent: 'claude', at: Date.now(), notice: { code: 'cliCheck.passed', params: { title: 'Claude Code', version: '2.1.312' } } }]
  }
  if (params.get('fallback') === 'on' && current.state !== null) {
    const notice = { code: 'chain.noAccountFor' as const, params: { task: 'ABC-10', label: 'Codex', provider: 'Claude' } }
    current.state.fallbacks = [{ at: new Date().toISOString(), task: 'ABC-10', notice }]
  }
  if (params.get('limits') === 'hot' && current.state !== null) {
    const { fiveHour, sevenDay } = FAKE_LIMITS
    current.state.limits = { ...FAKE_LIMITS, fiveHour: { ...fiveHour!, usedPercentage: 86 }, sevenDay: { ...sevenDay!, usedPercentage: 100 } }
  }
  // The header's account at 96% of its five hours, so the idle panel may draw its limits chat (BTN-1510).
  if (params.get('limits') === 'full' && current.state !== null) {
    const { account } = current.state
    account.accounts = account.accounts.map((entry) =>
      entry.key === account.active && entry.limits ? { ...entry, limits: { ...entry.limits, fiveHour: { usedPercentage: 96, resetsAt: new Date(Date.now() + 75 * 60_000).toISOString() } } } : entry)
  }
  if (params.get('limits') === 'none' && current.state !== null) current.state.limits = null
  if (params.has('branch') && current.state !== null) {
    current.state.branchDrift = fakeBranchDrift(params.get('branch'))
    current.state.machineDrift = fakeMachineDrift(params.get('branch'))
  }
  if (params.get('config') === 'broken' && current.state !== null) {
    current.state.configError = notice('config.statusBoth', { project: 'ABC', status: 'In Review' })
  }
  if (params.get('projects') === 'none' && current.state !== null) current.state = fakeNoProjects(current.state)
  // The demo's band (`running`) or its end card (`finished`) over ABC (BTN-776).
  if ((params.get('demo') === 'running' || params.get('demo') === 'finished') && current.state !== null) current.state.demo = { project: 'ABC', finished: params.get('demo') === 'finished' }
  // The service transcribes the chat's recordings (BTN-1391); `quota`/`failed` refuse them, `slow` answers after 8 s.
  if (params.has('dictation') && current.state !== null) current.state.dictation = params.get('dictation') !== 'off'
  if (params.has('tally') && current.state !== null) {
    const mode = params.get('tally')
    current.state.tally = isTallyMode(mode) ? mode : null
  }
  if (params.has('packages') && current.state !== null) current.state.packages = fakePackages(current.state.projects, params.get('packages'))
  if (params.has('secrets') && current.state !== null) current.state.secrets = fakeSecrets(params.get('secrets'))
  if (params.has('profiles') && current.state !== null) current.state.profiles = fakeProfiles(params.get('profiles'))
  if (current.state !== null && (params.get('ci')?.startsWith('gitlab') || params.get('profiles') === 'gitlab-ci')) {
    current.state.remotes = { ...current.state.remotes, ABC: [{ id: 'gitlab.example.com/group/subgroup/app', path: 'subgroup/app' }] }
    current.state.pullReadiness = { ...current.state.pullReadiness, ABC: notice('review.unsupportedHost', { remote: 'origin', host: 'gitlab.example.com' }) }
    if (!params.has('profiles')) current.state.profiles = fakeProfiles('gitlab-ci')
  }
  if (current.state !== null && params.has('protection')) current.state = withProtection(current.state, params.get('protection')!)
  if (current.state !== null) current.state = withCliCopies(current.state, params)
  const active = current.state?.chain.active[0]
  if (['apiError', 'apiRetry', 'transient', 'streamError', 'modelError'].includes(params.get('chain') ?? '') && current.state !== null && active) {
    const agent = params.get('agent') ?? 'codex'
    const transient = params.get('chain') === 'transient'
    const modelError = params.get('chain') === 'modelError'
    const diagnostic = modelError ? notice('chain.modelUnavailable', { model: 'openai/gpt-6.1-sol' }) : params.get('chain') === 'streamError' ? notice('opencode.streamError', {}) : undefined
    const error = transient || params.get('chain') === 'apiRetry' ? 'The model is at capacity. Try again later.' : 'The requested model is not supported.'
    const failed: SessionView = {
      ...session('ABC-5', contextTokens, params.get('chain') === 'apiRetry' ? 'working' : transient || modelError ? 'waiting' : 'error'),
      agent: ['claude', 'codex', 'opencode', 'copilot'].includes(agent) ? agent : 'codex',
      model: null,
      effort: null,
      apiErrorKind: modelError ? 'model' : transient || params.get('chain') === 'apiRetry' ? 'transient' : 'error',
      apiError: error,
      ...(diagnostic === undefined ? {} : { apiErrorNotice: diagnostic }),
      asking: false,
      ask: null,
      waitingFor: null,
      feed: [
        { at: ago(2), kind: 'text', text: 'Checking the chain order before the next edit.' },
        { at: ago(1), kind: 'tool', text: 'Read src/chain/order.ts' },
        { at: ago(0), kind: 'error', text: error, ...(diagnostic === undefined ? {} : { notice: diagnostic }) },
      ],
      remoteUrl: null,
      remoteOff: 'no-bridge',
    }
    current.state.sessions = current.state.sessions.map((each) => each.task === 'ABC-5' ? failed : each)
    const limit = transient ? { at: ago(0), account: failed.account, resetsAt: new Date(Date.now() + 15 * 60_000).toISOString(), lastReplyAt: ago(1), then: 'resume' as const, acted: null } : undefined
    current.state.chain.active = [{ ...active, ...(modelError && { paused: true, error: diagnostic! }), current: { task: 'ABC-5', sessionId: failed.sessionId, since: ago(42), ...(limit === undefined ? {} : { limit }) } }]
  }
  if (params.get('chain') === 'limit' && active) {
    current.state!.chain.active = [{ ...active, current: null, limitUntil: new Date(Date.now() + 95 * 60_000).toISOString() }]
  }
  if (params.get('chain') === 'modelWeek' && active) {
    const modelWeek = { model: 'Fable', until: new Date(Date.now() + 95 * 60_000).toISOString() }
    current.state!.chain.active = [{ ...active, current: null, modelWeek }]
  }
  if (params.get('chain') === 'modelWeekUnknown' && active) {
    current.state!.chain.active = [{ ...active, current: null, modelWeek: { model: 'Fable', until: null } }]
  }
  if (params.get('chain') === 'limitsUnread' && active) {
    const limitsWait = { account: 'global', next: new Date(Date.now() + 4 * 60_000).toISOString() }
    current.state!.chain.active = [{ ...active, current: null, limitsWait }]
  }
  if (params.get('chain') === 'paused' && current.state !== null) current.state = setPaused(current.state, 'ABC', true)
  if (params.get('chain') === 'noBranch' && active) {
    const error = notice('git.noBranch', { project: active.project, branch: 'trunk', repo: 'D:/work/abc' })
    current.state!.chain.active = [{ ...active, current: null, paused: true, error }]
  }
  if ((params.get('chain') === 'folderTaken' || params.get('chain') === 'folderTakenGone') && active) {
    const error = notice('machines.folderTaken', { name: 'Example desktop', owner: 'machine-elsewhere' })
    current.state!.chain.active = [{ ...active, current: null, paused: true, error }]
  }
  if (params.get('chain') === 'accountAbsent' && active) {
    const error = notice('machines.accountAbsent', { account: 'john.doe@example.com', machine: 'machine-1', name: 'Example laptop' })
    current.state!.chain.active = [{ ...active, current: null, paused: true, error }]
  }
  withTrustPause(current.state, params, asService)
  if (params.get('chain') === 'slot' && active) {
    const dirty = notice('slot.dirty', { path: '.claude/worktrees/even-keel', full: 'D:/work/abc/.claude/worktrees/even-keel' },{ detail: 'M src/app.ts\n?? src/scratch.ts' })
    const slotWait = { notice: notice('slot.waiting', { task: 'ABC-12' }, { items: [dirty] }), at: new Date().toISOString() }
    current.state!.chain.active = [{ ...active, current: null, slotWait }]
  }
  if (params.get('chain') === 'folder' && active) {
    const slotWait = { notice: notice('folder.busy', { tasks: ['ABC-9'], task: 'ABC-12' }), at: new Date().toISOString() }
    current.state!.chain.active = [{ ...active, current: null, slotWait }]
  }
  if (params.get('chain') === 'closing' && active) current.state!.chain.active = [{ ...active, current: null, closing: 'ABC-4' }]
  // Two lanes of ABC on two machines (BTN-993), and a closed task that moved from one to the other. ABC-20 would go
  // above the queue: its ghost stands right under both running lanes, the place the service gives it (BTN-1641).
  if (params.get('chain') === 'lanes' && active) {
    const state = current.state!
    state.machineNames = { pc: 'Workstation', srv: 'Home server' }
    Object.assign(state, fakeMachineColors(state.machineNames))
    state.chain.active = [{ ...active, machine: 'pc' }, { project: active.project, machine: 'srv', current: { task: 'ABC-6', sessionId: null, since: ago(1) }, paused: false, error: null }, ...state.chain.active.slice(1)]
    const run = (sessionId: string, at: number, machine: string) => ({ sessionId, at: ago(at), how: 'checkpoint' as const, resumed: 0, answers: 0, machine })
    state.taskSessions['ABC-4'] = [run('lanes-2', 120, 'srv'), run('lanes-1', 300, 'pc')]
    const order = state.chain.projects['ABC']!
    state.chain.projects['ABC'] = { ...order, landing: { ...order.landing, 'ABC-20': 'ABC-7' } }
  }
  // The running group "Under way" through its steps (BTN-1613); `&group=<n>` starts with the first n done.
  // A fix of main in the group and the task it interrupted under it (BTN-1617): the same steps and `&group=<n>`.
  const fixGroup = params.get('chain') === 'fixGroup'
  const groupSteps = fixGroup ? fixGroupSteps(params.get('fixEnd')) : GROUP_STEPS
  const groupFrom = (params.get('chain') === 'group' || fixGroup) && active ? Math.min(Number(params.get('group') ?? 0), groupSteps.length) : null
  const groupBase = fixGroup ? withFixGroupBase : withGroupBase
  if (groupFrom !== null) current.state = groupSteps.slice(0, groupFrom).reduce((state, step) => step(state), groupBase(current.state!))
  const groupFamilies = params.get('families')
  if (groupFrom !== null && isGroupFamilies(groupFamilies)) current.state = withGroupFamilies(current.state!, groupFamilies)
  // A task on the home server whose new session has already ended its first turn (BTN-1314): the state carries the
  // session from that machine's mirror, so the row shows its lamp and the panel the session, not the start.
  if (params.get('chain') === 'elsewhere' && active) {
    const state = current.state!
    state.machineNames = { pc: 'Workstation', srv: 'Home server' }
    Object.assign(state, fakeMachineColors(state.machineNames))
    const view = { ...session('ABC-6', 41_000, 'waiting'), waitingFor: null, startedAt: ago(1.5), lastActivityAt: ago(0.2) }
    state.sessions = [...state.sessions.filter((each) => each.task !== 'ABC-6'), view]
    state.chain.active = [{ ...active, machine: 'pc' }, { project: active.project, machine: 'srv', current: { task: 'ABC-6', sessionId: view.sessionId, since: ago(1.5) }, paused: false, error: null }, ...state.chain.active.slice(1)]
    state.taskSessions['ABC-6'] = [{ sessionId: view.sessionId, at: ago(1.5), how: 'launch', resumed: 0, answers: 0, machine: 'srv' }]
  }
  // The home server is gone (BTN-1270): one task of its pushed its branch and can move, the other did not.
  if (params.get('chain') === 'stranded' && active) {
    const state = current.state!
    state.machineNames = { pc: 'Workstation', srv: 'Home server' }
    Object.assign(state, fakeMachineColors(state.machineNames))
    state.stranded = { [active.project]: { 'ABC-6': { machine: 'srv', pushed: true }, 'ABC-7': { machine: 'srv', pushed: false } } }
  }
  const packageWaits: Record<string, string> = { packages: 'probing', packagesSilent: 'silent', gateway: 'gateway' }
  const packageWait = packageWaits[params.get('chain') ?? '']
  if (packageWait !== undefined && active) {
    current.state!.packages = fakePackages(current.state!.projects, packageWait)
    current.state!.chain.active = [{ ...active, current: null }]
  }
  if (current.state !== null) fakeMachineLaneWait(current.state, params.get('chain') ?? '')
  if (params.get('chain') === 'packagesPause' && active) {
    const error = notice('chain.packagesNotReady', { project: 'ABC', packages: ['forgejo'] })
    current.state!.packages = fakePackages(current.state!.projects, 'blocked')
    current.state!.chain.active = [{ ...active, current: null, paused: true, error }]
  }
  const waits = { ci: {}, check: { local: true as const }, afterGreen: { after: true as const }, remoteFix: { by: 'DEMO' } }
  const wait = params.get('chain') ?? ''
  if (Object.hasOwn(waits, wait) && active) {
    const local = waits[wait as keyof typeof waits]
    const ciWait = { commit: '9f77142a5c0e3d1b7e6f4a2c8d9b0e1f2a3b4c5d', since: new Date(Date.now() - 4 * 60_000).toISOString(), ...local }
    current.state!.chain.active = [{ ...active, current: null, ciWait }]
  }
  const parallel = Number(params.get('parallel') ?? 1)
  if (parallel > 1 && current.state !== null) {
    current.state = startChain({ ...current.state, chain: { ...current.state.chain, parallel, queue: current.state.chain.queue.slice(1) } }, 'DEMO', launches)
  }
  if (params.get('chain') === 'drag' && current.state !== null) current.state = withDragPreview(current.state)
  if (params.get('backlog') === 'many' && current.state !== null) current.state = withLongBacklog(current.state)
  if (params.get('chain') === 'long' && current.state !== null) current.state = withLongChain(current.state)
  if (params.get('backlog') === 'changed' && current.state !== null) current.state = withChangedText(current.state)
  if (params.get('backlog') === 'links' && current.state !== null) current.state = withBacklogLinks(current.state)
  if (params.get('chain') === 'backlog' && current.state !== null) {
    const { tasks, chain } = current.state
    current.state.tasks = [
      ...tasks.map((each) => (each.id === 'ABC-10' ? { ...each, blockedBy: ['ABC-16', 'ABC-21'] } : each)),
      task('ABC-16', 'Схема базы статистики', 'Backlog', 'UnStarted', ['ABC-17']),
      task('ABC-17', 'Выбор хранилища', 'Backlog', 'UnStarted'),
      task('ABC-21', 'Новая схема ключей', 'Backlog', 'UnStarted', [], 'v0.3 — служба'),
    ]
    const order = chain.projects['ABC']!
    chain.projects['ABC'] = {
      ...order,
      waiting: ['ABC-16', 'ABC-17', 'ABC-21'],
      landing: { ...order.landing, 'ABC-16': 'ABC-10', 'ABC-17': null },
      refused: { 'ABC-21': notice('order.later', { task: 'ABC-10', milestone: 'v0.2 — удобство', blocker: 'ABC-21', blockerMilestone: 'v0.3 — служба' }) },
    }
  }
  if (params.get('chain') === 'blockers' && current.state !== null) {
    // Every kind of blocker outside the chain in front of ABC-10: a backlog status, an excluding label, another project's task.
    const { tasks, chain } = current.state
    const other = task('DEMO-31', 'Общий формат журнала запусков', 'In Progress', 'Active')
    current.state.tasks = [
      ...tasks.map((each) => (each.id === 'ABC-10' ? { ...each, blockedBy: ['ABC-16', 'ABC-22', 'DEMO-31'] } : each)),
      task('ABC-16', 'Схема базы статистики', 'Backlog', 'UnStarted'),
      task('ABC-22', 'Выпустить ключ API для стенда', 'Todo', 'ToDo', [], 'v0.2 — удобство', { labels: ['Later'] }),
      other,
    ]
    const order = chain.projects['ABC']!
    chain.projects['ABC'] = { ...order, waiting: ['ABC-16', 'ABC-22', 'DEMO-31'], outside: [other], landing: { ...order.landing, 'ABC-16': 'ABC-10' } }
  }
  if (params.get('chain') === 'later' && current.state !== null) {
    const { tasks, chain } = current.state
    current.state.tasks = [
      ...tasks.map((each) => (each.id === 'ABC-10' ? { ...each, blockedBy: ['ABC-21'] } : each)),
      task('ABC-21', 'Новая схема ключей', 'Todo', 'ToDo', [], 'v0.3 — служба'),
    ]
    const error = notice('order.later', { task: 'ABC-10', milestone: 'v0.2 — удобство', blocker: 'ABC-21', blockerMilestone: 'v0.3 — служба' })
    chain.projects['ABC'] = { ...chain.projects['ABC']!, order: [], waiting: [], error }
    chain.active = chain.active.map((each) => (each.project === 'ABC' ? { ...each, current: null, paused: true, error } : each))
  }
  if (params.get('chain') === 'pushRejected' && current.state !== null) {
    const detail = [
      'remote: error: GH013: Repository rule violations found for refs/heads/abc-5/feature.',
      'remote: Review all repository rules at https://github.com/example/abc/rules?ref=refs%2Fheads%2Fabc-5%2Ffeature',
      'remote:',
      'remote: - Cannot update this protected ref.',
      'remote:',
      'To github.com:example/abc.git',
      ' ! [remote rejected] abc-5/feature -> abc-5/feature (push declined due to repository rule violations)',
      "error: failed to push some refs to 'github.com:example/abc.git'",
    ].join('\n')
    const cause = notice('review.pushFailed', { branch: 'abc-5/feature', remote: 'origin' }, { detail })
    const error = notice('review.notOpened', { task: 'ABC-5' }, { cause })
    current.state.chain.active = current.state.chain.active.map((each) => (each.project === 'ABC' ? { ...each, paused: true, error } : each))
  }
  if ((params.get('chain') === 'pulls' || params.get('chain') === 'pullsRemote') && current.state !== null) {
    const cause = params.get('chain') === 'pulls' ? FAKE_PULL_READINESS['DEMO']! : notice('review.noRemote', { project: 'ABC' })
    const error = notice('review.notReady', { project: 'ABC' }, { cause })
    current.state.pullReadiness = { ...current.state.pullReadiness, ABC: cause }
    current.state.chain.active = current.state.chain.active.map((each) => (each.project === 'ABC' ? { ...each, current: null, paused: true, error } : each))
  }
  if ((params.get('chain') === 'tracker' || params.get('chain') === 'trackerAdd') && current.state !== null) {
    const error = notice('chain.noTrackerMcp', { project: 'ABC', server: 'huly' })
    current.state.config.projects['ABC'] = { ...current.state.config.projects['ABC']!, brief: false }
    current.state.packages = fakePackages(current.state.projects, params.get('chain') === 'tracker' ? 'trackerAbc' : 'noTracker')
    current.state.chain.active = current.state.chain.active.map((each) => (each.project === 'ABC' ? { ...each, current: null, paused: true, error } : each))
  }
  if (params.get('chain') === 'skip' && current.state !== null) {
    current.state.chain.skipped ={ ABC: ['ABC-12'], OPS: ['OPS-2', 'OPS-3'] }
    current.state.taskSessions['ABC-9'] = [
      {
        sessionId: session('ABC-9', 0).sessionId,
        at: ago(300),
        how: 'launch',
        resumed: 0,
        answers: 0,
        left: { at: ago(280), reason: 'postpone', blockers: ['ABC-7'] },
      },
    ]
  }
  if (params.get('chain') === 'leftover' && current.state !== null) {
    current.state.chain.leftovers = {
      ABC: [
        {
          task: 'ABC-4',
          at: ago(35),
          notice: notice(
            'cleanup.worktreeKept',
            { path: '.claude/worktrees/abc-4', full: 'D:\\work\\abc\\.claude\\worktrees\\abc-4' },
            { detail: "fatal: '.claude/worktrees/abc-4' contains modified or untracked files, use --force to delete it" },
          ),
        },
        {
          task: 'ABC-3',
          at: ago(90),
          notice: notice('cleanup.branchKept', { branch: 'abc-3/task' }, { detail: "error: the branch 'abc-3/task' is not fully merged" }),
        },
        { task: 'ABC-2', at: ago(120), notice: textNotice('ABC-2: the worktree was kept (an entry saved before BTN-62)') },
      ],
    }
    // ABC-4's cleanup left its files: its row stays in view; the current task's are its session's and show nothing.
    current.state.works.ABC = {
      ...current.state.works.ABC,
      'ABC-4': { path: 'D:/work/abc/.claude/worktrees/abc-4', branch: 'abc-4/task', files: 2, ahead: 0 },
      ...(active?.current != null && { [active.current.task]: { path: 'D:/work/abc/.claude/worktrees/abc-5', branch: 'abc-5/task', files: 7, ahead: 1 } }),
    }
  }
  if (params.get('chain') === 'restart' && current.state !== null && active) {
    const stalled: SessionView = {
      ...session('ABC-5', contextTokens, 'limit'),
      apiError: 'Usage limit reached: Claude Code told the session to wrap up the turn',
      remoteUrl: null,
      remoteOff: 'lost',
    }
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? stalled : each))
    current.state.chain.active = [{ ...active, current: { task: 'ABC-5', sessionId: stalled.sessionId, since: ago(42) } }]
  }
  if ((params.get('chain') === 'relaying' || params.get('chain') === 'resuming') && current.state !== null && active) {
    const limited = session('ABC-5', contextTokens, 'limit')
    const move = params.get('chain') === 'resuming' ? 'resume' : 'relay'
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? limited : each))
    current.state.chain.active = [{ ...active, current: { task: 'ABC-5', sessionId: limited.sessionId, since: ago(42), starting: ago(0), move } }]
  }
  if ((params.get('chain') === 'ask' || params.get('chain') === 'unsaved') && current.state !== null && active) {
    const waiting = session('ABC-5', contextTokens, 'waiting')
    const asking: SessionView = params.get('chain') === 'ask' ? { ...waiting, ask: fakeAsk(params.get('ask')) } : { ...waiting, waitingFor: 'input needed', ask: FAKE_UNSAVED_ASK }
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? asking : each))
    current.state.chain.active = [{ ...active, current: { task: 'ABC-5', sessionId: asking.sessionId, since: ago(42) } }]
  }
  // A turn that ended on an answer without the `NO CHANGES:` mark: "Accept as answer" (BTN-885).
  if (params.get('chain') === 'answered' && current.state !== null && active) {
    const base = session('ABC-5', contextTokens, 'waiting')
    const answered: SessionView = { ...base, waitingFor: null, asking: false, ask: null, feed: [...base.feed, { at: ago(0), kind: 'text', text: 'Both formats are supported; details are in the task description.' }] }
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? answered : each))
    current.state.chain.active = [{ ...active, current: { task: 'ABC-5', sessionId: answered.sessionId, since: ago(42) } }]
  }
  if ((params.get('chain') === 'mail' || params.get('chain') === 'steer') && current.state !== null && active) {
    const working = session('ABC-5', contextTokens)
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? working : each))
    current.state.chain.active = [{ ...active, current: { task: 'ABC-5', sessionId: working.sessionId, since: ago(42) } }]
    const box = params.get('chain') === 'mail' ? fakeMailbox('ABC-5', working.sessionId, Date.now(), params.get('mail')) : { listens: true, steers: true, mail: [] }
    current.state.mailbox = { [working.sessionId]: box }
  }
  if (params.get('chain') === 'dialog' && current.state !== null && active) {
    const wedged: SessionView = {
      ...session('ABC-5', 0, 'waiting'),
      waitingFor: null,
      startupDialog: 'approve 1 new project MCP server (example) — attach to respond',
      lastActivityAt: null,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      stage: null,
      action: null,
      feed: [],
      cache: null,
      remoteUrl: null,
      remoteOff: 'no-bridge',
    }
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? wedged : each))
    current.state.chain.active = [{ ...active, current: { task: 'ABC-5', sessionId: wedged.sessionId, since: ago(6) } }]
  }
  if (params.get('chain')?.startsWith('silent') && current.state !== null && active) {
    const since = ago(params.get('chain') === 'silent-short' ? 1 : 6)
    const base = session('ABC-5', contextTokens, 'working')
    const feed = base.feed.filter((line) => line.at <= since)
    const quiet: SessionView = { ...base, silentSince: since, lastActivityAt: since, waitingFor: null, feed, action: feed.at(-1) ?? null }
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? quiet : each))
    current.state.chain.active = [{ ...active, current: { task: 'ABC-5', sessionId: quiet.sessionId, since: ago(80) } }]
  }
  // A turn that ended while its background command runs (BTN-960); `background-hung` — past the hour without a line.
  if (params.get('chain')?.startsWith('background') && current.state !== null && active) {
    const since = ago(params.get('chain') === 'background-hung' ? 70 : 12)
    const base = session('ABC-5', contextTokens, 'working')
    const feed = base.feed.filter((line) => line.at <= since)
    const hangsAt = new Date(Date.parse(since) + 60 * 60_000).toISOString()
    const waits: SessionView = { ...base, lastActivityAt: since, feed, action: feed.at(-1) ?? null, background: { command: 'npm run test:e2e -- --reporter=dot', hangsAt } }
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? waits : each))
    current.state.chain.active = [{ ...active, current: { task: 'ABC-5', sessionId: waits.sessionId, since: ago(80) } }]
  }
  if (params.get('chain') === 'hung' && current.state !== null && active) {
    const hung: SessionView = { ...session('ABC-5', contextTokens, 'waiting'), agent: OPENCODE, waitingFor: null, hungSince: ago(35), lastActivityAt: ago(35) }
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? hung : each))
    current.state.chain.active = [{ ...active, current: { task: 'ABC-5', sessionId: hung.sessionId, since: ago(80) } }]
  }
  if (params.get('chain')?.startsWith('completion') && current.state !== null) current.state = withCompletionFailure(current.state, params.get('chain')!)
  if (params.get('chain')?.startsWith('statusMove') && current.state !== null) current.state = withMoveFailure(current.state, params.get('chain')!)
  if (params.has('forward') && current.state !== null) current.state = withCarry(current.state, params.get('forward')!, session('XYZ-CARRY', 24_000), ago(4))
  if (params.get('chain') === 'fix' && current.state !== null) current.state = withFix(current.state, 'ABC', session(fixName('ABC'), 38_000), ago(6))
  if (params.get('chain') === 'aside' && current.state !== null) {
    const asking = session('ABC-5', contextTokens, 'waiting')
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? asking : each))
    current.state = withFix(current.state, 'ABC', session(fixName('ABC'), 38_000), ago(6), true)
  }
  const cache = params.get('cache')
  if ((cache === 'warn' || cache === 'cold') && current.state !== null) {
    const until = ago(cache === 'warn' ? -8 : 20)
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? { ...each, cache: { ttl: '1h', until } } : each))
  }
  // The transcript's cache ran out long ago; three keep-warm pings, each five minutes before it would, kept it warm (EKR-143).
  if (cache === 'warmed' && current.state !== null) {
    const kept = { cache: { ttl: '1h' as const, until: ago(125) }, warm: { at: ago(20), pings: 3 } }
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? { ...each, ...kept } : each))
  }
  // The cache trial gave ABC-5 its lifetime (BTN-1412): 5 mod 4 is 1, five minutes.
  if (cache === 'trial' && current.state !== null) {
    const trial = { cache: { ttl: '5m' as const, until: ago(-3) }, cacheTrial: true }
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? { ...each, ...trial } : each))
  }
  // A Copilot session's half-hour cache, as its transcript writes it (BTN-563).
  if (cache === 'copilot' && current.state !== null) {
    const copilot = { ttl: '30m' as const, until: ago(-12) }
    current.state.sessions = current.state.sessions.map((each) => (each.task === 'ABC-5' ? { ...each, agent: COPILOT, cache: copilot } : each))
  }
  if (params.get('chain') === 'checkpoint' && current.state !== null && active?.current) {
    const { task, sessionId } = active.current
    current.state.taskSessions[task] = [
      { sessionId: sessionId ?? crypto.randomUUID(), at: ago(20), how: 'checkpoint', resumed: 0, answers: 0 },
      { sessionId: crypto.randomUUID(), at: ago(70), how: 'checkpoint', resumed: 0, answers: 0, replaced: { at: ago(20), how: 'checkpoint' } },
      { sessionId: crypto.randomUUID(), at: ago(150), how: 'launch', resumed: 0, answers: 0, compactions: 1, replaced: { at: ago(70), how: 'checkpoint' } },
    ]
  }
  if (params.get('milestones') === 'saved' && current.state !== null) current.state = withSavedMilestoneOrder(current.state, { project: 'ABC', order: ['v0.3 — служба', 'v0.1 — каркас'] })
  if (current.state !== null) current.state = withLiveMilestones(withHeaderLevels(prepareHeaderLevels(current.state, params.get('header'))))
  const network = new FakeNetwork(params.get('machines'), (project) => current.state?.config.projects[project]?.repo ?? '')
  const chats = fakeChats(params.get('chats'))
  const notify = () => {
    if (current.state !== null) current.state = withLiveMilestones(withHeaderLevels(current.state))
    for (const listener of listeners) listener()
  }
  // The chats' sessions join the page's mailbox and its sessions once their list is read or a chat changes (BTN-1345, BTN-1427).
  const chatMail = () => {
    const state = current.state
    if (state === null) return
    const rows = chats.mailbox()
    const { ids, views } = chats.sessions()
    const shown = state.sessions.filter((each) => ids.has(each.sessionId))
    const sameMail = Object.entries(rows).every(([id, row]) => JSON.stringify(state.mailbox[id]) === JSON.stringify(row))
    const sameViews = shown.length === views.length && views.every((view) => shown.some((each) => each.sessionId === view.sessionId))
    if (sameMail && sameViews) return
    current.state = { ...state, mailbox: { ...state.mailbox, ...rows }, sessions: [...state.sessions.filter((each) => !ids.has(each.sessionId)), ...views] }
    notify()
  }

  const handover = params.get('chain') === 'handover'
  const closing = params.get('chain') === 'close' || handover
  let ticks = 0

  const close = (state: EvenKeelState): EvenKeelState => {
    if (!handover) return closeCurrent(state)
    const project = state.chain.active[0]?.project
    if (project === undefined) return state
    setTimeout(() => {
      current = { ...current, state: takeNext(current.state!, project) }
      notify()
    }, HANDOVER_MS)
    return finishCurrent(state)
  }

  if (params.get('config') === 'edited' && current.state !== null) {
    setTimeout(() => {
      current = { ...current, state: { ...current.state!, config: fakeHandEdit(current.state!.config) } }
      notify()
    }, HAND_EDIT_MS)
  }

  const event = params.get('event')
  if (event !== null && current.state !== null) {
    setTimeout(() => {
      current = { ...current, state: fakeEvent(current.state!, event) }
      notify()
    }, EVENT_MS)
  }

  if (groupFrom !== null) {
    const gap = Number(params.get('gap') ?? GROUP_STEP_MS)
    groupSteps.slice(groupFrom).forEach((step, index) => {
      setTimeout(() => {
        current = { ...current, state: step(current.state!) }
        notify()
      }, (index + 1) * gap)
    })
  }
  if (params.get('chain') === 'reorder') {
    setInterval(() => {
      current = { ...current, state: reorderStep(current.state!) }
      notify()
    }, Number(params.get('gap') ?? REORDER_MS))
  }

  if (link === 'live') {
    setInterval(() => {
      const state = closing && ++ticks % CLOSE_TICKS === 0 ? close(current.state!) : current.state!
      const [kind, text] = FEED_STEPS[(closing ? ticks : ++ticks) % FEED_STEPS.length]!
      const line: FeedLine = { at: ago(0), kind, text }
      const sessions = state.sessions.map((view) =>
        view.lamp === 'working' && view.contextTokens > 0
          ? { ...view, contextTokens: view.contextTokens + 800, lastActivityAt: ago(0), action: line, feed: [...view.feed.slice(1), line] }
          : view,
      )
      const trackers = state.trackers.map((tracker) =>
        tracker.health.state === 'live' ? { ...tracker, health: { ...tracker.health, lastOkAt: ago(0) } } : tracker,
      )
      current = { ...current, state: { ...state, sessions, trackers } }
      notify()
    }, TICK_MS)
  }
  // `?hubOs=linux` (BTN-1595): the hub's own machine on another system, so the icons show every combination.
  const hubOs = params.get('hubOs')
  if (hubOs !== null && current.state?.machineKinds !== undefined) {
    current.state.machineKinds = { ...current.state.machineKinds, [current.state.ownMachine ?? 'pc']: { platform: hubOs } }
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    snapshot: () => current,
    retryNow: () => {},
    command: async (name, body = {}) => {
      // A package's install takes a while, so Update all's progress shows (BTN-1480).
      if (delay !== null && (name === 'packages/update' || name === 'packages/install')) await answer()
      if (params.get('packages') === 'updateFails' && name === 'packages/update' && body.name === 'playwright@claude-plugins-official') throw fail('packages.busy', { name: body.name })
      const state = current.state
      if (state === null) throw new Error('fake: no state yet')
      if (name === 'machines/takeOver' && params.get('chain') === 'folderTakenGone') throw fail('machines.notTaken', {})
      // Every drop refused as the service refuses one past the running task (BTN-1644).
      if (name === 'chain/order' && params.get('order') === 'refused') {
        const running = state.chain.active.find((chain) => chain.project === body.project)?.current?.task
        throw fail('chain.currentFirst', { task: running ?? String(body.project) })
      }
      if (chats.command(name, body)) {
        chatMail()
        return
      }
      const edited = network.accounts.command(state, network.cards(state), name, body, (hub, args) => fakeCommand(state, hub, args, launches))
      if (edited !== undefined) {
        current = { ...current, state: edited }
        notify()
        return
      }
      if (network.command(name, body)) {
        // A colour or the own machine's capacity is the state's too: the chain's tags and the shared settings (BTN-1272).
        if (name === 'machines/color' && state.machineNames !== undefined) current = { ...current, state: { ...state, machineColors: network.colorsOf(state.machineNames) } }
        if (name === 'machines/capacity' && body.machine === state.ownMachine) current = { ...current, state: { ...state, chain: { ...state.chain, parallel: Number(body.capacity) } } }
        notify()
        return
      }
      const machine = fakeMachineCommand(state, name, body)
      // A machine's accounts changed: its cards are read again, as its next snapshot makes the hub tell the page.
      if (machine !== null) setTimeout(() => network.changed(), 0)
      const next = fakeBranchCommand(state, name, body, params.get('branch')) ?? machine ?? fakeConfigConflictCommand(state, name, body, params.get('configConflict')) ?? fakeCommand(state, name, body, launches)
      if (name === 'cli/download') setTimeout(() => {
        if (current.state === null) return
        current = { ...current, state: finishFakeCli(current.state, String(body.agent)) }
        notify()
      }, 3000)
      const started = (name === 'account/renew' || name === 'account/add') && next.account.login !== state.account.login ? next.account.login : null
      const waiting = started === null ? next : withAccount(next, { ...next.account, login: { ...started, urls: [], deviceCode: null, output: '' } })
      const starts = name === 'chain/start' || name === 'chain/restart' || (name === 'session/answer' && body.renew === true)
      const staged = starts ? startStages(state, next, String(body.project)) : [waiting]
      const stages = name === 'session/answer' && params.get('renew') === 'fail' ? failedRenew(staged, String(body.project)) : staged
      // `?save=slow|lost`: a settings save is answered at once and its state comes late or never (BTN-1318).
      const saving = SAVES.has(name) ? params.get('save') : null
      if (saving !== 'lost') stages.forEach((stage, index) => {
        const show = () => {
          current = { ...current, state: stage }
          notify()
        }
        if (index === 0 && saving === 'slow') setTimeout(show, SLOW_SAVE_MS)
        else if (index === 0) show()
        else setTimeout(show, index * (delay ?? START_STAGE_MS))
      })
      if (name === 'session/answer') {
        setTimeout(() => {
          if (current.state === null) return
          current = { ...current, state: fakeDeliverMail(current.state, params.get('mail') === 'returned') }
          notify()
        }, MAIL_MS)
      }
      if (started !== null) {
        setTimeout(() => {
          const now = current.state
          if (now === null || now.account.login?.startedAt !== started.startedAt || now.account.login.error !== null) return
          current = { ...current, state: withAccount(now, { ...now.account, login: started }) }
          notify()
        }, LINK_MS)
      }
      if ((name === 'account/renew' || name === 'account/add') && deviceLogin(next.account)) {
        // The code goes on OpenAI's page, never through Even Keel: the sign-in ends by itself a while later.
        setTimeout(() => {
          const now = current.state
          if (now === null || now.account.login?.startedAt !== next.account.login?.startedAt) return
          current = { ...current, state: withAccount(now, accountCommand(now.account, 'account/code', { code: 'ok' })) }
          notify()
        }, DEVICE_MS)
      }
    },
    session: async (sessionId) => {
      await answer()
      // A project chat's session has no task record: its window names the chat's own account and model.
      return current.state === null || sessionId.includes('-chat-') || sessionId.includes('-archived-') ? null : fakeRecord(current.state, sessionId)
    },
    transcript: async (sessionId, after) => {
      await answer()
      if (sessionId.endsWith('999')) return null
      const view = current.state?.sessions.find((each) => each.sessionId === sessionId)
      const turn = view?.lamp === 'working' ? { startedAt: turnStartedAt, tool: view.task === 'ABC-5' ? 'Bash npx vitest run src/chain' : null } : null
      if (after === 0 && view?.task === 'ABC-5' && ['apiError', 'apiRetry', 'transient', 'streamError', 'modelError'].includes(params.get('chain') ?? '')) return { lines: view.feed, turn }
      if (params.get('chain') === 'mail' && view?.task === 'ABC-5') {
        const mail = current.state?.mailbox[sessionId]?.mail ?? []
        const delivered: FeedLine[] = mail.filter(each => each.fate === 'delivered').map(each =>
          ({ kind: 'prompt', text: each.text, at: each.settledAt ?? each.postedAt, files: each.files }))
        const history = fakeTranscript(null, params.get('shots'))
        const base = params.has('mail') ? history.slice(0, 3) : history
        return { lines: [...base, ...delivered].slice(after), turn }
      }
      const handed = view === undefined || current.state === null ? null : fakeHandedTranscript(current.state, view)
      if (after === 0) return { lines: handed ?? fakeTranscript(view?.ask ?? null, params.get('shots')), turn }
      return { lines: [{ at: ago(0), kind: 'tool', text: `Read src/example-${Date.now() % 1000}.ts` }], turn }
    },
    onTranscript: () => () => {},
    onMachines: (listener) => network.on(listener),
    onDevices: (listener) => fakeDevicesChanged(listener),
    checkpoint: async (sessionId) => {
      await answer()
      const view = current.state?.sessions.find((each) => each.sessionId === sessionId)
      return view === undefined ? null : fakeCheckpoint(view)
    },
    imageUrl: (_sessionId, tool, index) => fakeImageUrl(tool, index),
    sentFileUrl: (_sessionId, name) => fakeSentFileUrl(name),
    sharedUrl: (_sessionId, tool, index) => fakeSharedUrl(tool, index),
    badgeUrl: (project, theme, still) => fakeBadgeUrl(current.state, project, theme, still),
    tools: async (project) => {
      await answer()
      return current.state?.projects.includes(project) ? fakeTools(project, current.state.trimTools, params.get('tools'), current.state.config.projects[project]?.git === false) : null
    },
    card: async (task) => {
      await answer()
      const mode = params.get('card')
      if (current.state === null) return null
      if (!isBuiltinCard(mode)) return fakeCard(current.state, task, mode)
      return withMovedRefs(fakeBuiltinCard(current.state, task, params.get('journal'), params.get('description'), params.get('files')), params.get('export'))
    },
    attach: async (task, file) => {
      await answer()
      return fakeAttach(task, file)
    },
    vocabulary: async (projectId) => {
      await answer()
      const mode = params.get('vocabulary')
      if (mode === 'slow') await new Promise((resolve) => setTimeout(resolve, SLOW_VOCABULARY_MS))
      if (mode === 'fail') throw new Error('huly: not connected')
      if (mode === 'none' || !FAKE_PROJECTS.includes(projectId) || current.state === null) return null
      return builtinTracker ? builtinVocabulary(current.state, projectId, FAKE_VOCABULARY) : FAKE_VOCABULARY
    },
    checkProject: async (draft, askTracker = true) => {
      await answer()
      if (current.state === null) throw new Error('fake: no state yet')
      const check = fakeCheck(current.state, draft, params.get('wizard'))
      return { ...check, tracker: askTracker ? check.tracker : null, service: asService }
    },
    query: async <T>(name: string, body: Record<string, unknown>) => {
      await answer()
      if (current.state === null) throw new Error('fake: no state yet')
      if (name.startsWith('auth/')) return fakeAuthQuery(name, body, current.state.secrets.variables.some((each) => each.name === PAGE_TOKEN && each.set)) as T
      if (name === 'models/list') return fakeModels(current.state.account, String(body.account), params.get('models')) as T
      if (name === 'project/branches') return fakeRepoBranches(current.state, String(body.project)) as T
      if (name === 'project/git/changes') return fakeGitChanges(params.get('gitChanges')) as T
      if (name === 'project/badge/check') return fakeBadgeCheck(body, params.get('badgeCheck')) as T
      if (name === 'dictation/transcribe') return (await fakeDictation(params.get('dictation'))) as T
      if (name === 'history/events') return current.state.eventLog as T
      if (name === 'history/task') return fakeTaskHistory(current.state, String(body.task)) as T
      if (name === 'archive/page') return (await fakeArchivePage(current.state, body, fakeArchiveCount(params.get('archive')))) as T
      if (name === 'outside/tasks') return (await fakeOutside(current.state, body, params.get('outside'))) as T
      if (name === 'outside/archive') return (await fakeOutsideArchive(current.state, body, params.get('outside'))) as T
      if (name === 'machines/cards') return network.cards(current.state) as T
      if (name === 'machines/view') {
        const page = network.page(String(body.machine), current.state)
        if (page === undefined) throw fail('machines.unknown', {})
        return page as T
      }
      if (name === 'machines/admit') {
        const admitted = network.admit(current.state, String(body.request))
        current = { ...current, state: admitted.state }
        notify()
        return { machine: admitted.machine } as T
      }
      const chat = chats.query(current.state, name, body)
      if (chat !== undefined) {
        queueMicrotask(chatMail)
        return chat as T
      }
      const machines = network.query(name, body)
      if (machines !== undefined) return machines as T
      if (name === 'machines/addresses') {
        return [
          { address: 'box.example.com', from: 'allowedHosts' },
          { address: '192.168.1.20', from: 'adapter', adapter: 'Ethernet' },
          { address: '100.64.0.7', from: 'adapter', adapter: 'Tailscale' },
        ] as T
      }
      const builtin =
        fakeExportQuery(current.state, name, body, params.get('export')) ??
        fakeImportQuery(current.state, name, body, params.get('import'), addFakeReport) ??
        fakeBuiltinQuery(current.state, name, body, params.get('card'), params.get('journal'))
      if (builtin !== null) {
        current = { ...current, state: builtin.state }
        notify()
        if (builtin.refusal !== undefined) throw builtin.refusal
        return builtin.result as T
      }
      if (name === 'project/trust') return { folder: 'D:/work/abc', trusted: params.get('trust') !== 'untrusted', platform: current.state.platform, user: 'evenkeel', service: asService } as T
      const draft = await fakeChangelog(current.state, name, body, params.get('changelog'))
      if (draft !== null) return draft as T
      if (name === 'profiles/statuses') return fakeProfileStatuses(current.state, body, params.get('profileStatuses'), FAKE_VOCABULARY.statuses) as T
      // `?profileProjects=fail`: the tracker gives no project list, as right after a restart (BTN-621).
      if (name === 'profiles/projects' && params.get('profileProjects') === 'fail') throw fail('profiles.unreachable', { tracker: 'Huly' })
      const result = fakeProfilesQuery(current.state, name, body)
      if (name === 'profiles/save') {
        current = { ...current, state: fakeSaved(current.state, (result as { id: string }).id, body) }
        notify()
      }
      return result as T
    },
    statsHistory: async (filter) => {
      await answer()
      return fakeHistory(statsMode(), filter)
    },
    statsPeriod: async (query) => {
      await answer()
      return fakePeriod(statsMode(), query)
    },
    statsSteps: async (query) => {
      await answer()
      return fakeSteps(statsMode(), query)
    },
    statsCheckpoints: async () => {
      await answer()
      return fakeCheckpoints(statsMode())
    },
    statsSpend: async () => {
      await answer()
      return fakeSpend(statsMode())
    },
    statsTokens: async () => {
      await answer()
      return fakeTokens(statsMode())
    },
    statsTask: async (task) => {
      await answer()
      return fakeTask(statsMode(), task)
    },
    statsRules: async (query) => {
      await answer()
      return fakeRules(statsMode(), params.get('rules'), query)
    },
    statsRuleDiff: async (changes) => {
      await answer()
      return fakeRuleDiff(statsMode(), changes)
    },
    statsCompare: async (query) => {
      await answer()
      return fakeCompare(statsMode(), params.get('rules'), query)
    },
  }
}
