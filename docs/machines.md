# Hub and machines

The hub decides, a machine runs the sessions; the map of the roles is BTN-137. Two steps of it are in the code: the seam between the two roles inside the service ("The seam") and the transport that will carry it (`src/link/`, the rest of this document). **Nothing starts the link yet:** the service neither listens for machines nor connects to a hub, there is no setting and no port, and the hub calls its one machine directly, in the same process.

## The seam

One installation is a hub and a machine in one process, and there is one code path: the chain (`src/chain/`) reaches sessions, accounts, packages and working folders only through `MachinePort` (`src/machine/port.ts`), which `DispatcherDeps.machine` carries. `wireMachine` (`src/service/machine-chain.ts`) is its only implementation; `wireDispatcher` (`src/service/chain.ts`) builds the hub's side and takes the port as an argument.

| Side | In the chain | In the service's assembly |
| --- | --- | --- |
| Hub | `Dispatcher`: order, the queue and its fill, pauses, skips, released and shelved tasks, `MainCheck`, `MainFix`, `MainWait`, `MainCarry`, `Reviews`, `TaskLists`, `Cleanups`, `Unchanged`, questions to the tracker; the rest of `DispatcherDeps` and `MainCheckDeps` (`hubMainDeps`): projects, rules, `parallel`, the chain's state, statuses and comments in the tracker, the CI of main, PR mode | `src/service/hub-bootstrap.ts`, `src/service/chain.ts`: the state database, tracker and CI profiles, projects and settings, the page, Tally |
| Machine | `src/machine/`: `MachineTasks` with `startTask` and `inTurn` (`start.ts`), `Handovers` (`handover.ts`: limit, resume, relay, checkpoint), `OverageStops` (`overage.ts`), the git and check side of the CI of main (`mainMachineDeps`, `main.ts`) | `src/service/machine-bootstrap.ts`, `src/service/machine-chain.ts`: accounts and limits, packages and the MCP gateway, slots and worktrees (`wirePlaces`), the session monitor, the launch journal for the slots' occupants, keep-warm |

- **A member of the port** is a command, a query or a snapshot field; the comment of each in `port.ts` says which. A command (`launch`, `launchFix`, `launchCarry`, `resume`, `reply`, `relay`, `stop`, `finish`, `sync`, `prepare`, `checkMain`, `runAfterGreen`) will be a numbered command of the link with its result as an event; a query (`locate`, `head`, `tree`, `merged`, `carried`, `changes`, `history`, `modelBlock`) changes nothing on the machine; the facts (`liveSession`, `lastSession`, `busy`, `midTurn`, `shell`, `asked`, `silentSince`, `limited`, `overage`, `handoff`, `modelRefusal`, `sessionsRead`, `reportedTree`, `account`, `accountAt`, `launchBlock`, `limitReset`, `modelWeek`, `limitResetAfter`, `limitReopenedAt`, `limitsUnread`, `accountsRead`, `packagesBlocked`, `packagesPause`, `trackerMissing`) will be read from the hub's mirror of the machine's snapshot.
- **An action of both sides is the hub's decision and one call of the port.** A red main: `MainFix` decides, `stop` stops. The cleanup after Done: `Cleanups` decides and records the closed task (`archiveClosed`), `finish` stops the sessions and removes the folder. The report of a red main: the hub writes it, `history` gives the commits.
- **Every touch of a session is the same exception to invariant 1 as before** (`docs/chain/exceptions.md`), now made on the machine's side.
- **What is not cut yet.** `MachineTasks` runs inside the hub's serialized step and changes the chain's records in place: `MachineTaskDeps` (`src/machine/host.ts`) still gives it the hub's `save`, `journal`, `moveStatus` and `blocked`. With the link these become the machine's events and the hub's mirror; so do the machine's own state, the table of which machine has which task, and a machine apart from its hub.

## The link

How a hub and a machine talk (`src/link/`).

| File | What it holds |
| --- | --- |
| `protocol.ts` | the constants, the frames and posts, the connection token |
| `hub.ts`, `hub-store.ts` | the hub's end (`HubEnd`) and what it keeps in the state database |
| `machine.ts`, `machine-store.ts` | the machine's end (`MachineEnd`) and its own database |
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
- **A command runs at most once.** The machine records its number before the handler runs (`commandReceived`); a number at or below the last recorded one is a repeat and is dropped. A machine that stopped between the record and the end does not run the command again: at its next start it reports `command.interrupted` and the hub decides. So a command's handler must be safe to lose, not safe to repeat.
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

- **Hub:** the state database, step 51 — `machines` and `machine_commands` (`docs/storage.md`), through `DatabaseHubStore`.
- **Machine:** a PGlite database of its own with its own steps (`MACHINE_STEPS`, opened by `openMachineDatabase`, numbered like the state database's and never edited once merged): `outbox` (the unsent events), `commands` (the numbers taken, with the newest `KEPT_COMMANDS` finished ones) and `consents`. Where its folder lies, and whether a process that is hub and machine at once keeps it apart from the state database, is decided with the cut of the service.

## Tests

`link.test.ts` runs both ends over `Wire` of `link.fixture.ts` with fake timers: the hub away (`down`), a break (`cut`), a proxy that holds frames (`hold`, `release`), lost frames (`mute`), posts without an answer (`hang`) and answers lost after the hub took the post (`loseAnswers`). The stores there are in memory; the PGlite ones have `machine-store.test.ts` and `src/storage/database-machines.test.ts`. `carrier.test.ts` runs the real HTTPS carrier on loopback: the headers, the pin, the refusals. The stream through a real proxy was never run: `docs/unverified/machines.md`.
