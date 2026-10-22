import type { CiKind } from '../ci/model.js'
import type { UpdateBlock } from '../updates/model.js'

export const FORGES: Record<CiKind, string> = { github: 'GitHub', forgejo: 'Forgejo' }

export type GitStep ='excludeFile' | 'addWorktree' | 'listRemotes' | 'listWorktrees' | 'listBranches' | 'readStatus' | 'countCommits' | 'addSlot' | 'clean' | 'switch'

const list = (items: string[]) => items.join(', ')

const GIT_STEPS: Record<GitStep, (subject: string) => string> = {
  excludeFile: () => 'find the exclude file of',
  addWorktree: (task) => `add the worktree of ${task} to`,
  listRemotes: () => 'list the remotes of',
  listWorktrees: () => 'list the worktrees of',
  listBranches: () => 'list the branches of',
  readStatus: () => 'read the status of',
  countCommits: (main) => `count the commits beyond ${main} in`,
  addSlot: () => 'add the slot to',
  clean: () => 'clean',
  switch: (branch) => `switch to ${branch} in`,
}

const UPDATE_BLOCKS: Record<UpdateBlock | 'storage', string> = {
  service: 'Even Keel does not run as a service here, so nothing could restart it',
  git: 'the folder of Even Keel is not a git checkout',
  dirty: 'the checkout has uncommitted changes',
  tag: 'the checkout is not on the release tag of the installed version',
  checking: 'the checkout is still being read; try again in a moment',
  storage: 'the previous version cannot read the storage this one migrated',
}

