# Hub and machines

The hub decides, a machine runs the sessions; the map of the roles is BTN-137. Three steps of it are in the code: the seam between the two roles inside the service ("The seam"), the link that carries it (`src/link/`) and the chain over that link inside one process ("One process" and the sections after it). **No machine connects from elsewhere yet:** the service neither listens for machines nor connects to a hub, there is no setting and no port; the hub's one machine is the installation itself, reached through the same protocol over a carrier that is a call.

## The seam

One installation is a hub and a machine in one process, and there is one code path: the chain (`src/chain/`) reaches sessions, accounts, packages and working folders only through `MachinePort` (`src/machine/port.ts`), which `DispatcherDeps.machine` carries. The chain is given the hub's side of the port, `RemoteMachine` (`src/machine/remote.ts`); the machine's own implementation is `wireMachine` (`src/service/machine-chain.ts`), run behind `MachineRunner`. `wireDispatcher` (`src/service/chain.ts`) builds the hub's side and takes the port as an argument.

| Side | In the chain | In the service's assembly |
| --- | --- | --- |
| Hub | `Dispatcher`: order, the queue and its fill, pauses, skips, released and shelved tasks, the launch of a task (`startTask`, `inTurn`, `src/chain/start.ts`), the skip of a quiet session (`unanswered`, `quietTooLong`, `src/chain/quiet.ts`), `MainCheck`, `MainFix`, `MainWait`, `MainCarry`, `Reviews`, `TaskLists`, `Cleanups`, `Unchanged`, questions to the tracker, the hub's side of the moves (`taskMoves`, `src/machine/tasks.ts`); the rest of `DispatcherDeps` and `MainCheckDeps` (`hubMainDeps`): projects, rules, `parallel`, the chain's state, statuses and comments in the tracker, the CI of main, PR mode | `src/service/hub-bootstrap.ts`, `src/service/chain.ts`: the state database, tracker and CI profiles, projects and settings, the page, Tally |
| Machine | `src/machine/`: the moves of a task's session ("Moves") — `MachineMoves` (`moves.ts`) running `Handovers` (`handover.ts`: limit, resume, relay, checkpoint, answer, "New session", a returned task) and `OverageStops` (`overage.ts`), the git and check side of the CI of main (`mainMachineDeps`, `main.ts`) | `src/service/machine-bootstrap.ts`, `src/service/machine-chain.ts`: accounts and limits, packages and the MCP gateway, slots and worktrees (`wirePlaces`), the session monitor, the launch journal for the slots' occupants, keep-warm |

- **A member of the port** is a command, a query or a snapshot field; the comment of each in `port.ts` says which. A command (`launch`, `launchFix`, `launchCarry`, `resume`, `reply`, `relay`, `stop`, `finish`, `sync`, `prepare`, `checkMain`, `runAfterGreen`) is a numbered command of the link with its result as an event; a query (`locate`, `head`, `tree`, `merged`, `carried`, `changes`, `history`, `modelBlock`) goes the same way and changes nothing on the machine; the facts (`liveSession`, `lastSession`, `busy`, `midTurn`, `shell`, `asked`, `silentSince`, `limited`, `overage`, `handoff`, `modelRefusal`, `sessionsRead`, `reportedTree`, `account`, `accountAt`, `launchBlock`, `limitReset`, `modelWeek`, `limitResetAfter`, `limitReopenedAt`, `limitsUnread`, `accountsRead`, `packagesBlocked`, `packagesPause`, `trackerMissing`) are read from the hub's mirror of the machine's snapshot ("The mirror").
- **An action of both sides is the hub's decision and one call of the port.** A red main: `MainFix` decides, `stop` stops. The cleanup after Done: `Cleanups` decides and records the closed task (`archiveClosed`), `finish` stops the sessions and removes the folder. The report of a red main: the hub writes it, `history` gives the commits.
- **Every touch of a session is the same exception to invariant 1 as before** (`docs/chain/exceptions.md`), now made on the machine's side.
- **What is not cut yet.** A machine whose link is down does not make the moves by itself: it waits for the hub's command (BTN-1226, after BTN-992). Account controls, historical transcript reads (a session's record, feed, checkpoint and files), chat commands and the initial loading of the machine's retained records still share the process; the page's state of the machine's sessions and accounts reads the mirror ("The mirror"). A machine apart from its hub still needs those controls and startup reads cut.

