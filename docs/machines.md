# Hub and machines

The hub decides, a machine runs the sessions; the map of the roles is BTN-137. Three steps of it are in the code: the seam between the two roles inside the service ("The seam"), the link that carries it (`src/link/`) and the chain over that link inside one process ("One process" and the sections after it). **No machine connects from elsewhere yet:** the service neither listens for machines nor connects to a hub, there is no setting and no port; the hub's one machine is the installation itself, reached through the same protocol over a carrier that is a call.

## The seam

One installation is a hub and a machine in one process, and there is one code path: the chain (`src/chain/`) reaches sessions, accounts, packages and working folders only through `MachinePort` (`src/machine/port.ts`), which `DispatcherDeps.machine` carries. The chain is given the hub's side of the port, `RemoteMachine` (`src/machine/remote.ts`); the machine's own implementation is `wireMachine` (`src/service/machine-chain.ts`), run behind `MachineRunner`. `wireDispatcher` (`src/service/chain.ts`) builds the hub's side and takes the port as an argument.

| Side | In the chain | In the service's assembly |
| --- | --- | --- |
| Hub | `Dispatcher`: order, the queue and its fill, pauses, skips, released and shelved tasks, `MainCheck`, `MainFix`, `MainWait`, `MainCarry`, `Reviews`, `TaskLists`, `Cleanups`, `Unchanged`, questions to the tracker; the rest of `DispatcherDeps` and `MainCheckDeps` (`hubMainDeps`): projects, rules, `parallel`, the chain's state, statuses and comments in the tracker, the CI of main, PR mode | `src/service/hub-bootstrap.ts`, `src/service/chain.ts`: the state database, tracker and CI profiles, projects and settings, the page, Tally |
| Machine | `src/machine/`: `MachineTasks` with `startTask` and `inTurn` (`start.ts`), `Handovers` (`handover.ts`: limit, resume, relay, checkpoint), `OverageStops` (`overage.ts`), the git and check side of the CI of main (`mainMachineDeps`, `main.ts`) | `src/service/machine-bootstrap.ts`, `src/service/machine-chain.ts`: accounts and limits, packages and the MCP gateway, slots and worktrees (`wirePlaces`), the session monitor, the launch journal for the slots' occupants, keep-warm |

- **A member of the port** is a command, a query or a snapshot field; the comment of each in `port.ts` says which. A command (`launch`, `launchFix`, `launchCarry`, `resume`, `reply`, `relay`, `stop`, `finish`, `sync`, `prepare`, `checkMain`, `runAfterGreen`) is a numbered command of the link with its result as an event; a query (`locate`, `head`, `tree`, `merged`, `carried`, `changes`, `history`, `modelBlock`) goes the same way and changes nothing on the machine; the facts (`liveSession`, `lastSession`, `busy`, `midTurn`, `shell`, `asked`, `silentSince`, `limited`, `overage`, `handoff`, `modelRefusal`, `sessionsRead`, `reportedTree`, `account`, `accountAt`, `launchBlock`, `limitReset`, `modelWeek`, `limitResetAfter`, `limitReopenedAt`, `limitsUnread`, `accountsRead`, `packagesBlocked`, `packagesPause`, `trackerMissing`) are read from the hub's mirror of the machine's snapshot ("The mirror").
- **An action of both sides is the hub's decision and one call of the port.** A red main: `MainFix` decides, `stop` stops. The cleanup after Done: `Cleanups` decides and records the closed task (`archiveClosed`), `finish` stops the sessions and removes the folder. The report of a red main: the hub writes it, `history` gives the commits.
- **Every touch of a session is the same exception to invariant 1 as before** (`docs/chain/exceptions.md`), now made on the machine's side.
- **What is not cut yet.** `MachineTasks` runs inside the hub's serialized step and changes the chain's records in place: `MachineTaskDeps` (`src/machine/host.ts`) still gives it the hub's `save`, `journal`, `moveStatus` and `blocked`, though it reaches the machine only through the port. The page reads the machine's sessions and accounts directly, in the process. The launch journal, the sessions' state and the chat are still written by the hub's own code in the process, not sent as events; of the machine's records only the handoff snapshot goes over the link. A machine apart from its hub needs each of these cut.

## One process

`wireLinkedMachine` (`src/service/machine-link.ts`) assembles both roles of an installation: `HubEnd` over the state database, `MachineEnd` over the machine's own database, and `LocalTransport` (`src/link/local.ts`) between them — the ends call each other, without HTTPS and a certificate, with the same numbers, confirmations and snapshot; what passes is carried through JSON, so both sides see what a machine elsewhere would. A single installation has no other path. The pulse is `LOCAL_HEARTBEAT_MS` (10 days): there is no network to lose.

