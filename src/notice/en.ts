export type GitStep = 'excludeFile' | 'addWorktree' | 'listRemotes' | 'listWorktrees' | 'listBranches' | 'readStatus' | 'addSlot' | 'clean' | 'switch'

const list = (items: string[]) => items.join(', ')

const GIT_STEPS: Record<GitStep, (subject: string) => string> = {
  excludeFile: () => 'find the exclude file of',
  addWorktree: (task) => `add the worktree of ${task} to`,
  listRemotes: () => 'list the remotes of',
  listWorktrees: () => 'list the worktrees of',
  listBranches: () => 'list the branches of',
  readStatus: () => 'read the status of',
  addSlot: () => 'add the slot to',
  clean: () => 'clean',
  switch: (branch) => `switch to ${branch} in`,
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
  'answer.moved': (p: { task: string }) => `answer: the session of ${p.task} has moved on since the question; the answer was not sent`,
  'answer.busy': (p: { task: string }) => `answer: the session of ${p.task} is working; answer once it waits`,
  'answer.empty': () => 'answer: the reply is empty',
  'answer.file': (p: { name: string }) => `answer: the file ${p.name} could not be saved`,
  'chain.queueChanged': (p: { queue: string[] }) => `chain: the queue has changed, it is now ${list(p.queue) || 'empty'}`,
  'chain.currentFirst': (p: { task: string }) => `chain: ${p.task} is running and stays first`,
  'chain.fixReportMissing': (p: { task: string }) => `chain: the report of ${p.task} is gone, so a new session cannot be told what to fix; check main and resume`,
  'chain.interrupted':(p: { task: string }) => `chain: launch of ${p.task} was interrupted by a restart; check its session, then resume`,
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

  'cleanup.failed': () => 'cleanup failed',
  'cleanup.syncFailed': () => 'sync of the main branch failed',
  'cleanup.folderLeft': (p: { path: string }) => `the worktree folder ${p.path} was left behind, a process still holds it`,
  'cleanup.worktreeKept': (p: { path: string }) => `the worktree ${p.path} was kept`,
  'cleanup.branchKept': (p: { branch: string }) => `the branch ${p.branch} was kept`,
  'cleanup.originUnchecked': (p: { branch: string }) => `could not check the branch ${p.branch} on origin`,
  'cleanup.originKept': (p: { branch: string }) => `the branch ${p.branch} was kept on origin`,
  'cleanup.slotDirty': (p: { path: string; branch: string }) => `the slot ${p.path} was kept on ${p.branch}: it has uncommitted changes`,
  'cleanup.slotKept': (p: { path: string; branch: string }) => `the slot ${p.path} was kept on ${p.branch}`,
  'cleanup.sessionNotStopped': (p: { session: string }) => `its session ${p.session} was not stopped`,

  'git.ignoreUnknown': (p: { repo: string; dir: string }) => `git: cannot tell whether ${p.repo} ignores ${p.dir}`,
  'git.failed': (p: { step: GitStep; subject: string; repo: string }) => `git: could not ${GIT_STEPS[p.step](p.subject)} ${p.repo}`,
  'git.noBranch': (p: { project: string; branch: string; repo: string }) =>
    `git: ${p.repo} has no branch ${p.branch}, the main branch of ${p.project}; create it or name the right one in the project's settings`,

  'sync.alias': (p: { exit: number }) => `git sync exited with ${p.exit}`,
  'sync.notMain': (p: { repo: string; branch: string; main: string }) =>
    `sync: ${p.repo} is on ${p.branch || 'a detached HEAD'}, not ${p.main}; switch it to ${p.main}`,
  'sync.fetch': (p: { remote: string }) => `sync: could not fetch ${p.remote}`,
  'sync.merge': (p: { remote: string; main: string }) => `sync: ${p.remote}/${p.main} does not merge cleanly into ${p.main}, merge it by hand`,
  'sync.push': (p: { remote: string; main: string }) => `sync: could not push ${p.main} to ${p.remote}`,

  'ci.noToken': (p: { variable: string }) => `set ${p.variable} in the environment of Even Keel to watch this CI`,
  'ci.denied': (p: { ci: string; status: number }) => `${p.ci}: the token was refused (HTTP ${p.status}); it needs read access to the repository's actions`,
  'ci.http': (p: { ci: string; status: number }) => `${p.ci}: the API answered HTTP ${p.status}`,
  'ci.unreachable': (p: { ci: string }) => `${p.ci}: the API did not answer`,
  'ci.notTaken': (p: { ci: string; commit: string }) => `${p.ci}: no runner took ${p.commit}`,
  'ci.fixFailed': (p: { task: string; commit: string }) => `CI is red on main at ${p.commit}, the push of the fix ${p.task}; the chain waits for you`,
  'ci.cannotCreate': (p: { commit: string }) => `CI is red on main at ${p.commit}, and the tracker cannot create a task to fix it`,
  'ci.fixNotCreated': (p: { commit: string }) => `CI is red on main at ${p.commit}; the task to fix it was not created`,
  'ci.fixNotStarted': (p: { commit: string }) => `CI is red on main at ${p.commit}; the session to fix it was not started`,
  'check.fixNotStarted': (p: { commit: string }) => `The project's check fails on main at ${p.commit}; the session to fix it was not started`,
  'check.fixFailed': (p: { task: string; commit: string }) => `The project's check fails on main at ${p.commit}, the push of the fix ${p.task}; the chain waits for you`,
  'check.cannotCreate': (p: { commit: string }) => `The project's check fails on main at ${p.commit}, and the tracker cannot create a task to fix it`,
  'check.fixNotCreated': (p: { commit: string }) => `The project's check fails on main at ${p.commit}; the task to fix it was not created`,

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

  'claude.startFailed': (p: { task: string; cwd: string }) => `claude: could not start ${p.task} in ${p.cwd}`,
  'claude.resumeFailed': (p: { task: string; cwd: string }) => `claude: could not resume ${p.task} in ${p.cwd}`,
  'claude.notShown': (p: { task: string }) => `claude: ${p.task} was started but did not show up in claude agents`,
  'claude.resumedNotShown': (p: { task: string }) => `claude: ${p.task} was resumed but did not show up in claude agents`,
  'claude.stopFailed': (p: { agent: string }) => `claude: could not stop ${p.agent}`,
  'claude.stillRunning': (p: { agent: string }) => `claude: ${p.agent} was told to stop but is still running`,
  'claude.signOutFailed': (p: { account: string }) => `claude: could not sign out of ${p.account}`,
  'claude.globalDaemon': () => 'claude: the global daemon is not stopped from here',
  'claude.daemonStopFailed': (p: { account: string }) => `claude: could not stop the daemon of ${p.account}`,
  'claude.statusNotJson': () => 'claude: auth status is not JSON',
  'claude.statusNotObject': () => 'claude: auth status is not an object',
  'claude.statusNoFlag': () => 'claude: auth status has no loggedIn flag',

  'account.unknown': (p: { key: string }) => `claude: there is no account ${p.key}`,
  'account.alreadyActive': (p: { key: string }) => `claude: ${p.key} is already active`,
  'account.removing': (p: { account: string }) => `claude: ${p.account} is being removed; keep it first`,
  'account.needsLogin': (p: { account: string }) => `claude: ${p.account} needs a login first`,
  'account.globalKept': () => 'claude: the global account lives in ~/.claude and is not removed from here',
  'account.activeKept': () => 'claude: the active account cannot be removed; switch to another one first',
  'account.signInRunning': () => 'claude: a sign-in into this account is running',
  'account.usedByApp': (p: { app: string }) => `claude: ${p.app} uses this account; switch it to another one first`,
  'account.notRemoving': (p: { key: string }) => `claude: ${p.key} is not being removed`,
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
  'login.exited': (p: { code: string }) => `claude: sign-in exited with code ${p.code}`,
  'login.setupFailed': (p: { dir: string }) => `claude: signed in, but could not set up the folder ${p.dir}`,

  'app.unknown': (p: { app: string }) => `claude: there is no app ${p.app}`,
  'app.alreadyUses': (p: { app: string; account: string }) => `claude: ${p.app} already uses ${p.account}`,
  'app.chatsOpen': (p: { app: string; chats: string[] }) => `claude: ${p.app} has Claude chats open (${list(p.chats)}); close them first`,
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

  'config.notJson': (p: { file: string }) => `config: ${p.file} is not JSON`,
  'config.port': (p: { value: string }) => `config: EVEN_KEEL_PORT must be an integer in 1..65535, got ${p.value}`,
  'config.branch': (p: { where: string; value: string }) => `config: ${p.where} must be a branch name, got ${p.value}`,
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
  'config.repoEmpty': (p: { key: string }) => `config: repository path for ${p.key} is empty`,
  'config.slot': (p: { key: string }) => `config: ${p.key}.slot must be true, false or the number of slots`,
  'config.language': (p: { where: string; value: string; known: string[] }) =>
    `config: ${p.where}: there is no language ${p.value}, known: ${list(p.known)}`,
  'config.trackerName': (p: { where: string }) => `config: ${p.where} must be the name of a tracker adapter`,
  'config.brief': (p: { where: string }) => `config: ${p.where} must be true or false`,
  'config.trackerUnknown': (p: { where: string; name: string; known: string[] }) =>
    `config: ${p.where}: there is no tracker "${p.name}", known: ${list(p.known)}`,
  'config.trackerProject': (p: { where: string; example: string }) =>
    `config: ${p.where} must name the project in its tracker, like "${p.example}"`,
  'config.notObject': (p: { where: string }) => `config: ${p.where} must be an object`,
  'config.ruleKey': (p: { where: string; key: string }) => `config: ${p.where}.${p.key} is not a chain rule`,
  'config.ruleList': (p: { where: string; key: string }) => `config: ${p.where}.${p.key} must be a list of non-empty names`,
  'config.projectPrompt': (p: { where: string }) => `config: ${p.where} must be text`,
  'config.projectName': (p: { where: string }) => `config: ${p.where} must be text`,
  'config.trackerLocked': (p: { key: string }) =>
    `config: the chain has started tasks of ${p.key}, so its tracker is not switched from the page; that comes in v0.2`,
  'config.commandKey': (p: { where: string; key: string; known: string[] }) =>
    `config: ${p.where}.${p.key} is not a kind of commands, known: ${list(p.known)}`,
  'config.commandList': (p: { where: string }) => `config: ${p.where} must be a list of commands`,
  'config.ciKey': (p: { where: string; key: string; known: string[] }) => `config: ${p.where}.${p.key} is not a CI setting, known: ${list(p.known)}`,
  'config.ciKinds':(p: { where: string; known: string[] }) => `config: ${p.where} must be a list of CIs, known: ${list(p.known)}`,
  'config.ciWait': (p: { where: string }) => `config: ${p.where} must be a whole number of minutes, 0 or more, or null`,
  'config.unknownProject': (p: { key: string }) => `config: there is no project ${p.key}`,
  'config.writeFailed': (p: { file: string }) => `config: could not write ${p.file}`,
  'config.statusBoth': (p: { project: string; status: string }) => `config: ${p.project}: status "${p.status}" is both active and terminal`,
  'config.labelBoth': (p: { project: string; label: string }) => `config: ${p.project}: label "${p.label}" is both required and excluded`,
  'config.model': (p: { value: string; known: string[] }) => `config: model ${p.value} is not a model alias, known: ${list(p.known)}`,
  'config.modelPrompts': () => 'config: modelPrompts must map a model alias to a prompt',
  'config.modelAlias': (p: { model: string }) => `config: modelPrompts.${p.model} is not a model alias`,
  'config.modelPromptEmpty': (p: { model: string }) => `config: modelPrompts.${p.model} is empty`,
  'config.hiddenSkills': () => 'config: hiddenSkills must be a list of skill names',
  'config.parallel': (p: { value: string }) => `config: parallel must be a positive integer, got ${p.value}`,
  'config.allowedHosts': () => 'config: allowedHosts must be a list of host names',
  'config.updatesKey': (p: { key: string; known: string[] }) => `config: updates.${p.key} is not an update setting, known: ${list(p.known)}`,
  'config.updatesDismissed': (p: { value: string }) => `config: updates.dismissed must be a version such as 0.2.0, or null, got ${p.value}`,
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
}