## One process

`wireLinkedMachine` (`src/service/machine-link.ts`) assembles both roles of an installation: `HubEnd` over the state database, `MachineEnd` over the machine's own database, and `LocalTransport` (`src/link/local.ts`) between them — the ends call each other, without HTTPS and a certificate, with the same numbers, confirmations and snapshot; what passes is carried through JSON, so both sides see what a machine elsewhere would. A single installation has no other path. The pulse is `LOCAL_HEARTBEAT_MS` (10 days): there is no network to lose.

- **The own machine** (`ownMachine`, `src/machine/own.ts`) is made at the first start of a version that has machines: a row of `machines` named after the host, a token whose secret is kept in the machine's database (`identity`), its id in `service_state` as `machines.own`. Every later start finds it again. When the two databases no longer agree — one folder restored or removed — a new machine is made and the old one revoked; `storeToken` empties the machine's outbox and command numbers with the old token.
- **Consent** to the installation's own projects, each in its folder, is given at the start and before a step of the chain after the projects changed (`agree`); a project gone from the config is served no longer. The same moment puts the own machine into the pool of every project that has none (`fillPool`).
- **The order at the start.** The port is built first, the dispatcher on it, and only then is the machine connected (`LinkedMachine.start`): the machine's facts read the chain's state. `start` waits for the first snapshot; until it is in the mirror `sessionsRead()` and `accountsRead()` are `false` and no chain steps. Before the monitor, hooks and chat start, the link drains the retained outbox and reloads the mailbox and session windows: records replayed from the previous process must be included in their initial state, including the mailbox's next id.
- **Commands the process before kept** and its machine never took are dropped at the start: nothing waits for their result, and a launch among them would start a session the chain did not ask for again. A command the machine took and did not finish is reported as `command.interrupted`, found without a waiter and logged; a launch it began is found by the chain's own recovery of a `starting` task.
- **Moving an installation of the version before** needs nothing by hand: the state database stays the hub's, accounts, packages and slots stay where the machine's code reads them, the own machine and its consents are made as above, and the chain's state is not touched — live sessions are picked up and the current task stays current.

## The chain over the link

`RemoteMachine` is the hub's side of the port, `MachineRunner` (`src/machine/runner.ts`) the machine's.

- **A command or a query** is the link's command `port.<member>` with `{args}` as its payload and `project` and `folder` in its own fields: the project of the call, and the session's folder (`resume`, `reply`, `relay`, `stop`, `locate`) or the working folder (`changes`). The machine runs it on its local port and answers with the event `command.done` — `{seq, value}`, or `{seq, notice, cause}` when the handler threw: the chain branches on message codes (`cliCheck.busy`, `slot.*`), so a handler's error is a result, not `command.failed`.
- **The call waits** for the event that names its number, as it waited for the direct call before. A project's steps go one at a time (`Dispatcher.work`), so a project never steps twice while it waits. The machine takes commands in order and runs their handlers side by side (`MachineOptions.concurrent`): a check of main or a launch does not hold a stop or a query of another project.
- **`command.interrupted`, `command.failed`, `command.refused`** reject the waiting call with `machine.commandInterrupted`, `machine.commandFailed`, `machine.commandRefused`: the chain's own error branches pause it, and nothing launches again. A result nobody waits for (the hub restarted) is a line in the log.
- **A handoff snapshot** (`src/chain/snapshots.ts`) is the machine's event `handoff.snapshot`; the hub keeps it in the state database (`handoffs`). A save that fails leaves the event with the machine, which brings it again.
- **Journal, session records and chat** (BTN-1219, `src/machine/records.ts`): `MachineRecords` sends `launch.record` (`LaunchEntry`), `session.windows` (the monitor's changed `[sessionId, size]` pairs with their observation time) and `chat.mailbox` (complete changed `Mail` rows and the producer's optional retention cutoff). `Mailbox` keeps its immediate claim/settle behaviour but publishes typed changes, never SQL. The hub awaits the writes to `launches`, `session_windows` and `mailbox`; its journal in memory and the event log update after the launch is committed. Live session views and chat delivery state travel in `facts` (below).
- **A receipt is part of the write.** `saveMachineRecord` locks the machine's row and commits the record with `machines.last_event` in one transaction. A retry at or below that number writes nothing, even after a restart between the commit and the link's separate confirmation. A failed write rolls back both, leaving the event in the outbox. The tables keep their existing layout; the wire API is version 2. Closing the local link drains the writes into its outbox and attempts their delivery before closing its database.
- **Every touch of a session** is made by the machine's local port, as before: the list of `docs/chain/exceptions.md` is unchanged.

