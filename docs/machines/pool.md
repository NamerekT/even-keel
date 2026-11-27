# The mirror and the pool

The hub's mirror of a machine's state, tasks sent to machines, the pool, a task pinned to machines, a limit passed. The words (lane, pool, mirror, catch-up) are in the index's table, [`docs/machines.md`](../machines.md).

## The mirror

The snapshot members of the port read `MachineFacts` (`src/machine/facts.ts`, which lists them): values the machine computes with its local port for every key the chain may ask about — per task with a session (`live`, `busy`, `limited`…), per project (packages, the tracker's server, check reports) and per run, the project's default and each task whose run differs (`account`, `launchBlock`, `limitReset`, the model…). Three reads are not facts: `accountAt` and `limitReopenedAt` take a free time, so the hub computes them from the posted account ledger and limits; `limitResetAfter` has side effects on the machine, so it is a table by the sessions a limit stopped. `lastSession` is the hub's own launch journal.

- **The snapshot** of every connection replaces the mirror whole (`{boot, rev, facts}`: `boot` names the machine's process, `rev` grows with each post). Between snapshots the event `facts` carries the entries that changed (`patchOf`, `applyPatch`); one from another `boot` or not newer than the mirror is dropped.
- **The page's task folders** (BTN-1246): `works` is `TaskWorks.view` by project and task, `diffs` the lines of each task's branch (`TaskWorks.diffs`, BTN-1424), `gitFound` the repositories found in projects without git; the machine reads its folders on its own clock (`assemblePollWorks`, a project once the brief lists its tasks) and the page's state reads both from the mirror.
- **Whose packages hold a launch.** `packagesBlocked` and `packagesPause` of a task are asked of the machine its lane went to (`machinePool`, BTN-1475), not of the own one: the own machine's packages of a project it does not run may be unready or failing (a server that is not set up here), and that would hold the other machine's lane for good. The page reads the own machine's packages from the state's `packages`, so for a lane elsewhere the chain writes what holds it into the lane (`ActiveChain.packagesWait`, BTN-1524): `packagesHeld` of the pool names the machine and gives its gateway and the enabled packages with their problems (`Packages.held`, the facts' `packagesHeld`); a machine older than the field only says it is held, and the page names the machine alone.

### The page's sessions and chat

- **The sections.** `sessions` and `mailbox`, keyed by session id: each session carries its `SessionView`, including its current action and feed; each mailbox its messages and the listens/steers flags. Changes and removals go in the same patches as the chain's facts, and a reconnect replaces both sections. These live views stay in memory; the kept session windows and chat messages go as records ("Journal, session records and chat", `seam.md`).
- **Broadcast.** The hub broadcasts a changed mirror, and the local monitor and mailbox publish on change as well as at the regular catch-up points.
- **Every mirror's sessions.** The page's state takes the sessions of every mirror, the own machine's first and then each machine elsewhere's (`LinkedMachine.sessions`, `allSessions` in `src/machine/page.ts`, BTN-1314): `sessions`, the runs' accounts, agents and compactions in `taskSessions` (an ended session's agent is its account folder's, since one e-mail may be signed in to two agents, BTN-1341), the tray's questions and the checkpoint's window. A session two mirrors show is the first one's. So a task a machine elsewhere runs leaves its start ("loading") at the first transcript line that machine posts, its row shows the session's lamp and its panel the session, as on the hub (`dev:fake` `?chain=elsewhere`).
- **The chat** reads them the same way (BTN-1633): the page's `mailbox`, and a reply's `listens`, `steering` and `liveView` (also the hub's `settleMail`), so a session elsewhere mid-turn takes a message as one of the hub's. Its hooks ask the hub's page for mail ("Hooks through the hub", `link.md`), so `withHubMail` lays the hub's own mailbox over each session elsewhere — its hooks' ask and the messages waiting there — beside what its machine tells (its pins, its inbox, the messages told there).
- **A reply's commands** go by the session's machine (`LinkedMachine.chatOf`, `elsewhereChat`): the steer, the inbox and the files on a machine elsewhere on the link, the mailbox rows (post, give back, dismiss) on the hub; off the link, the own machine's.

### The page's accounts

BTN-1220.

- **The sections.** `panel` is the accounts panel (`AccountWatcher.view` with `missing` read with it), posted whole when anything in it changed; `usage` is by account folder beside `limits`; `owners` gives, for each session of the launch journal and each live agent, its account folder (the agent's, else the transcript's, `TranscriptOwners`); `compactions` the compactions counted in a transcript.
- **Who reads them.** The hub reads all of them, and the sessions and the mailbox, through `PageReads` (`src/machine/page.ts`, `RemoteMachine.page`): `wireGetState` and the tray, the built-in tracker's and the tasks server's "is a session live" and the replies from the page (`createChat`: `liveView`, `midTurn`, `steering`) of every machine's mirror (`LinkedMachine.sessions`, BTN-1633).
- **Posted at once.** A change the machine's watchers see — accounts, limits, transcripts' owners, a CLI copy, a login block — has the machine post at once (`machineChanged` in `src/service.ts`), so the page does not wait for `PUBLISH_EVERY_MS`.
- **Settling stays local.** The mailbox's own settling (`settleMail`, `machineLive`) stays on the machine's reads: it runs right after the monitor's read, before the mirror has it.

### Freshness

- **Every machine** posts its facts before every `command.done`, so the mirror is never older than a result the chain acts on, and every `PUBLISH_EVERY_MS` (5 s), and at once on a change it was told of ("Which posts read").
- **The own machine** also posts before every step of the chain, every command and query of the page (`ServerDeps.catchUp`) and every reply to a session from the page, a tracker or the mailbox (`createChat`): `MachinePort.catchUp` has the machine post what changed and waits until the hub took it, so each reads the machine as it is now. A new entry point that reads the port outside a step catches up first. So do Start and Resume themselves (`assembleStartChain`, `assembleChainControl`, BTN-1550): they admit a chain by the mirror's launch block at once, and callers past the page's route — the first run's demo right after it refreshes the accounts, the e2e harness — found the accounts told within the settle window not there yet (`account.activeGone`). Without a connection `catchUp` does not wait.
- **A machine elsewhere** is not caught up with (`machinePool`'s `catchUp` is the own machine's): its mirror is as fresh as its last post, so a step never waits on the network.

### Which posts read

BTN-1475. A read of the facts is costly ("The cost of the facts"), so a post reads them only when something may have changed.

- **A command that changes something** (`launch`, a move, `account.*`, `chat.*`…) always reads the facts before its result.
- **A change told outside a command** (`MachineTell.changed`: the session monitor, the limits, the accounts, the packages) is `MachineRunner.changed`: posted at once when the last read began `SETTLE_MS` (250 ms) ago or earlier, otherwise once that window is up, in one read for everything told by then.
- **The own machine's catch-up** before a step and a query (`MachinePort`'s queries, `transcript.*`) goes through `MachineRunner.refresh`, which reads only after a change told or once the last read is `FRESH_MS` (1 s) old; otherwise it waits for the post under way. So a fact that changes without telling (a time passing) reaches the mirror within a second of the next step, or at once with the next command that changes something. Otherwise every post would wake a step whose catch-up read the facts again.
- **A command of the page and a chat reply** catch up whole (`catchUp(true)`, `publish`): the user's next look must see what the command did.

### The cost of the facts

The facts are computed several times a second (every step catches up), each time for every project and every task with its own run, so a read in them must not search the disk or scan a list per call: without the rules below one computation took the whole event loop, and the page's requests and the gateway's probes timed out.

- **One scope per computation** (`RunnerDeps.scope`): the accounts view is built once for it (`AccountWatcher.batch`, which otherwise builds it on every read, reading every folder's files) and the tasks with a session are grouped by project once. A launch's check of the CLI copy reads `cliCopy.state`, not `view`, which looks for the system binary.
- **One choice per run.** The scope computes each `choiceFor` once (`ChoiceFor.pass`, BTN-1223): a run's six members ask for it, and an OpenCode choice reads its folder's `auth.json`, which `readAuth` keeps while the file's size and time stay (BTN-1475).
- **Shared posts.** Posts asked while one waits for its turn share it (`MachineRunner.publish`): its read has not begun, so each caller still gets the machine as it is after its call. `patchOf` compares entries with `sameJson`, not by writing both out as JSON.
- **Per task, without a scan** (BTN-1254). The facts ask about every task that ever had a session on the machine, finished ones by the thousand, so a per-task read must not scan the sessions or the agents: `liveView`, `liveSession`, `modelRefusal`, `shell`, the turn status and the mailbox's steering go through `sessions/view-index.ts`, built once per list (the monitor replaces both lists whole on each tick); a transcript's summary is kept until its next line (`TranscriptFold.summary`).
- **Packages and CLIs once.** The scope checks each project's package set once (`PackageService.pass`, with the key pool built once per check: `keyPool` copies the whole environment); a CLI's search among the npm global folders is kept `NPM_BINARY_TTL_MS` (15 s, `npmCliBinary`), so an install is seen that much later; the CLI check's lease resolves no path while no check runs.
- **Per project, not per listed task** (BTN-1317). A project's brief lists all its tracker's tasks, thousands of them, so `runs` first keeps only the tasks with their own run (`brief.runOf`) and compares the choice of those alone. In a pass `choiceFor` reads the project's settings here (`runHere`) once per project and each hub folder's folder here (`folderOf`) once per key; `foldersHere` reads each folder's e-mail through `AccountWatcher.shownEmailOf`, never `view`: outside a batch — the page's packages state, the badge — each `view` reads every folder's files again. `hubRoutes` (`src/packages/hub.ts`) builds a project's key pool once for all its servers.

## Tasks to machines

- **Two tables.** `project_machines` is the pool: the machines a project may run on, each with `enabled`. `machine_tasks` is which machine runs which task: written with the task's launch (`Assignments.assign`), removed when its place there is cleaned up (`finish`), by "Reassign" ("A machine gone", `landings.md`) and with the project (`forgetProjectRows`). Both are the hub's own record, never a status (invariant 2): the tracker does not know about machines.
- **A connection's snapshot squares the machine's rows** (`Assignments.reconcile`, `RemoteMachine`'s `held`) once the machine has read its sessions — at the snapshot, or at the first post after it that says so. Every change is a line in the log:
  - a row of a task the snapshot does not name at all is removed;
  - unless another machine has a live session of it (the own machine's sessions once read, else a connected machine's, `liveHolderOf`): then the row is rewritten to that machine (`rehomed`, BTN-1625), so a machine whose task the hub ran in its place never takes the calls about a session it does not know;
  - a task with a live session on this machine and no row, or another machine's row, gets a row of this machine.
- A task whose session stopped is still named and keeps its row until `finish`. Between connections the rows follow only the launches and the cleanups.
- `Assignments` also implements `AssignedTasks` (`src/tracker/source.ts`, "the tasks assigned to me, in this order", by `Assignments.assigned(machine)`), a contract for a chain on a machine; no code reads it: the hub's chain decides and launches through the pool.

## The pool

BTN-993: the hub's one chain runs the tasks of a project on the machines of its pool, several at once. With one machine and `width` 1 nothing changes: at most `parallel` projects, one task each.

- **Lanes.** A project's running tasks are its lanes: several `ActiveChain`s of one project in `active`, each with its `machine` (none — the own one) and its own current task, pause, waits and handoff; `Dispatcher.step` runs each lane as it ran a chain (`src/chain/lanes.ts`). The first is the project's head: only it fixes a red `main` and carries a release project forward into its target branch (`docs/chain/projects.md`, "Carrying a release project forward").
- **What a lane takes.** No task a sibling lane holds, none another machine holds (`machine_tasks`, a machine gone or revoked too, "A machine gone", `landings.md`) and none its machine cannot run, nor what depends on them. "Skip", "New session", an answer and a restart find the lane by the task they name; "Stop", "Resume" and "Stop after the turn" take every lane of the project.
- **A lane ends** when it has nothing left; the last one ends the chain, unless a task is left that only another machine may take — then the project waits at the head of the queue. A lane also ends, with a line in the log and its running session left alone, once it is between tasks (`doubledLane`, `src/chain/step.ts`) when an older version opened it beside another of its project on one machine, and when its machine no longer serves the project — off its pool, turned off or `held` — or is not on the hub's list of machines (`laneOff`, `src/chain/lanes.ts`, BTN-1625). A project left with no lane goes to the head of the queue, and pulling opens a lane where it is served, the same machine once it is back.

### Two numbers

- **Capacity** — how many of the hub's tasks a machine runs at once: the own machine's is `parallel`, a machine elsewhere's is its `machines.capacity` (step 56, `null` — 1); both are set on the machine's page ("The machine's page", `page.md`).
- **Width** — how many of a project's tasks run at once (`width`, `docs/settings.md`, 1 by default), each on a machine of its own (BTN-1569): a machine runs one task of a project at a time, in its one folder of the project, so its capacity counts the projects it serves at once, and a width above the pool's machines turned on adds nothing. Slots (`docs/chain/worktrees.md`) stay a reserve of folders for released sessions, never a second lane of a project on one machine.
- **The width's cap** (BTN-1571) is the machines of the project's list, turned on or off, the own one too, the revoked and never joined ones apart: `MachineNetwork.machinesIn`, at least 1 (`listedMachines` in `src/machine/assignments.ts` counts the same from the database for `config-import`). A machine turned off is often kept for a move or as a spare, so it counts.
  - The page's field turns a number above it into it and its hint names it (`web/src/pages/poolWidth.ts`); the save of a new width above it is refused `config.widthOverMachines` (`checkWidth`, `src/service/width-cap.ts`); `config-import` stores the cap with a line for each such project.
  - Each read of the pools and each revoke (`poolCounted`) cuts a width above the machines left and writes it to the config with a line in the log (`fitWidths`); a machine connected never raises it.
- **What widens.** A paused lane, one winding down, fixing only or held by a red `main` widens nothing (`widens`).

### Pulling and the machine's right to a task

- **Pulling.** Each machine with a free place pulls, the own one first, then the machines elsewhere that are online and have read their sessions (`MachineNetwork.takers`). It gets a lane of the first project by the chain's order — the active ones, then the queue — whose pool has it turned on (`project_machines.enabled`; a project with no pool runs on the own machine only), whose lanes are fewer than its width, none of them on this machine, and which has a ready task the machine may run (`LanePlacement.placeFor`, `src/chain/placement.ts`). Each new lane of a running project is a line in the log.
- **May run.** A machine runs a task when it has an account folder of the task's agent (its run's provider, else the project's), or when no other machine of the pool has one: with one machine the chain falls back to another agent as before (`chainMachines`, `src/machine/chain-machines.ts`). OS, hardware and environment are not matched (BTN-1000).

### The project's account on a machine

BTN-1311. The run names the hub's account folder; a machine finds its own folder of the same account, not of the same name. The brief's `accounts` (`briefAccounts`, `src/machine/account-here.ts`) tells by each hub folder its agent, its claude.ai account (`oauthAccount.accountUuid`, or `LongToken.account` of a long token) and its e-mail. The machine's `choiceFor` (`ChoiceContext.folderOf`, `src/service/accounts.ts`, `folderHere`) looks in this order and takes the first found:

- the folder of the hub folder's name, when it is of the same account;
- a full sign-in of the account;
- a long token of it;
- with no account told, a folder of the agent with the same e-mail;
- with neither told (a long token with no `sameAs`, BTN-1512), only a folder of the same name and agent — none here makes the account absent rather than a key passed on to fail `account.activeGone`.

A folder of the same name and another account is not taken. It reads the brief it holds, so a machine off the link chooses the same.

- **None there.** The choice keeps its provider with `absent` and no fallback, and the launch is refused `machines.accountAbsent`, named by the hub's chain with the machine and the account's e-mail, its button "Add account" with that machine picked (`addOn`, `web/src/pages/noticeFix.ts`).
- **The pool** counts such a machine as one that cannot run the task (`lacks`, `chainMachines`): its lane stays free and the project is not paused while another machine of the pool has the account; with none, the first machine takes it and its lane pauses with that notice.

### The port by task

`machinePool` (`src/machine/pool.ts`) is the chain's one `MachinePort` over every machine. The lane writes the task's `machine_tasks` row (`ChainMachines.bind`) before the launch.

| Call | Goes to |
| --- | --- |
| a launch and every call about a task | the machine of its `machine_tasks` row |
| a call about a session | the machine that has it: its sessions, then the launch journal |
| a call about a folder | the machine whose session works there |
| the project's main, fix and carry sessions, the sync, the account reads | the own machine |
| `sessionsRead()` with no task | the own machine |

- **A task whose machine has no port** (not connected since the hub started, or revoked): the reads and a stop fall back to the own one; a launch, a fix's launch, a resume, a reply, a relay and a move of it are refused `machine.away` instead (BTN-1625): run on the own machine, they would put a second task of the project there while the page and `machine_tasks` name the other.
- **Its facts** are then the own machine's, which know nothing of the task's session, so `sessionsRead(task)` of such a task is `false` (BTN-1610): the dispatcher does not step a lane whose task (or `closing`) has its machine unread, and "Stop after the turn" counts the turn as running, so after a hub restart a lane elsewhere waits for its machine's first snapshot instead of taking the empty mirror for a turn over.
- **The cleanup after Done** (`finish`) never runs on the own machine either (BTN-1627): the task's worktree and branch are on its machine. While that machine may come back it is refused `machine.away`, and `Cleanups` takes the refusal for a wait, not a failure: the task stays released (a closed pull request stays uncleaned, a fix session keeps its lane) with its row, and the cleanup goes there once the machine has posted its snapshot.
- **A revoked machine** never comes back: `finish` cleans up nowhere, drops the task's row and move (`PoolDeps.release`) and ends with `cleanup.machineGone` as its sync error, so main is not taken for pushed and the leftover says what stayed behind; `Cleanups.working` does not wait for such a machine's sessions. A lane on a revoked machine ends before anything is asked of it ("A machine gone", `landings.md`).

### More of the pool

- **A task merged on a machine elsewhere** (BTN-1313). Its session merges into that machine's main, which reaches the remote with the landing there (BTN-1581, "Landings across machines", `landings.md`). So the merge closer (`MergeCloser`, the tracker's read) asks the task's machine, not the hub's checkout: `LinkedMachine.mergedElsewhere` sends `port.merged` (the own commits of its branches, `mergedCommits`) to the machine of the `machine_tasks` row. A machine off the link answers none at once, so a read never waits for it, and the task closes at a read after it is back. The tracker's Done then brings the cleanup to that machine (`finish`), which brings its main together with the remote's and pushes it under the lock of main (BTN-995, `docs/chain/main-ci.md`, "The lock of main"). The own machine's tasks, and those of a machine with no port, are asked of the hub's checkout.
- **The launch log remembers the machine.** `LaunchEntry.machine` is the task's `machine_tasks` row at the launch, else the own machine; the sessions of a task carry it (`TaskSession.machine`). The page's state names every machine the hub ever had (`machineNames`) and each lane's machine; where there is more than one, a chain row shows the machines its task ran on, oldest first, the lane's now last (`Workstation → Home server`, `web/src/ui/MachineTag.tsx`, each name after its machine's icon and a link to its page; `dev:fake` `?chain=lanes`).
- **Lanes by component** (BTN-1273): the project's switch `componentLanes` (`docs/settings.md`), off by default. On, a lane takes no task of the tracker component that a task held by a sibling lane of the project is in (`heldFrom`, `src/chain/lanes.ts`), so tasks at once seldom edit the same files; what depends on such a task waits too, as for any held one. A task without a component goes as before, beside any lane. The component is the task's name of it in a tracker that keeps them (`TrackerTask.component`: Huly, Jira's first one); elsewhere no task has one and the switch changes nothing. Lanes are not bound to a component: each takes the first task by the order that no sibling's component holds back.

## A task pinned to machines

BTN-1623: a person names the machines one task may run on — a check that needs a bench on one computer, say. The automatic match of a machine's inventory against a project's needs is BTN-1000; it can lie on the same check later.

- **The field.** `TaskRun.machines` (`src/sessions/runs.ts`), the machine ids of the task's run next to its provider, model and effort: `task_runs.machines`, step 78 (`docs/storage.md`), empty — any machine, as before, and a run of old has none. It is the hub's own state, never a tracker label or status (invariant 2). A run that names only machines is still a run (`taskRunOf`); `null` or `[]` clears the pin.
- **Who may be picked.** `pinnable` (`src/machine/pins.ts`): the project's pool turned on and not revoked, the own machine for a project with no pool. The state carries them by project as `pools`; a machine picked before and gone off the pool stays in the run, shown "not in the pool".
- **The chain.** A machine off the list cannot run the task (`ChainMachines.runs`, `src/machine/chain-machines.ts`), the same path as a machine that `lacks` the account ("The project's account on a machine"): its lane stays free and takes the next task, a lane of a machine on the list takes the pinned one, and what depends on it waits for it. The machine already holding the task (`machine_tasks`) keeps counting as on the list, so a pin never moves a started task: it goes over by "Reassign" ("A machine gone", `landings.md`), by hand. With no machine of the list free or online the task waits, and the chain goes on with the others; once only such tasks are left, the project waits at the head of the queue and a machine of the list back takes the task. The chain's tests are `src/chain/pinned.test.ts`, end to end `src/e2e/elsewhere.test.ts`.
- **The waits.** `pinWaits` gives the state's `pinWaits` by project and task (`PinWait`, `src/state.ts`): `busy` — every machine of the list online runs the project or is full; `offline` — none of them is on the link (or the holder is away); `gone` — none of them is in the pool turned on any more, revoked or taken out; `elsewhere` — a machine off the list holds the task. The chain row shows each as a chip next to the pinned machines' tag (`PinWaitChip`, `web/src/ui/`): "waits for" and the machine for the first two, with the reason in its tip; for the other two a button with the reason that opens the task's card, where the pin is changed. A pinned task not yet running shows its machines as the row's tag (`pinnedMachines`, `web/src/lanes.ts`), as a running task shows its machine; the machine's page counts it only on its machines (`pinnedTo`, `web/src/machineView.ts`).
- **Setting it.** The card's run (`docs/sessions/models.md`) has "Machines" while the pool has more than one machine or the run names one: "any machine of the pool" and a tick per machine. The tasks server takes `run.machines` in `tasks_create` and `task_update` by name or id (`pinnedPatch`, `src/taskmcp/run-machines.ts`), an unknown one refused with the pool's names; `task_read` prints the run with `machines A, B`.
- **`dev:fake`**: `?chain=pins` — three machines in the pool; ABC-6 pinned to the laptop, free, ABC-7 to the laptop, busy, ABC-8 to the desktop, off the link, ABC-9 to a revoked machine. `/p/ABC?chain=pins&task=ABC-7` opens the card with the pick.

## Past a limit

BTN-996: whether a task leaves a machine whose limit is spent is the shared switch `switchOnLimit`, "Go on where a limit is left" (`docs/settings.md`), off by default. Pulling alone settles nothing: a machine whose window is spent asks for no task, and another would take it anyway.

- **Off** — a limit is no reason to move. The lane waits on its machine for the reset (`limitUntil`, as before); a project of width 1 waits with it, and no other machine gets its tasks, since the lane is still there (`placeFor`).
- **On** — a lane whose next task would wait for its machine's limit (`limitReset` or the model's week of the task's run there) goes to the first listed machine that has a free place, runs no other lane of the project, serves the project, may run the task and has limit left for it (`ChainMachines.hasLimit`: the account's limits read, no window spent, no model week; `moveOffLimit`, `src/chain/limit-moves.ts`). The lane's `machine` and the task's `machine_tasks` row change, a line goes to the log and an entry `eventLog.limitMoved` (the machines by name) to the event log. No such machine — the lane waits as with the switch off.
- **Only a task never launched moves**: one with an entry in the launch journal stays with its machine, its worktree and its sessions; a session stopped by a limit is continued there (`docs/sessions/limits.md`). Fix and carry sessions never move.
- **Width over 1** — the lanes on other machines are the plain pull; the switch moves only the waiting lane, and only to a machine with a free place.
- **Whose machines.** Machines of different people, each on an account of their own, would need no switch; until machines have owners (BTN-502) every machine counts as one person's, so the switch decides for all of them. Turning it on shows the warning on provider terms first (BTN-125's text). The switch of accounts on one machine on a limit (BTN-125) is not built; the setting shows only while the hub has more than one machine.