- **The own machine** (`ownMachine`, `src/machine/own.ts`) is made at the first start of a version that has machines: a row of `machines` named after the host, a token whose secret is kept in the machine's database (`identity`), its id in `service_state` as `machines.own`. Every later start finds it again. When the two databases no longer agree — one folder restored or removed — a new machine is made and the old one revoked; `storeToken` empties the machine's outbox and command numbers with the old token.
- **Consent** to the installation's own projects, each in its folder, is given at the start and before a step of the chain after the projects changed (`agree`); a project gone from the config is served no longer. The same moment puts the own machine into the pool of every project that has none (`fillPool`).
- **The order at the start.** The port is built first, the dispatcher on it, and only then is the machine connected (`LinkedMachine.start`): the machine's facts read the chain's state. `start` waits for the first snapshot; until it is in the mirror `sessionsRead()` and `accountsRead()` are `false` and no chain steps.
- **Commands the process before kept** and its machine never took are dropped at the start: nothing waits for their result, and a launch among them would start a session the chain did not ask for again. A command the machine took and did not finish is reported as `command.interrupted`, found without a waiter and logged; a launch it began is found by the chain's own recovery of a `starting` task.
- **Moving an installation of the version before** needs nothing by hand: the state database stays the hub's, accounts, packages and slots stay where the machine's code reads them, the own machine and its consents are made as above, and the chain's state is not touched — live sessions are picked up and the current task stays current.

## The chain over the link

`RemoteMachine` is the hub's side of the port, `MachineRunner` (`src/machine/runner.ts`) the machine's.

- **A command or a query** is the link's command `port.<member>` with `{args}` as its payload and `project` and `folder` in its own fields: the project of the call, and the session's folder (`resume`, `reply`, `relay`, `stop`, `locate`) or the working folder (`changes`). The machine runs it on its local port and answers with the event `command.done` — `{seq, value}`, or `{seq, notice, cause}` when the handler threw: the chain branches on message codes (`cliCheck.busy`, `slot.*`), so a handler's error is a result, not `command.failed`.
- **The call waits** for the event that names its number, as it waited for the direct call before. A project's steps go one at a time (`Dispatcher.work`), so a project never steps twice while it waits. The machine takes commands in order and runs their handlers side by side (`MachineOptions.concurrent`): a check of main or a launch does not hold a stop or a query of another project.
- **`command.interrupted`, `command.failed`, `command.refused`** reject the waiting call with `machine.commandInterrupted`, `machine.commandFailed`, `machine.commandRefused`: the chain's own error branches pause it, and nothing launches again. A result nobody waits for (the hub restarted) is a line in the log.
- **A handoff snapshot** (`src/chain/snapshots.ts`) is the machine's event `handoff.snapshot`; the hub keeps it in the state database (`handoffs`). A save that fails leaves the event with the machine, which brings it again.
- **Every touch of a session** is made by the machine's local port, as before: the list of `docs/chain/exceptions.md` is unchanged.

## The mirror

The snapshot members of the port read `MachineFacts` (`src/machine/facts.ts`), values the machine computes with its local port for every key the chain may ask about: per task with a session (`live`, `busy`, `midTurn`, `shell`, `asked`, `silentSince`, `limited`, `overage`, `handoff`, model refusals by session), per project (packages, the tracker's server, check reports) and per "run" — the project's default and each task whose run differs (`account`, `launchBlock`, `limitReset`, `modelWeek`, `limitsUnread`, the model). The reads with a free time are computed by the hub: `accountAt` from the posted account ledger, `limitReopenedAt` from the posted limits; `limitResetAfter` is a table by the sessions a limit stopped, because the call has side effects on the machine. `lastSession` is the hub's own launch journal.

- **The snapshot** of every connection replaces the mirror whole (`{boot, rev, facts}`: `boot` names the machine's process, `rev` grows with each post). Between snapshots the event `facts` carries the entries that changed (`patchOf`, `applyPatch`); one from another `boot` or not newer than the mirror is dropped.
- **Freshness.** The machine posts its facts before every `command.done`, so the mirror is never older than a result the chain acts on; every `PUBLISH_EVERY_MS` (5 s); and, in one process, before every step of the chain, every command and query of the page (`ServerDeps.catchUp`) and every reply to a session from the page, a tracker or the mailbox (`createChat`): `MachinePort.catchUp` has the machine post what changed and waits until the hub took it, so each reads the machine as it is now. A new entry point that reads the port outside a step catches up first. Without a connection `catchUp` does not wait. A machine elsewhere will have a mirror as fresh as its last event.

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