## Moves

A move of a task's session is what the chain does to the session it already has (BTN-1221): the limit and the temporary model error (resume or handover), the checkpoint, a move a restart cut short, the user's answer and the feedback on a pull request (`deliver`, `deliverLoose`), "New session" (`renew`), a session restarted (`replace`), a returned task and the fix's handoff (`handOverCurrent`, `handOver`), and the stop on paid usage (`guard`). The machine makes them; the hub decides when.

- **The command** is `task.<move>` (`src/machine/move-call.ts`, `MOVES`) with a `MoveCall`: the project, the task as the hub holds it (`CurrentTask`), whether it is still the chain's current task and whether the chain is active, the move's own arguments, and `MoveContext` — what only the hub knows: `blocked`, the prompt language, the main branch, PR mode, a project without git and the report of a fix or carry session.
- **The machine** (`MachineMoves`, `src/machine/moves.ts`) runs the same `Handovers` and `OverageStops` code over its local port and a copy of the task. Their `save` — the task's state kept before the session is touched (`starting`, `move`, `answering`, `reply`, `ask`) — is the event `task.state`, sent in order before the result. The result in `command.done` is `MoveDone`: the move's value, the task's move fields after it and a pause of the chain (`halt`, with `keep` for a refused model). The memory of the moves — the retry ladder of temporary errors and the sources of a handoff after a session that never answered (BTN-650) — is the machine's, shared by all moves; the launch journal goes through the outbox as for any launch.
- **The hub** (`HubMoves`, `src/machine/tasks.ts`) copies the move fields (`fieldsOf`/`applyFields`: `sessionId`, `resumedAt`, `limit`, `starting`, `move`, `answering`, `reply`, `ask`) from `task.state` and the result into its `CurrentTask` and saves the chain's state, as `save` did in the hub's process. A link error (`machine.command*`) pauses the chain, or for an answer leaves it undelivered, as a failed move would.
- **Only when there is work.** `follow` is sent when the mirror shows the machine something to do — a refused model, a move under way, a limit held or hit, a checkpoint; `guard` when there is a hold or evidence of paid usage. Otherwise a step would send a command per chain.
- **In tests** a port without `moves` (the dispatcher's fake ports) has `taskMoves` run the same code in the hub's process; the service always goes through the link.

## The mirror

The snapshot members of the port read `MachineFacts` (`src/machine/facts.ts`), values the machine computes with its local port for every key the chain may ask about: per task with a session (`live`, `busy`, `midTurn`, `shell`, `asked`, `silentSince`, `limited`, `overage`, `handoff`, model refusals by session), per project (packages, the tracker's server, check reports) and per "run" — the project's default and each task whose run differs (`account`, `launchBlock`, `limitReset`, `modelWeek`, `limitsUnread`, the model). The reads with a free time are computed by the hub: `accountAt` from the posted account ledger, `limitReopenedAt` from the posted limits; `limitResetAfter` is a table by the sessions a limit stopped, because the call has side effects on the machine. `lastSession` is the hub's own launch journal.

- **The snapshot** of every connection replaces the mirror whole (`{boot, rev, facts}`: `boot` names the machine's process, `rev` grows with each post). Between snapshots the event `facts` carries the entries that changed (`patchOf`, `applyPatch`); one from another `boot` or not newer than the mirror is dropped.
- **The page's sessions and chat** are the `sessions` and `mailbox` sections, keyed by session id. Each session carries its `SessionView`, including its current action and feed; each mailbox carries its messages and the listens/steers flags. Changes and removals go in the same patches as the chain's facts, and a reconnect replaces both sections. These live views stay in memory, as before; the retained session windows and chat messages use the record events above. The hub broadcasts a changed mirror, and the local monitor and mailbox publish on change as well as at the regular catch-up points.
- **The page's accounts** (BTN-1220): `panel` is the accounts panel (`AccountWatcher.view` with `missing` read with it), posted whole when anything in it changed; `usage` is by account folder beside `limits`; `owners` gives, for each session of the launch journal and each live agent, its account folder (the agent's, else the transcript's, `TranscriptOwners`); `compactions` the compactions counted in a transcript. The hub reads all of them, and the sessions and the mailbox, through `PageReads` (`src/machine/page.ts`, `RemoteMachine.page`): `wireGetState` and the tray, the built-in tracker's and the tasks server's "is a session live", and the replies from the page (`createChat`: `liveView`, `midTurn`, `steering`). A change the machine's watchers see — accounts, limits, transcripts' owners, a CLI copy, a login block — has the machine post at once (`machineChanged` in `src/service.ts`), so the page does not wait for `PUBLISH_EVERY_MS`. The mailbox's own settling (`settleMail`, `machineLive`) stays on the machine's reads: it runs right after the monitor's read, before the mirror has it.
- **Freshness.** The machine posts its facts before every `command.done`, so the mirror is never older than a result the chain acts on; every `PUBLISH_EVERY_MS` (5 s); and, in one process, before every step of the chain, every command and query of the page (`ServerDeps.catchUp`) and every reply to a session from the page, a tracker or the mailbox (`createChat`): `MachinePort.catchUp` has the machine post what changed and waits until the hub took it, so each reads the machine as it is now. A new entry point that reads the port outside a step catches up first. Without a connection `catchUp` does not wait. A machine elsewhere will have a mirror as fresh as its last event.
- **Cost.** The facts are computed several times a second (every step catches up), each time for every project and every task with its own run, so a read in them must not search the disk per call. One computation runs inside `RunnerDeps.scope`: the accounts view is built once for it (`AccountWatcher.batch`, which otherwise builds it on every read, reading every folder's files) and the tasks with a session are grouped by project once; a launch's check of the CLI copy reads `cliCopy.state`, not `view`, which looks for the system binary. Without these the facts took the whole event loop (2026-11-16, 20 projects: requests 16 s, the gateway's probes timing out, the event log filled with "does not answer"). The same scope computes each `choiceFor` once (`ChoiceFor.pass`, BTN-1223): a run's six members ask for it, and an OpenCode choice reads its folder's `auth.json`. Posts asked while one waits for its turn share it (`MachineRunner.publish`): its read has not begun, so each caller still gets the machine as it is after its call. `patchOf` compares entries with `sameJson`, not by writing both out as JSON.

## Tasks to machines

- `project_machines` is the pool: the machines a project may run on, each with `enabled`. `machine_tasks` is which machine runs which task: written with the task's launch (`Assignments.assign`), removed when its place there is cleaned up (`finish`), and with the project (`forgetProjectRows`). Both are the hub's own record, never a status (invariant 2): the tracker does not know about machines.
- `AssignedTasks` (`src/tracker/source.ts`) is the contract a machine's chain will read its work through, next to the trackers': "the tasks assigned to me, in this order" — `Assignments.assigned(machine)` gives them project by project in the chain's order. Nothing asks it yet: with one machine the hub's chain launches where the task goes.

## The link

How a hub and a machine talk (`src/link/`).

| File | What it holds |
| --- | --- |
| `protocol.ts` | the constants, the frames and posts, the connection token |
| `hub.ts`, `hub-store.ts` | the hub's end (`HubEnd`) and what it keeps in the state database |
| `machine.ts`, `machine-store.ts` | the machine's end (`MachineEnd`) and its own database |
| `local.ts` | the carrier inside one process (`LocalTransport`) |
| `cert.ts`, `identity.ts` | the hub's self-signed certificate and where it is kept |
| `hub-server.ts`, `machine-transport.ts` | the carrier: HTTPS, the stream and the posts |
| `link.fixture.ts` | the stores in memory and the wire with breaks, for tests |

## The two directions

The machine opens every connection, so a machine behind NAT needs no open port.

- **Down, hub → machine:** one long answer to `POST /link/stream`, server-sent events. A frame is `hello` (the handshake), `ping` (the hub's pulse) or `command`.
- **Up, machine → hub:** `POST /link/snapshot` (what the machine holds right now) and `POST /link/events` (its numbered events; an empty one is the machine's pulse).

Every request carries `Authorization: Bearer <machine id>.<secret>`. A refusal is JSON `{refused}` under a status: `token` 401 (unknown, wrong or revoked), `version` 426 (the API versions differ; the body names the hub's), `connection` 409 (the post names a connection that is no longer the machine's).

The handshake: the machine's `{api, host, lastCommand}` is the body of the stream's request; the hub's first frame is `hello` with `{api, connection, heartbeatMs, lastEvent}`. `API_VERSION` is compared before anything else; a change of a frame, a post or their meaning is a new version.

## Numbers and what is kept

- **Commands** are numbered per machine by the hub (`machines.last_command`) and kept in `machine_commands` until the machine names their number as taken: in `lastCommand` of its handshake and of every post. At a connection the hub sends, after `hello`, every kept command above the machine's `lastCommand`. All of one machine's work on the hub runs in the order it was called (`queued`), so a command sent during a reconnect never overtakes the ones sent again.
- **A command runs at most once.** The machine records its number before the handler runs (`commandReceived`); a number at or below the last recorded one is a repeat and is dropped. Commands are taken in order; a handler ends before the next command is taken unless the machine is `concurrent` ("The chain over the link"). A machine that stopped between the record and the end does not run the command again: at its next start it reports `command.interrupted` and the hub decides. So a command's handler must be safe to lose, not safe to repeat.
- **Events** are numbered by the machine (the `outbox` table's identity) and kept there until the hub's answer names their number in `lastEvent`. The hub takes an event once: one at or below `machines.last_event` is dropped; a handler that throws leaves the event and the ones after it untaken, and the machine brings them again with its next pulse. Events go in order, `EVENT_BATCH` a post.
- **The snapshot** is not an event and has no number: it is the state now, posted first on every connection, before any event, and never queued. The hub reconciles what it believes about the machine with it.
- One machine has one connection. A new stream of the same machine closes the older one, whose posts are then refused with `connection`.

The machine's store belongs to its connection token. If the hub has taken more events than the store ever numbered (the store was made anew under an old token), the numbering jumps past the hub's `lastEvent`; events written before that first handshake are lost, so a machine set up anew takes a new token.

## Pulse and reconnect

- The hub writes a `ping` frame every `HEARTBEAT_MS` (20 s); the machine posts its events, or an empty post, at the same pace. The pace is the hub's: the machine takes `heartbeatMs` from `hello`.
- `MISSED_PULSES` (2) intervals without a frame — the machine closes the stream and connects again; the same time without a post — the hub closes the machine's connection (`handlers.offline`). The lock of the main branch will later hang on exactly this.
- A post that fails or times out breaks the connection too: the machine does not go on over a link that carries one direction only.
- The pause before an attempt is 1, 2, 4 … 30 s and starts over at 1 s after a handshake. After a refusal of the token or the version the machine keeps trying at the 30 s pace: the token may be issued again, the hub updated.
- A machine without its hub keeps what it has to say in the outbox and goes on; what it may do without the hub is the roles' matter, not the link's.

`MachineEnd.status()` is `{state, notice?}`: `offline`, `connecting`, `online` (the snapshot was taken), and a message code for the machine's page — `link.token`, `link.version`, `link.buffered`.

## Behind a proxy

A reverse proxy, a corporate proxy or an antivirus that inspects HTTPS may hold a streamed answer in its buffer. The connection is then alive, the hub writes its pulse, and the machine sees nothing: by the pulse alone that is a break, a reconnect, and the same again forever.

- The stream's answer carries `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` (nginx turns its buffering off for that answer by itself), the headers are flushed at once, Nagle's algorithm is off and each frame is one write.
- The machine tells the case apart: the connection opened and **not one frame** came over it in two pulse intervals — `link.buffered` and one line in the log, not only a quiet reconnect. The notice stays through the reconnects and goes with the first `ping` that arrives: the handshake alone could be the proxy's first flush.
- An idle timeout (about 100 s on a Cloudflare tunnel, `proxy_read_timeout` 60 s on nginx) is covered by the pulse in the stream itself, which is more frequent than either.

For the guide's page about machines, when there is one (the feature cannot be used before the installer has the role): behind a reverse proxy turn buffering off and raise the read timeout for the machines' address — for nginx `proxy_buffering off; proxy_read_timeout 1h;`; a Cloudflare tunnel needs nothing. A proxy that ends TLS shows the machine its own certificate, so the token must not pin the hub's (below).

## The token and the certificate

The hub has a port of its own for machines, apart from the page's address, and a self-signed certificate made at the first need (`hubIdentity`: ECDSA P-256, built by hand in `cert.ts` without a dependency, kept with its key in `service_state` as `machines.certificate`). A new certificate turns every machine away, so it is made once.

A connection token is one line, `ekm1.` and base64url JSON `{hub, fingerprint, machine, secret}`: the hub's address for machines, the SHA-256 of the certificate, the machine's id and its secret. `HubEnd.issue` is the only moment the secret exists on the hub; the store keeps its SHA-256 (`machines.secret_hash`). `HubEnd.revoke` stops the token and closes the connection; the row stays.

- **Machine → hub** is the token: unknown, wrong or revoked — `token`.
- **Hub → machine** is the pinned certificate. The machine connects (`connectPinned`), compares the certificate's SHA-256 with the token's and only then writes anything: the secret goes to no other server, and a command comes from no other hub. The chain and the name are not looked at. Node's `checkServerIdentity` cannot do this: it is not called when the chain does not verify.
- **An empty fingerprint** is a hub behind a certificate of a public authority, such as a proxy that ends TLS and renews its certificate: the machine then verifies the certificate as any HTTPS one. An HTTPS-inspecting proxy in front of a pinned token is refused, as it should be.
- Each post is a connection of its own (the check comes before the request); the stream is one more.

## What a command may touch

A command names what it touches in its own fields, `project` (the project's id) and `folder`, never in its payload. The machine keeps the projects and folders it agreed to (`consents`) and checks every command before the handler (`refusalOf`):

- no `project` and no `folder` — a command about the machine itself, run;
- a `project` the machine did not agree to — refused, `project`;
- a `folder` outside the folders agreed for that project (compared through `src/paths.ts`), or a `folder` without a `project` — refused, `folder`.

A refused command is reported as the event `command.refused` with its number, type and reason; a handler's throw as `command.failed`. So a hub in the wrong hands gets the agreed folders, not the machine's disk. Consent is given on the machine (`MachineStore.agree`), by whatever connects a project to it; a hub's command cannot give it.

## The stores

- **Hub:** the state database, step 51 — `machines` and `machine_commands`, step 52 — `project_machines` and `machine_tasks` (`docs/storage.md`), through `DatabaseHubStore` and `Assignments`.
- **Machine:** a PGlite database of its own with its own steps (`MACHINE_STEPS`, opened by `openMachineDatabase`, numbered like the state database's and never edited once merged): `outbox` (the unsent events), `commands` (the numbers taken, with the newest `KEPT_COMMANDS` finished ones), `consents` and `identity` (the connection token). Its folder is `state/machine/`, next to the hub's `state/even-keel/` and apart from it in a process that is both: a machine apart from its hub will have the same folder with nothing to move. It is not in the backups: lost or out of step with the state database, it is made anew with a new own machine.

## Tests

`link.test.ts` runs both ends over `Wire` of `link.fixture.ts` with fake timers: the hub away (`down`), a break (`cut`), a proxy that holds frames (`hold`, `release`), lost frames (`mute`), posts without an answer (`hang`) and answers lost after the hub took the post (`loseAnswers`). The stores there are in memory; the PGlite ones have `machine-store.test.ts` and `src/storage/database-machines.test.ts`. `carrier.test.ts` runs the real HTTPS carrier on loopback: the headers, the pin, the refusals. `src/machine/remote.test.ts` runs `RemoteMachine` and `MachineRunner` over the same `Wire`: a break between a launch and its result, a launch command that comes twice, a machine stopped mid-launch, the mirror against the snapshot of a new connection. `src/storage/database-machine-tasks.test.ts` has step 52, the own machine on the sample of the step before and the assignments. The assembled service runs over the link in every scenario of `src/e2e/`. The stream through a real proxy was never run: `docs/unverified/machines.md`.