// The English texts of the server's messages: the log and the English page both read them.
export const en = {
  text: (p: { text: string }) => p.text,

  'chain.unknownProject': (p: { project: string }) => `chain: ${p.project} is not a configured project`,
  'chain.notOpen': (p: { task: string; project: string }) => `chain: ${p.task} is not an open task of ${p.project}`,
  'chain.launching': (p: { task: string }) => `chain: ${p.task} is still launching; try again in a moment`,
  'chain.midTurn': (p: { task: string }) => `chain: ${p.task} is mid-turn; wait until its session stops`,
  'chain.notCurrent': (p: { task: string }) => `chain: ${p.task} is not the current task of a chain`,
  'chain.limitSpent': (p: { until: string }) => `chain: the usage limit is spent until ${p.until}; switch the account or wait`,
  'chain.noSession': (p: { task: string }) => `chain: no session of ${p.task} is known`,
  'chain.noAccountFor': (p: { task: string; label: string; provider: string }) =>
    `chain: ${p.task} is labelled ${p.label}, but no account of that provider is in the pool; it runs on ${p.provider}, as its project does`,
  'answer.moved': (p: { task: string }) => `answer: the session of ${p.task} has moved on since the question; the answer was not sent`,
  'answer.busy': (p: { task: string }) => `answer: the session of ${p.task} is working; answer once it waits`,
  'answer.empty': () => 'answer: the reply is empty',
  'answer.file': (p: { name: string }) => `answer: the file ${p.name} could not be saved`,
  'chain.queueChanged': (p: { queue: string[] }) => `chain: the queue has changed, it is now ${list(p.queue) || 'empty'}`,
  'chain.currentFirst': (p: { task: string }) => `chain: ${p.task} is running and stays first`,
  'chain.fixReportMissing': (p: { task: string }) => `chain: the report of ${p.task} is gone, so a new session cannot be told what to fix; check main and resume`,
  'chain.interrupted':(p: { task: string }) => `chain: launch of ${p.task} was interrupted by a restart; check its session, then resume`,
  'chain.unchangedNotChecked': (p: { task: string }) =>
    `chain: the session of ${p.task} marked it as needing no change, but its folder could not be checked (answer its session from the chat, or skip the task)`,
  'chain.unchangedNotCompleted': (p: { task: string }) =>
    `chain: ${p.task} needs no change and its branch has nothing to merge, but it was not moved to done in the tracker (move it there yourself and resume the chain, or skip the task)`,
  'chain.notRead': (p: { project: string }) => `chain: the tasks of ${p.project} are not read from the tracker yet; try again once it answers`,
  'chain.empty': (p: { project: string }) => `chain: ${p.project} has no task to run, not started`,
  'chain.emptyNone': () => 'it has no open tasks',
  'chain.emptyStatus': () => 'none of its open tasks is in a status the chain takes',
  'chain.emptyLabels': (p: { labels: string[] }) => `its ready tasks lack a required label (${list(p.labels)})`,
  'chain.emptySkipped': () => 'all its ready tasks are skipped',
  'chain.emptyBlocked': () => 'its ready tasks are skipped or wait for blockers outside the chain',

  'order.notOpen': (p: { task: string }) => `chain: ${p.task} is not an open task of this chain`,
  'order.twice': (p: { task: string }) => `chain: ${p.task} appears twice`,
  'order.blocked': (p: { task: string; blocker: string }) => `chain: ${p.task} cannot go before ${p.blocker}, which blocks it`,
  'order.milestone': (p: { task: string; milestone: string; earlier: string; earlierMilestone: string }) =>
    `chain: ${p.task} in ${p.milestone} cannot go before ${p.earlier} in the earlier ${p.earlierMilestone}`,
  'order.cycle': (p: { path: string }) => `blocker cycle: ${p.path}`,
  'order.later': (p: { task: string; milestone: string; blocker: string; blockerMilestone: string }) =>
    `${p.task} in ${p.milestone} is blocked by ${p.blocker} in the later ${p.blockerMilestone}`,
  'order.against': (p: { path: string }) => `blockers go against the milestone order: ${p.path}`,

  'cleanup.failed': () => 'cleanup failed',
  'cleanup.syncFailed': () => 'sync of the main branch failed',
  'cleanup.folderLeft': (p: { path: string }) => `the worktree folder ${p.path} was left behind, a process still holds it`,
  'cleanup.worktreeKept': (p: { path: string }) => `the worktree ${p.path} was kept`,
  'cleanup.branchKept': (p: { branch: string }) => `the branch ${p.branch} was kept`,
  'cleanup.originUnchecked': (p: { branch: string; remote?: string }) => `could not check the branch ${p.branch} on ${p.remote ?? 'origin'}`,
  'cleanup.originKept': (p: { branch: string; remote?: string }) => `the branch ${p.branch} was kept on ${p.remote ?? 'origin'}`,
  'cleanup.slotDirty': (p: { path: string; branch: string }) => `the slot ${p.path} was kept on ${p.branch}: it has uncommitted changes`,
  'cleanup.slotKept': (p: { path: string; branch: string }) => `the slot ${p.path} was kept on ${p.branch}`,
  'cleanup.sessionNotStopped': (p: { session: string }) => `its session ${p.session} was not stopped`,

  'git.ignoreUnknown': (p: { repo: string; dir: string }) => `git: cannot tell whether ${p.repo} ignores ${p.dir}`,
  'git.failed': (p: { step: GitStep; subject: string; repo: string }) => `git: could not ${GIT_STEPS[p.step](p.subject)} ${p.repo}`,
  'git.noBranch': (p: { project: string; branch: string; repo: string }) =>
    `git: ${p.repo} has no branch ${p.branch}, the main branch of ${p.project}; create it or name the right one in the project's settings`,
  'git.wrongBranch': (p: { project: string; branch: string; current: string | null; repo: string }) =>
    `git: ${p.repo} stands ${p.current === null ? 'on a detached HEAD' : `on ${p.current}`}, not on ${p.branch}, the main branch of ${p.project}; switch it to ${p.branch} or name the right branch in the project's settings`,

  'sync.alias': (p: { exit: number }) => `git sync exited with ${p.exit}`,
  'sync.notMain': (p: { repo: string; branch: string; main: string }) =>
    `sync: ${p.repo} is on ${p.branch || 'a detached HEAD'}, not ${p.main}; switch it to ${p.main}`,
  'sync.fetch': (p: { remote: string }) => `sync: could not fetch ${p.remote}`,
  'sync.merge': (p: { remote: string; main: string }) => `sync: ${p.remote}/${p.main} does not merge cleanly into ${p.main}, merge it by hand`,
  'sync.push': (p: { remote: string; main: string }) => `sync: could not push ${p.main} to ${p.remote}`,

  'forward.busy': (p: { into: string }) => `forward: the chain of ${p.into} is working; the release branch goes in once it is quiet`,
  'forward.notOnBranch': (p: { repo: string; branch: string; current: string }) =>
    `forward: ${p.repo} is on ${p.current || 'a detached HEAD'}, not ${p.branch}; the release branch waits`,
  'forward.dirty': (p: { repo: string }) => `forward: ${p.repo} has uncommitted changes; the release branch waits`,
  'forward.fetch': (p: { from: string }) => `forward: could not fetch the branch of ${p.from}`,
  'forward.conflict': (p: { from: string; into: string; files: string[] }) =>
    `forward: the branch of ${p.from} conflicts with ${p.into} in ${p.files.join(', ') || 'unknown files'}; the merge is aborted and waits for a merge by hand or "Carry now"`,
  'forward.notRelease': (p: { project: string }) => `forward: ${p.project} merges into no other project`,

  'ci.noToken': (p: { variable: string }) => `set ${p.variable} in the environment of Even Keel to watch this CI`,
  'ci.denied': (p: { ci: string; status: number }) => `${p.ci}: the token was refused (HTTP ${p.status}); it needs read access to the repository's actions`,
  'ci.http': (p: { ci: string; status: number }) => `${p.ci}: the API answered HTTP ${p.status}`,
  'ci.unreachable': (p: { ci: string }) => `${p.ci}: the API did not answer`,
  'review.denied': (p: { ci: string; status: number }) => `${p.ci}: the token was refused (HTTP ${p.status}); it needs to write pull requests of the repository`,
  'review.notOpened': (p: { task: string }) => `the pull request of ${p.task} was not opened (answer its session from the chat, or skip the task)`,
  'review.notCompleted': (p: { task: string }) => `${p.task} has nothing to open as a pull request, but it was not moved to done in the tracker (move it there yourself and resume the chain, or skip the task)`,
  'review.notReady': (p: { project: string }) =>
    `PR mode of ${p.project} has nowhere to open pull requests, so its chain starts no task; it goes on by itself within a minute once that is fixed, or turn PR mode off`,
  'review.cannotEnable': (p: { project: string }) => `PR mode of ${p.project} is not turned on`,
  'review.noRemote': (p: { project: string }) => `${p.project} has no remote on GitHub or Forgejo to open a pull request on`,
  'review.noToken': (p: { remote: string; kind: CiKind; web: string }) =>
    `no profile has a token for the remote ${p.remote} (${p.web}); add a ${FORGES[p.kind]} profile for its host`,
  'review.unsupportedHost': (p: { remote: string; host: string }) => `the remote ${p.remote} on ${p.host} is not supported for pull requests: only GitHub and Forgejo are`,
  'review.noNote': (p: { path: string }) => `the session left no pull request description at ${p.path}`,
  'review.noBranch': (p: { path: string }) => `${p.path} is not on a branch`,
  'review.dirty': (p: { path: string }) => `${p.path} has uncommitted changes`,
  'review.nothingAhead': (p: { branch: string; base: string }) => `${p.branch} has no commits beyond ${p.base}`,
  'review.pushFailed': (p: { branch: string; remote: string }) => `could not push ${p.branch} to ${p.remote}`,
  'ci.notTaken': (p: { ci: string; commit: string }) => `${p.ci}: no runner took ${p.commit}`,
  'ci.fixFailed': (p: { task: string; commit: string }) => `CI is red on main at ${p.commit}, the push of the fix ${p.task}; the chain waits for you`,
  'ci.cannotCreate': (p: { commit: string }) => `CI is red on main at ${p.commit}, and the tracker cannot create a task to fix it`,
  'ci.fixNotCreated': (p: { commit: string }) => `CI is red on main at ${p.commit}; the task to fix it was not created`,
  'ci.fixNotStarted': (p: { commit: string }) => `CI is red on main at ${p.commit}; the session to fix it was not started`,
  'check.fixNotStarted': (p: { commit: string }) => `The project's check fails on main at ${p.commit}; the session to fix it was not started`,
  'check.fixFailed': (p: { task: string; commit: string }) => `The project's check fails on main at ${p.commit}, the push of the fix ${p.task}; the chain waits for you`,
  'check.cannotCreate': (p: { commit: string }) => `The project's check fails on main at ${p.commit}, and the tracker cannot create a task to fix it`,
  'check.fixNotCreated': (p: { commit: string }) => `The project's check fails on main at ${p.commit}; the task to fix it was not created`,
  'afterGreen.failed': (p: { command: string; code: number; commit: string }) =>
    `"${p.command}" after the green main at ${p.commit} exited with code ${p.code}; main stays green, the service log has the output`,

  'slot.dirty': (p: { path: string }) => `the slot ${p.path} has uncommitted changes; commit or remove them`,
  'slot.busy': (p: { path: string; sessions: string[] }) => `the slot ${p.path} is in use by ${list(p.sessions)} mid-turn; let it finish or stop it`,
  'slot.noneFree': (p: { task: string }) => `git: no slot is free, ${p.task} was not started; free one, then resume`,
  'slot.waiting': (p: { task: string }) => `no slot is free for ${p.task}; it starts as soon as one is`,
  'slot.busyStart': (p: { slot: string; sessions: string[]; task: string }) =>
    `the slot ${p.slot} is in use by ${list(p.sessions)} mid-turn, ${p.task} was not started; let it finish or stop it, then resume`,
  'slot.stopFailed': (p: { session: string; owner: string; slot: string; task: string }) =>
    `the session ${p.session} of ${p.owner} in the slot ${p.slot} was not stopped, ${p.task} was not started`,

  'setup.failed': (p: { task: string; command: string; code: number }) =>
    `setup: "${p.command}" before the start of ${p.task} exited with code ${p.code}; the session was not started, fix it and resume`,

  'agent.uncheckedVersion': (p: { title: string; installed: string; checked: string }) =>
    `${p.title} ${p.installed} is installed, Even Keel was last checked against ${p.checked}; a part of it may not work until it is adapted`,
  'agent.daemonVersion': (p: { title: string; account: string; running: string; wanted: string }) =>
    `The ${p.title} daemon of ${p.account} runs ${p.running}, not the checked ${p.wanted}: its sessions run on ${p.running} until no session of the account is live, then Even Keel restarts it`,

  'claude.startFailed': (p: { task: string; cwd: string }) => `claude: could not start ${p.task} in ${p.cwd}`,
  'claude.resumeFailed': (p: { task: string; cwd: string }) => `claude: could not resume ${p.task} in ${p.cwd}`,
  'claude.notShown': (p: { task: string }) => `claude: ${p.task} was started but did not show up in claude agents`,
  'claude.resumedNotShown': (p: { task: string }) => `claude: ${p.task} was resumed but did not show up in claude agents`,
  'claude.stopFailed': (p: { agent: string }) => `claude: could not stop ${p.agent}`,
  'claude.stillRunning': (p: { agent: string }) => `claude: ${p.agent} was told to stop but is still running`,
  'claude.signOutFailed': (p: { account: string }) => `claude: could not sign out of ${p.account}`,
  'claude.daemonStopFailed': (p: { account: string }) => `claude: could not stop the daemon of ${p.account}`,
  'claude.statusNotJson': () => 'claude: auth status is not JSON',
  'claude.statusNotObject': () => 'claude: auth status is not an object',
  'claude.statusNoFlag': () => 'claude: auth status has no loggedIn flag',

  'codex.startFailed': (p: { task: string; cwd: string }) => `codex: could not start ${p.task} in ${p.cwd}`,
  'codex.resumeFailed': (p: { task: string; cwd: string }) => `codex: could not resume ${p.task} in ${p.cwd}`,
  'codex.pluginsFailed': (p: { task: string; account: string }) => `codex: could not install the plugins of ${p.task} into ${p.account}`,
  'codex.otherThread': (p: { task: string; asked: string; got: string }) =>
    `codex: ${p.task} was resumed as ${p.asked} but came up as the new thread ${p.got}`,
  'codex.unknownSession': (p: { session: string }) => `codex: Even Keel did not start the session ${p.session}`,
  'codex.stillRunning': (p: { session: string }) => `codex: the turn of ${p.session} was killed but is still running`,
  'codex.statusUnreadable': () => 'codex: login status printed neither "Logged in" nor "Not logged in"',
  'codex.signOutFailed': (p: { account: string }) => `codex: could not sign out of ${p.account}`,

  'account.unknown': (p: { key: string }) => `claude: there is no account ${p.key}`,
  'account.alreadyActive': (p: { key: string }) => `claude: ${p.key} is already active`,
  'account.removing': (p: { account: string }) => `claude: ${p.account} is being removed; keep it first`,
  'account.needsLogin': (p: { account: string }) => `claude: ${p.account} needs a login first`,
  'account.globalKept': () => 'claude: the global account lives in ~/.claude and is not removed from here',
  'account.activeKept': () => 'claude: the active account cannot be removed; switch to another one first',
  'account.sharedPool': () => 'claude: the shared settings name this account in their pool; pick another one there first',
  'account.projectPool': (p: { projects: string[] }) =>
    `claude: the settings of projects ${list(p.projects)} name this account in their pool; pick another one there first`,
  'account.signInRunning': () => 'claude: a sign-in into this account is running',
  'account.usedByApp': (p: { app: string }) => `claude: ${p.app} uses this account; switch it to another one first`,
  'account.codexApp': () => 'codex: the apps run on Claude Code; a Codex account is not given to one',
  'account.codexHomeKept': () => "codex: Codex's own folder (CODEX_HOME or ~/.codex) is not removed from here",
  'account.secondFree': (p: { account: string }) =>
    `codex: ${p.account} is already on the free plan; OpenAI's terms do not allow several free accounts to get round the limits, so add a paid one`,
  'account.extraFree': (p: { account: string }) =>
    `codex: a second free Codex account next to ${p.account}; OpenAI's terms do not allow several free accounts to get round the limits, so sessions do not start here until it is on a paid plan`,
  'account.notRemoving': (p: { key: string }) => `claude: ${p.key} is not being removed`,
  'account.apiKeyInvalid': () => 'claude: an API key is one word of more than 20 characters, like sk-ant-api03-…',
  'account.apiKeyRejected': () => "claude: Anthropic doesn't accept this key: it is wrong, revoked or its organization is disabled",
  'account.apiKeyUnchecked': (p: { reason: string }) => `claude: could not check the key with Anthropic (${p.reason}); try again later`,
  'account.codexKeyInvalid': () => 'codex: an OpenAI API key is one word of more than 20 characters, like sk-proj-…',
  'account.codexKeyRejected': () => "codex: OpenAI doesn't accept this key: it is wrong, revoked or its project is disabled",
  'account.codexKeyUnchecked': (p: { reason: string }) => `codex: could not check the key with OpenAI (${p.reason}); try again later`,
  'account.chainRunning': (p: { project: string }) => `claude: chain ${p.project} is running; stop it before switching the account`,
  'account.sessionsBusy': (p: { sessions: string[] }) =>
    `claude: sessions are in the middle of a turn (${list(p.sessions)}); switch the account once they finish`,
  'account.homeGone': (p: { key: string }) => `claude: the account folder ${p.key} is gone`,
  'account.activeGone': (p: { key: string }) => `claude: the active account folder ${p.key} is gone; switch to another account, then resume`,
  'account.signingIn': () => 'claude: sign-in is in progress; resume once it is done',
  'account.signedOut': () => 'claude: not signed in; sign in from the account menu, then resume',
  'account.loginExpired': (p: { account: string }) => `claude: the login of ${p.account} has run out; renew it from the account menu, then resume`,

  'login.none': () => 'claude: no sign-in is running',
  'login.running': () => 'claude: a sign-in is already running',
  'login.timeout': (p: { minutes: number }) => `claude: sign-in did not finish in ${p.minutes} min`,
  'login.startFailed': () => 'claude: could not start the sign-in',
  'login.codexMissing': () => 'codex: the CLI is not found; install it with npm install -g @openai/codex or name its path in EVEN_KEEL_CODEX_BIN',
  'login.claudeMissing': () => 'claude: the CLI is not found; install it or name its path in EVEN_KEEL_CLAUDE_BIN',
  'login.exited': (p: { code: string }) => `claude: sign-in exited with code ${p.code}`,
  'login.setupFailed': (p: { dir: string }) => `claude: signed in, but could not set up the folder ${p.dir}`,

  'app.unknown': (p: { app: string }) => `claude: there is no app ${p.app}`,
  'app.alreadyUses': (p: { app: string; account: string }) => `claude: ${p.app} already uses ${p.account}`,
  'app.chatsOpen': (p: { app: string; count: number }) =>
    `claude: ${p.app} has ${p.count} Claude ${p.count === 1 ? 'chat' : 'chats'} open; close ${p.count === 1 ? 'it' : 'them'} first`,
  'vscode.noFile': () => 'vscode: the VS Code settings file is only looked for on Windows, macOS and Linux',
  'vscode.notJson': () => 'vscode: settings.json is not plain JSON (comments or trailing commas?); Even Keel does not rewrite it',
  'vscode.notObject': () => 'vscode: settings.json is not a JSON object',

  'usage.notJson': () => 'the answer is not JSON',
  'usage.notObject': () => 'the answer is not a JSON object',
  'usage.turns': (p: { value: string }) => `num_turns is ${p.value}, not 0`,
  'usage.cost': (p: { value: string }) => `total_cost_usd is ${p.value}, not 0`,
  'usage.isError': () => 'the answer is an error',
  'usage.noResult': () => 'the answer has no result text',
  'usage.noLimits': () => 'the subscription answer has no limit lines: the usage service did not answer (rate limit or expired token)',
  'usage.noSession': () => 'no readable "Current session" line',
  'usage.noWeek': () => 'no readable "Current week (all models)" line',
  'usage.callFailed': () => 'the call failed',
  'usage.noRollout': () => 'no Codex session of this account has reported its limits yet',

  'prompt.empty': (p: { before: string; value: string }) => `prompt: nothing to put after "${p.before}" (got ${p.value})`,

  'request.tooLarge': () => 'request body is too large',
  'request.notJson': () => 'request body is not JSON',
  'request.notObject': () => 'request body must be an object',
  'request.required': (p: { field: string }) => `${p.field} is required`,
  'request.taskId': () => 'task must look like ABC-12',
  'request.taskList': () => 'order must be a list of task ids',
  'request.projectList': () => 'order must be a list of projects',

  'task.noTracker': (p: { task: string }) => `no connected tracker serves ${p.task}`,
  'task.cannotReady': (p: { task: string }) => `the tracker of ${p.task} cannot move it to Todo`,
  'task.pastBacklog': (p: { task: string }) => `${p.task} is no longer in a backlog status`,
  'task.cannotMoveMilestone': (p: { task: string }) => `the tracker of ${p.task} cannot change its milestone`,
  'tracker.noProject': (p: { project: string }) => `no connected tracker serves the project ${p.project}`,
  'changelog.cannotList': (p: { project: string }) => `changelog: the tracker of ${p.project} cannot list the tasks of a milestone`,
  'changelog.empty': (p: { milestone: string }) => `changelog: ${p.milestone} has no done task to write a draft from`,
  'changelog.noAgent': (p: { project: string }) => `changelog: the agent of the account ${p.project} runs on cannot write a draft`,
  'changelog.failed': (p: { project: string }) => `changelog: the agent did not write the draft of ${p.project}`,
  'changelog.noDraft': (p: { milestone: string }) => `changelog: ${p.milestone} has no draft yet`,
  'changelog.released': (p: { milestone: string; tag: string }) => `changelog: the section of ${p.milestone} is released as ${p.tag} and is not changed`,
  'changelog.nothingNew': (p: { milestone: string }) => `changelog: every done task of ${p.milestone} is already in the draft`,
  'changelog.notOnBranch': (p: { branch: string; current: string }) =>
    `changelog: the main checkout is on ${p.current || 'a detached HEAD'}, not on ${p.branch}; the changelog is not written`,
  'changelog.dirty': (p: { file: string }) => `changelog: ${p.file} has uncommitted changes in the main checkout; the changelog is not written`,
  'changelog.commitFailed': (p: { file: string }) => `changelog: git could not commit ${p.file}`,

  'config.notJson': (p: { file: string }) => `config: ${p.file} is not JSON`,
  'config.port': (p: { value: string }) => `config: EVEN_KEEL_PORT must be an integer in 1..65535, got ${p.value}`,
  'server.rebindFailed': (p: { address: string; current: string }) => `server: cannot listen on ${p.address} from .env, staying on ${p.current}`,
  'config.mcpPort': (p: { value: string }) => `config: EVEN_KEEL_MCP_PORT must be an integer in 1..65535, got ${p.value}`,
  'config.branch': (p: { where: string; value: string }) => `config: ${p.where} must be a branch name, got ${p.value}`,
  'config.changelogPath': (p: { where: string; value: string }) =>
    `config: ${p.where} must be a file path inside the repository, got ${p.value}`,
  'config.projects': () => 'config: projects must be a list of project records',
  'config.projectEntry': (p: { where: string }) => `config: ${p.where} must be an object with the project's id, key and repo`,
  'config.projectKey': (p: { where: string; value: string }) =>
    `config: ${p.where} must be a project key (a capital letter, then up to 4 capitals, digits or _), not ${p.value}`,
  'config.projectId': (p: { where: string }) => `config: ${p.where} must be the project's id; Even Keel writes one into an entry that has none`,
  'config.projectTwice': (p: { field: string; value: string; first: string; second: string }) =>
    `config: the ${p.field} ${p.value} is given twice, at ${p.first} and at ${p.second}`,
  'config.version': (p: { value: string }) => `config: version must be a whole number, not ${p.value}`,
  'storage.newer': (p: { file: string; version: number; known: number }) =>
    `storage: ${p.file} is from a newer version of Even Keel (schema ${p.version}, this one knows up to ${p.known}); ` +
    'put back its *.bak copy or update Even Keel',
  'storage.damaged': (p: { file: string }) => `storage: ${p.file} cannot be read, so nothing was migrated`,
  'storage.unknownProject': (p: { file: string; project: string }) =>
    `storage: ${p.file} names the project ${p.project}, which the config does not have, so nothing was migrated`,
  'storage.writeFailed': (p: { file: string }) => `storage: could not write ${p.file}; the files written before it are put back from their copies`,
  'storage.newerDatabase': (p: { file: string; version: number; known: number }) =>
    `storage: the database ${p.file} is from a newer version of Even Keel (schema ${p.version}, this one knows up to ${p.known}); update Even Keel`,
  'storage.importFailed': (p: { file: string }) => `storage: could not move the state files into ${p.file}; no database was made and the files are as they were`,
  'packages.unknown': (p: { name: string }) => `packages: there is no package ${p.name}`,
  'packages.exists': (p: { name: string }) => `packages: ${p.name} is already in the catalog`,
  'packages.busy': (p: { name: string }) => `packages: ${p.name} is being installed; wait until it is done`,
  'packages.noMarketplace': (p: { marketplace: string }) => `packages: Claude Code knows no marketplace ${p.marketplace}`,
  'packages.noPlugin': (p: { plugin: string; marketplace: string }) => `packages: the marketplace ${p.marketplace} has no plugin ${p.plugin}`,
  'packages.installInClaude': (p: { plugin: string }) =>
    `packages: ${p.plugin} comes from outside its marketplace's folder; install it in Claude Code first (claude plugin install ${p.plugin}), then here`,
  'packages.copyFailed': (p: { name: string }) => `packages: could not copy the plugin ${p.name}`,
  'packages.npmFailed': (p: { spec: string }) => `packages: npm could not install ${p.spec}`,
  'packages.marketplaceUpdate': (p: { marketplace: string }) => `packages: claude plugin marketplace update ${p.marketplace} failed`,
  'packages.marketplaceAdd': (p: { marketplace: string }) => `packages: claude plugin marketplace add could not add ${p.marketplace}`,
  'packages.noOwnMarketplace': (p: { dir: string }) => `packages: ${p.dir} has no .claude-plugin/marketplace.json`,
  'packages.upToDate': (p: { name: string }) => `packages: ${p.name} is already the latest version`,
  'packages.updated': (p: { name: string; version: string }) => `packages: ${p.name} is updated to ${p.version}; running tasks stay on the version they started with`,
  'packages.badServer': (p: { name: string }) => `packages: the server ${p.name} needs either a command or a url`,
  'packages.badName': (p: { name: string }) => `packages: ${p.name} is not a name for a server: letters, digits, - and _ only`,
  'packages.keyName': (p: { name: string }) => `packages: ${p.name} is not a variable name`,
  'packages.keyValue': (p: { name: string }) => `packages: the value of ${p.name} may hold neither a line break nor a single quote`,
  'packages.unknownKey': (p: { name: string }) => `packages: no package or tracker reads ${p.name}`,
  'packages.port': (p: { port: number }) => `packages: the MCP gateway cannot listen on 127.0.0.1:${p.port}; set another EVEN_KEEL_MCP_PORT`,
  'secrets.unknown': (p: { name: string }) => `secrets: ${p.name} is not a credential the page sets`,
  'secrets.empty': (p: { name: string }) => `secrets: the value of ${p.name} is empty; removing a variable is its own action`,
  'secrets.outer': (p: { name: string }) => `secrets: ${p.name} comes from the service's environment, not .env; change it there`,
  'secrets.tokenRequired': () => 'secrets: EVEN_KEEL_TOKEN stays while the service listens beyond loopback (EVEN_KEEL_HOST)',
  'secrets.settingsJson': () => 'secrets: the global settings.json is not a plain JSON object; Even Keel does not rewrite it',
  'tally.mode': (p: { value: string }) => `stats: "${p.value}" is not a place for the stats; it is off, local or server`,
  'tally.incomplete': (p: { names: string }) => `stats: your own Postgres needs ${p.names}`,
  'tally.port': (p: { value: string }) => `stats: the port ${p.value} is not a number from 1 to 65535`,
  'tally.unreachable': (p: { role: string; address: string }) => `stats: ${p.address} did not let ${p.role} in`,
  'profiles.unknownKind': (p: { kind: string }) => `profiles: there is no tracker "${p.kind}"`,
  'profiles.unknown': () => 'profiles: there is no such profile; the page may be out of date',
  'profiles.incomplete': (p: { tracker: string }) => `profiles: the ${p.tracker} fields are not filled in full`,
  'profiles.refused': (p: { tracker: string }) => `profiles: ${p.tracker} refused the credentials`,
  'profiles.unreachable': (p: { tracker: string }) => `profiles: ${p.tracker} did not answer`,
  'profiles.hostLocked': (p: { profile: string; projects: string }) =>
    `profiles: ${p.profile} is used by ${p.projects}; its address and workspace stay, only the credentials change`,
  'profiles.inUse': (p: { profile: string; projects: string }) => `profiles: ${p.profile} is used by ${p.projects}; it cannot be removed`,
  'profiles.otherTracker': (p: { profile: string; project: string }) => `profiles: ${p.profile} is a profile of another tracker than ${p.project}'s`,
  'profiles.paused': (p: { profile: string; project: string }) =>
    `${p.project}: the chain waits: the tracker refused the credentials of the profile ${p.profile}; renew them in Settings → Access`,
  'config.repoEmpty': (p: { key: string }) => `config: repository path for ${p.key} is empty`,
  'config.slot': (p: { key: string }) => `config: ${p.key}.slot must be true, false or the number of slots`,
  'config.color': (p: { key: string }) => `config: ${p.key}.color must be a whole number from 1 to 8`,
  'config.language': (p: { where: string; value: string; known: string[] }) =>
    `config: ${p.where}: there is no language ${p.value}, known: ${list(p.known)}`,
  'config.trackerName': (p: { where: string }) => `config: ${p.where} must be the name of a tracker adapter`,
  'config.brief': (p: { where: string }) => `config: ${p.where} must be true or false`,
  'config.briefValue': (p: { where: string }) => `config: ${p.where} must be true, false or null`,
  'config.trackerUnknown': (p: { where: string; name: string; known: string[] }) =>
    `config: ${p.where}: there is no tracker "${p.name}", known: ${list(p.known)}`,
  'config.trackerProject': (p: { where: string; example: string }) =>
    `config: ${p.where} must name the project in its tracker, like "${p.example}"`,
  'config.notObject': (p: { where: string }) => `config: ${p.where} must be an object`,
  'config.ruleKey': (p: { where: string; key: string }) => `config: ${p.where}.${p.key} is not a chain rule`,
  'config.ruleList': (p: { where: string; key: string }) => `config: ${p.where}.${p.key} must be a list of non-empty names`,
  'config.projectPrompt': (p: { where: string }) => `config: ${p.where} must be text`,
  'config.projectName': (p: { where: string }) => `config: ${p.where} must be text`,
  'config.provider': (p: { where: string; value: string; known: string[] }) => `config: ${p.where}: there is no provider ${p.value}, known: ${list(p.known)}`,
  'config.providerKey': (p: { where: string; key: string; known: string[] }) => `config: ${p.where}.${p.key} is not a provider, known: ${list(p.known)}`,
  'config.providerName': (p: { where: string }) => `config: ${p.where} must be text`,
  'config.execution': (p: { provider: string; value: string; known: string[] }) =>
    `config: execution.${p.provider}: there is no mode ${p.value}, known: ${list(p.known)}`,
  'config.cli': (p: { provider: string; value: string; known: string[] }) =>
    `config: cli.${p.provider}: there is no choice ${p.value}, known: ${list(p.known)}`,
  'config.trackerLocked': (p: { key: string }) =>
    `config: the chain has started tasks of ${p.key}, so its tracker is not switched from the page; that comes in v0.2`,
  'config.commandKey': (p: { where: string; key: string; known: string[] }) =>
    `config: ${p.where}.${p.key} is not a kind of commands, known: ${list(p.known)}`,
  'config.commandList': (p: { where: string }) => `config: ${p.where} must be a list of commands`,
  'config.ciKey': (p: { where: string; key: string; known: string[] }) => `config: ${p.where}.${p.key} is not a CI setting, known: ${list(p.known)}`,
  'config.ciKinds':(p: { where: string; known: string[] }) => `config: ${p.where} must be a list of CIs, known: ${list(p.known)}`,
  'config.ciWait': (p: { where: string }) => `config: ${p.where} must be a whole number of minutes, 0 or more, or null`,
  'config.remoteProfiles': (p: { where: string; known: string[] }) =>
    `config: ${p.where} must map a remote's kind (${list(p.known)}) to a profile's id`,
  'config.unknownProject': (p: { key: string }) => `config: there is no project ${p.key}`,
  'config.writeFailed': (p: { file: string }) => `config: could not write ${p.file}`,
  'config.statusBoth': (p: { project: string; status: string }) => `config: ${p.project}: status "${p.status}" is both active and terminal`,
  'config.labelBoth': (p: { project: string; label: string }) => `config: ${p.project}: label "${p.label}" is both required and excluded`,
  'config.milestoneBoth': (p: { project: string; milestone: string }) => `config: ${p.project}: milestone "${p.milestone}" is both required and excluded`,
  'config.trackerProjectShared': (p: { project: string; other: string; trackerProject: string }) =>
    `config: ${p.project} and ${p.other} read the tracker project ${p.trackerProject}, and a task may enter both chains: split them by milestone (chain.requiredMilestones and chain.excludedMilestones)`,
  'config.modelPrompts': () => 'config: modelPrompts must map the name of a model to a prompt',
  'config.modelPromptEmpty': (p: { model: string }) => `config: modelPrompts.${p.model} is empty`,
  'config.hiddenSkills': () => 'config: hiddenSkills must be a list of skill names',
  'config.cacheTtl': (p: { value: string }) => `config: cacheTtl ${p.value} must be "5m" or "1h", or left out`,
  'config.parallel': (p: { value: string }) => `config: parallel must be a positive integer, got ${p.value}`,
  'config.mergeInto': (p: { project: string; into: string }) =>
    `config: ${p.project}.mergeInto names ${p.into}, which is not another project or merges into one itself`,
  'config.mergeIntoValue': (p: { where: string }) => `config: ${p.where} must be a project key or null`,
  'config.allowedHosts': () => 'config: allowedHosts must be a list of host names',
  'config.updatesKey': (p: { key: string; known: string[] }) => `config: updates.${p.key} is not an update setting, known: ${list(p.known)}`,
  'config.updatesDismissed': (p: { value: string }) => `config: updates.dismissed must be a version such as 0.2.0, or null, got ${p.value}`,
  'updates.running': () => 'updates: an update is already under way',
  'updates.none': () => 'updates: there is no newer release to update to',
  'updates.noPrevious': () => 'updates: there is no previous version to go back to',
  'updates.blocked': (p: { reason: UpdateBlock | 'storage' }) => `updates: ${UPDATE_BLOCKS[p.reason]}`,
  'config.token': (p: { host: string }) =>
    `config: host ${p.host} is reachable from the network, so the page needs a token: set EVEN_KEEL_TOKEN in .env ` +
    `(16+ characters, e.g. the output of: node -e "console.log(crypto.randomBytes(24).toString('hex'))") and restart, ` +
    'or set host to 127.0.0.1',
  'config.tokenShape': () => 'config: EVEN_KEEL_TOKEN must be 16+ characters of A-Z a-z 0-9 . _ ~ + / = -',
  'config.modelPromptPlaceholder': (p: { model: string; placeholder: string }) =>
    `config: modelPrompts.${p.model} has the substitution ${p.placeholder}, but a model prompt is passed on as it is`,
  'config.contextWindow': (p: { value: string }) => `config: context.window must be a positive integer of tokens, got ${p.value}`,
  'config.contextPercents': () => 'config: context.warn and context.danger must be percents with 0 < warn < danger <= 100',
  'config.compareKey': (p: { key: string }) => `config: stats.compare.${p.key} is not a comparison setting`,
  'config.compareValue': (p: { key: string; limit: number; value: string }) =>
    `config: stats.compare.${p.key} must be an integer in 1..${p.limit}, got ${p.value}`,
  'config.statsMove': (p: { from: string }) => `config: stats.moves needs a non-empty old and new folder, got "${p.from}"`,
  'config.otherBelow': (p: { value: string }) => `config: stats.otherBelow must be a number of dollars from 0, got ${p.value}`,
  'config.checkpointTokens': (p: { from: number; value: string }) =>
    `config: stats.checkpointTokens must be an integer number of tokens from ${p.from}, or null, got ${p.value}`,
  'config.checkpointShare': (p: { where: string; value: string }) => `config: ${p.where} must be a whole percent of the context window, 1 to 100, got ${p.value}`,
  'config.checkpointShareKey': (p: { where: string; key: string; known: string[] }) =>
    `config: ${p.where}.${p.key} is not a checkpoint share, known: ${list(p.known)}`,
  'config.checkpointShareOrder': (p: { where: string; first: number; late: number; hard: number }) =>
    `config: ${p.where} must go first < late < hard, got ${p.first}, ${p.late}, ${p.hard}`,
  'wizard.notRepo': (p: { path: string }) => `${p.path} is not in a git repository`,
  'wizard.repoTaken': (p: { project: string }) => `this repository is already the project ${p.project}`,
  'wizard.noBranch': (p: { branch: string; branches: string[] }) => `the repository has no branch ${p.branch}, it has ${p.branches.join(', ')}`,
  'wizard.noCommits': () => 'the repository has no commits yet: make the first one',
  'wizard.trackerOff': (p: { tracker: string; variables: string[] }) =>
    `no ${p.tracker} profile with ${list(p.variables)}: add one with "Add profile" in the Profile list`,
  'wizard.trackerFailed': (p: { tracker: string }) => `${p.tracker} did not give the project's tasks`,
  'project.removeBlocked': (p: { project: string }) => `${p.project} is not removed, it is still in use`,
  'project.removeChain': () => 'its chain runs or waits in the queue; stop it first',
  'project.removeSessions': (p: { sessions: string[] }) => `live sessions: ${list(p.sessions)}`,
  'project.removePlaces': (p: { tasks: string[] }) => `the chain holds the worktree or slot of ${list(p.tasks)}`,
  'project.removeLeftovers': (p: { tasks: string[] }) => `the cleanup after Done left the place of ${list(p.tasks)}`,
}
