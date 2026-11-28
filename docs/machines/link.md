# The link

How a hub and a machine talk (`src/link/`).

| File | What it holds |
| --- | --- |
| `protocol.ts` | the constants, the frames and posts, the connection token |
| `hub.ts`, `hub-store.ts` | the hub's end (`HubEnd`) and what it keeps in the state database |
| `machine.ts`, `machine-store.ts` | the machine's end (`MachineEnd`) and its own database |
| `local.ts` | the carrier inside one process (`LocalTransport`) |
| `cert.ts`, `identity.ts` | the hub's self-signed certificate and where it is kept |
| `hub-server.ts`, `machine-transport.ts` | the carrier: HTTPS, the stream and the posts |
| `address.ts` | the machines' port and the hub's address for machines as a URL |
| `hooks.ts` | the page's routes a session's hooks ask, the only ones carried by `POST /link/hook` |
| `view.ts` | the machine's report about itself and the page's view of a machine: types only, through `src/state.ts` |
| `link.fixture.ts` | the stores in memory and the wire with breaks, for tests |

## The two directions

The machine opens every connection, so a machine behind NAT needs no open port.

- **Down, hub → machine:** one long answer to `POST /link/stream`, server-sent events. A frame is `hello` (the handshake), `ping` (the hub's pulse) or `command`.
- **Up, machine → hub:** the posts below. `snapshot` and `events` are the link's own state; the rest are not numbered and not kept, so a lost answer is the caller's to repeat.

| Route | Body → answer | Notes |
| --- | --- | --- |
| `/link/snapshot` | what the machine holds right now | "Numbers and what is kept" |
| `/link/events` | the machine's numbered events | an empty one is the machine's pulse |
| `/link/mcp` | `{connection, request}` → `{status, headers, body}` | a session's request to an MCP server of the hub; counts as the pulse, and its failure leaves the connection alone ("MCP through the hub") |
| `/link/hook` | `{connection, request: {method, path, body?}}` → `{status, body}` | a session's hook asking the hub's page ("Hooks through the hub") |
| `/link/tally` | `{connection, rows}` → `{taken}` | the rows of the machine's Tally collector; the receipt is the machine's read mark (`docs/tally/collector.md`, "Machines elsewhere") |
| `/link/credentials` | `{connection, project, urls}` → `{credentials}` | the tokens of a project's HTTPS remotes for one git call (BTN-1541, `docs/ci/layer.md`, "Git over HTTPS") |
| `/link/git` | `{connection, project, request}` → `{status, contentType, body}`, bodies base64 | one smart-HTTP request of the machine's memory relay to the hub's `git http-backend` (BTN-1648, `docs/sessions/memory.md`, "The machines' copies") |
| `/link/join` | `{api, about}` → `{secret}` | a connection string's one join (`elsewhere.md`, "The door") |
| `/link/request`, `/link/request/answer` | `{api, about, nonce, public}` → `{request, expiresAt}`; `{request, nonce}` → `{machine, secret}` | a join by the hub's address alone, without a token (BTN-1620, `elsewhere.md`, "The request by the address") |

- **Credentials.** The machine keeps the tokens only in that git call's environment and asks again for the next, so a token never lands on its disk. The hub answers only for a project the machine has a folder of in `project_machines`, turned on or off (a connect checks the right to push before it turns the folder on), or that the hub's connect is cloning onto it now (`MachineNetwork.clones`); any other gets `[]` and a log line (`hubGitCredentials`, `src/service/git-credentials.ts`). The own machine asks the same through `LocalTransport`. No answer — the hub away or a refusal — and git goes on the machine's own credentials.
- **Git.** Only for a project the machine has a row of in `project_machines` or a folder bound to, else 403; `project: "config"`, the global configuration's repository, is open to every machine of the network (BTN-1690, `docs/sessions/memory.md`, "The global configuration").

Every request but the request by the address carries `Authorization: Bearer <machine id>.<secret>`. A refusal is JSON `{refused}` under a status:

- `token` 401: unknown, wrong or revoked;
- `version` 426: the API versions differ; the body is `{refused, api, evenKeel?, commit?}` — the hub's API version, its version of Even Keel and its checkout's commit — and never changes in a later API version, since a machine of any version must read it to catch up (`elsewhere.md`, "Catching up after a refusal");
- `connection` 409: the post names a connection that is no longer the machine's;
- `expired` and `used` 410: a connection string past its time or already joined with (`elsewhere.md`, "The door").

The handshake: the machine's `{api, host, lastCommand, about?}` is the body of the stream's request, `about` its report about itself (`MachineAbout`), kept by the hub on every handshake that has it; the hub's first frame is `hello` with `{api, connection, heartbeatMs, lastEvent}`. `API_VERSION` (`src/link/protocol.ts`) is 27 (since BTN-1806: a folder's spec carries the hub's remotes by name, `folders.probe` answers the ones a clone lacks, and `folders.addRemotes` adds them) and is compared before anything else; a change of a frame, a post or their meaning is a new version.

## MCP through the hub

BTN-990 keeps the keys on the hub. A server that holds a key runs only in the hub, and the machine's gateway carries its requests over the link (`McpGateway.throughHub`, `src/packages/gateway.ts`). Such a server has a key, a token or OAuth in its target, or it is a tracker whose deletes Protection refuses (`hubOwned`). The tasks server always runs in the hub, and so does the memory server (BTN-1029, `docs/sessions/memory.md`): the project memory is the hub's records, and its routes are always in `Packages.hubServers()`, so a machine's session of an agent without the CLI's file memory (Codex and others) reads and writes the same records as the hub's, each write with the version it read. A machine's Claude Code session gets no memory server and uses the machine's own memory folder (BTN-1647). Servers without a key, such as Playwright or a files server, run on the machine.

- **Two gateways in one process.** The machine's `Packages` gateway listens on `EVEN_KEEL_MCP_PORT`; the separate `PackageHub` gateway listens on a free port of 127.0.0.1, which only the link asks. The machine's gateway switches to the link before its listener starts (`LinkedMachine.start`). The hub reads the local package catalog independently, resolves its targets with its profiles and publishes only route names in the brief. The machine does not resolve keys for those routes; its probes ask the hub through the link.
- **The pool of machines decides the servers** (`HubMcp`, `src/service/hub-mcp.ts`):
  - The hub admits a machine only to the servers of the projects it is briefed: the own machine to every project of the hub, a machine elsewhere to each project with its row in `project_machines` (`placedIn`). Any other path gets 403.
  - A row turned off counts (BTN-1517): the machine keeps the project in its brief, installs and probes its packages (the connection's `machine-packages` step runs before `machine-enable`) and finishes the task it holds, its session's tasks and memory calls included.
  - `/tasks` with no project, the address of a session started by hand, is every machine's, and the tasks server checks each call instead (BTN-1573): the project a call names, by its `project` key or a task key's prefix, a feed's too, is looked up by its GUID (`TasksDeps.inPool` → `HubMcp.inPool`). A project outside the pool refuses that call — in a `task_update` of several keys only that task's line — while the rest go on. No tool lists the projects, so none can show one outside the pool.
  - A refusal means a machine taken out of the pool, asking until its next brief, or one asking what it was never briefed; the log has it once per machine and project until the machine is admitted there again (BTN-1325).
  - The hub reads the answer whole before it sends it back, so no stream is opened through the hub, and a GET is answered 405.
- **Files.** The machine's tasks server (`MachineTasks`, `src/taskmcp/machine.ts`) reads the files a call attaches from the session's folder and sends them in the call's `_meta` (`even-keel/session`, `src/taskmcp/carried.ts`). The hub returns the files `task_read` downloaded in the result's `_meta` (`even-keel/files`). The machine writes them into the folder's `.temp/task-files/` and puts their paths in place of the hub's tokens. The limit is `attachmentLimit` on both sides, and the hub never reads or writes a folder of the machine.
- **The handoff note.** For `handoff_write` the machine stamps the writer, the task's live session there, into the same `_meta`, and the hub's link adds the header `x-even-keel-machine`; the hub keeps the note only from the task's newest launch (`docs/sessions/checkpoint.md`, "The note kept with Even Keel").
- **The hub away.** A write (`task_comment`, `task_update`, `tasks_create`, `handoff_write`) is kept in the outbox as the event `tasks.write` with its files already read. The session is told that the call goes later and must not be repeated. The hub makes the write once it takes the event: an unreachable gateway throws, and the machine sends the event again; any answer of the tasks server, a refusal included, ends it in the log. A write waits for the outbox to drain before it goes, so it never overtakes a kept one. A read of the session's own task is answered from the machine's last read of it, otherwise from the brief its last start had (`Briefed.kept`). Other tasks and every other server's call get a tool error saying that the hub is unreachable, and other requests get a JSON-RPC error. `initialize`, `ping` and the tools list are still answered. Nothing here touches a session: it is the answer to the session's own call.
- **Server ownership without keys** (BTN-1238). The hub computes `Packages.hubServers()`: route paths for every retained install, including a task's pins. The tasks server is not in it: the machine's tasks server (`MachineTasks`) stands in for the hub's and carries the calls itself (the two bullets above). `GatewayHub.servers` supplies this serializable list to the machine, which checks it before resolving any target, so a hub route needs neither an installed local server nor the hub's keys. The list is carried in `hub.brief` and refreshed at catch-up; the machine reads its copy, never the hub's packages. Pool, OAuth and Protection changes are reflected in the next list.
- **The catalog of a machine elsewhere** (BTN-1299). Its `state/packages.json` follows the hub's: the brief's `packages` (`CatalogBrief`, `src/packages/follow.ts`) carries every package of the hub's catalog not removed, each with the hub's current install, and the machine's projects' sets — one its projects have off too, since a project chat may turn it on for itself (BTN-1741), and the set, not the catalog, decides what a session gets. A machine serving no project gets none; the own machine gets none, as it shares the hub's file. `Packages.follow` takes the definitions and replaces the sets, marks every other package removed (the built-in one stays) and installs each hub install it lacks under the hub's id (`materialize`): a plugin copied from the machine's own marketplace, a pinned server at the hub's npm version, nothing for a server the hub runs for every project there. The same id is what makes a hub route the machine's session asks name the install the hub resolves. A failed install is tried again by a brief ten minutes on; a new set or a hub Update comes with the next brief. The settings of a package whose servers all run in the hub stay there. The connection's step `machine-packages` refuses a project whose tracker's server no package brings (`pool.packagesNoTracker`). End to end, from the connection to a task done on the machine: `src/e2e/elsewhere.test.ts` (BTN-1306, `docs/chain/e2e.md`).

The brief a launch carries is in `seam.md`, "The launch brief".

## Hooks through the hub

BTN-1260. A session's hooks (`plugins/agent-bridge/hooks/evenkeel.mjs`, the trackers' calibration hooks) ask Even Keel's page at `EVEN_KEEL_URL`: the checkpoint and the note, the checks, the standards, the chat's mail, the permission requests and a project's calibration. A machine elsewhere has no page, so its process answers them with the hub's.

- **The receiver.** `HookReceiver` (`src/machine/hook-receiver.ts`) listens on 127.0.0.1 at the page's port (`EVEN_KEEL_PORT`), or on a free port when another process holds it (the log says which); `assembleMachineHost` gets its address as `listen`, so the sessions are given it. It:
  - turns away a request with an `Origin` or a `Host` that is not loopback (403);
  - answers `GET /api/state` itself with the machine's own accounts panel (the settings guard of its account folders reads it);
  - keeps `POST /api/sessions/<id>/inbox` on the machine (`MachineHost.inboxes`, BTN-1322): the inbox socket's token never goes over the link, and the hub's page takes the route from loopback only (`docs/sessions/chat.md`);
  - sets the mail hook's `inbox` flag on the hub's answer by the machine's own `Inboxes` (BTN-1506);
  - answers `POST /api/sessions/<id>/permission` by the machine's own `Approvals` (BTN-1769): its monitor puts the call to the user as the session's ask, so a call held on the hub would never show; 400 for a bad body, 404 for a session or call the machine does not serve;
  - carries only a route of `hookRouteOf` (`src/link/hooks.ts`) through `MachineEnd.hook`; any other path is 404, a body over 1 MiB is 413.
- **The hub away.** No connection, a failed or refused post: the receiver answers 503 at once, and each hook does what it does when Even Keel does not answer (nothing; the permission hook keeps asking). `HOOK_TIMEOUT_MS` (1.8 s) bounds the post's connection and answer, under the hooks' own 2 s (5 s for the mail and the note); a late answer is logged as `no answer from the hub in 1800 ms` (BTN-1634: over TLS the request's own error said only "socket hang up").
- **The hub's side.** `HubHooks` (`src/service/hub-hooks.ts`, `peers.hook` in `machine-link.ts`) checks the route again and refuses (403) a session another machine holds: the hub's own machine by its page's sessions, a machine elsewhere by its mirror (`MachineNetwork.holderOf`). A session no mirror shows yet is let through, since the mirror lags the launch. It asks the hub's own page (`localUrlOf(listen)`) the path as a session of the hub's machine would; no page is 503, a failed request 502.
- **Not kept.** As `/link/mcp`, a hook's request is not numbered and not kept, and it counts as the machine's pulse. The chat's mail is marked delivered when the hub's page answered the hub, so an answer lost on the link loses that message's delivery into the session.
- **A fallback port.** On a free port instead of `EVEN_KEEL_PORT` the sessions get the right address, but the settings guard of the account folders (`src/account/share.ts`) still names the port of the environment.

## Numbers and what is kept

- **Commands** are numbered per machine by the hub (`machines.last_command`) and kept in `machine_commands` until the machine names their number as taken: in `lastCommand` of its handshake and of every post. At a connection the hub sends, after `hello`, every kept command above the machine's `lastCommand`. All of one machine's work on the hub runs in the order it was called (`queued`), so a command sent during a reconnect never overtakes the ones sent again. A command sent from inside the machine's own turn — a handler of its event or snapshot, such as the take-over of a folder marked by a revoked machine — is part of that turn and is not queued again (an `AsyncLocalStorage` of the turn): queued behind the post that waits for it, it stood the machine's queue for good, every later post and `open` with it (BTN-1555). Work a turn leaves running past its end is queued as usual. A handler still must not await a command's result: that comes in a later post.
- **A command runs at most once.** The machine records its number before the handler runs (`commandReceived`); a number at or below the last recorded one is a repeat and is dropped. Commands are taken in order; a handler ends before the next command is taken unless the machine is `concurrent` (`seam.md`, "The chain over the link"). A machine that stopped between the record and the end does not run the command again: at its next start it reports `command.interrupted` and the hub decides. So a command's handler must be safe to lose, not safe to repeat.
- **Events** are numbered by the machine (the `outbox` table's identity) and kept there until the hub's answer names their number in `lastEvent`. The hub takes an event once: one at or below `machines.last_event` is dropped; a handler that throws leaves the event and the ones after it untaken, and the machine brings them again with its next pulse. Events go in order, `EVENT_BATCH` a post.
- **The snapshot** is not an event and has no number: it is the state now, posted first on every connection, before any event, and never queued. The hub reconciles what it believes about the machine with it.
- **The body limit** (BTN-1559). A post but an MCP call is at most `MAX_BODY_BYTES` (8 MB, `protocol.ts`); the hub answers a larger one 413 with a line in its log (the path and the declared size), but cuts the connection mid-body, so the machine mostly saw only `ECONNRESET`. The transport therefore never sends a larger body: it throws `TooLarge` with `partsOf(body)` (`src/link/body-size.ts`), the sizes of the body's parts level by level down the largest one (events by type, then into the largest event of the largest type, so a `facts` event names the sections of its patch and their keys), and takes a 413 the same way. An events post over it goes again in halves; a single event over it alone is dropped with a line in the log — it would hold back every event after it, and the next snapshot tells the state. A snapshot over it is told once in the log with its parts, the notice `link.tooLarge`, and tried again at the 30 s pace until one fits.
- **The hub hears of a snapshot over the limit** (BTN-1560). Without a snapshot the hub took the machine for online and silent: its calls waited for answers that never came, and the hub's page said nothing. So at every try such a snapshot fails, the machine appends the event `snapshot.tooLarge` (`SnapshotTooLarge`: `bytes` and `parts`) to its outbox and posts the outbox on that connection before it drops it (`MachineEnd`, `tellTooLarge`); a hub restarted meanwhile learns it at the next try. The hub (`MachineNetwork.stateOverLimit`) logs `machines: machine … cannot send its state to the hub` once with the parts, keeps `{ bytes, since }` in memory (`stateTooLarge`), lets the waiting service calls go with `machines.tooLarge` (`RemoteMachine.refuseServices`, only the types of `SERVICE_TYPES`: port commands, the brief and limits keep waiting) and refuses new ones and the pool's folders with it. The machine's card is `blocked` with the reason `state`, its page has a band with the size. The next snapshot taken clears the mark with the line `… sends its state to the hub again`. A new event type, no API bump: an older hub drops it with a line in its log.
- One machine has one connection. A new stream of the same machine closes the older one, whose posts are then refused with `connection`.

The machine's store belongs to its connection token. If the hub has taken more events than the store ever numbered (the store was made anew under an old token), the numbering jumps past the hub's `lastEvent`; events written before that first handshake are lost, so a machine set up anew takes a new token.

## Pulse and reconnect

- The hub writes a `ping` frame every `HEARTBEAT_MS` (20 s); the machine posts its events, or an empty post, at the same pace. The pace is the hub's: the machine takes `heartbeatMs` from `hello`.
- `MISSED_PULSES` (2) intervals without a frame — the machine closes the stream and connects again; the same time without a post — the hub closes the machine's connection (`handlers.offline`). The lock of main goes with this connection (`docs/chain/main-ci.md`, "The lock of main").
- A post that fails or times out breaks the connection too: the machine does not go on over a link that carries one direction only.
- The pause before an attempt is 1, 2, 4 … 30 s and starts over at 1 s after a handshake. After a refusal of the token or the version the machine keeps trying at the 30 s pace: the token may be issued again, the hub updated.
- A machine without its hub keeps what it has to say in the outbox and goes on; what it does meanwhile is in `seam.md`, "Moves without the hub".

`MachineEnd.status()` is `{state, notice?}`: `offline`, `connecting`, `online` (the snapshot was taken), and a message code for the machine's page — `link.token`, `link.version`, `link.buffered`, `link.tooLarge`.

## Behind a proxy

A reverse proxy, a corporate proxy or an antivirus that inspects HTTPS may hold a streamed answer in its buffer. The connection is then alive, the hub writes its pulse, and the machine sees nothing: by the pulse alone that is a break, a reconnect, and the same again forever.

- The stream's answer carries `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` (nginx turns its buffering off for that answer by itself), the headers are flushed at once, Nagle's algorithm is off and each frame is one write.
- The machine tells the case apart: the connection opened and **not one frame** came over it in two pulse intervals — `link.buffered` and one line in the log, not only a quiet reconnect. The notice stays through the reconnects and goes with the first `ping` that arrives: the handshake alone could be the proxy's first flush.
- An idle timeout (about 100 s on a Cloudflare tunnel, `proxy_read_timeout` 60 s on nginx) is covered by the pulse in the stream itself, which is more frequent than either.

The guide ("A machine of a hub", "Behind a proxy") tells the user the same: buffering off and a long read timeout, for nginx `proxy_buffering off; proxy_read_timeout 1h;`. A proxy that ends TLS shows the machine its own certificate, so only a token with an empty fingerprint passes it (below).

- **The switch.** The window "Add a machine" issues such a token with its switch "Behind a proxy with a public certificate" (BTN-1286): `machines/invite` with `proxied: true`, and `MachineNetwork.invite` leaves the fingerprint out and reads an address without a port as 443, the proxy's, not `EVEN_KEEL_MACHINES_PORT`. The switch is not a setting: the browser keeps its last state (`even-keel.machines.proxied` in `localStorage`), and a string issued without it is pinned as before.
- **The door stays HTTPS.** The hub does not listen differently behind such a proxy: the door keeps the self-signed certificate on all interfaces, and the proxy goes to it over HTTPS without verifying (nginx by default, a Cloudflare tunnel with `noTLSVerify`, Caddy with `tls_insecure_skip_verify`). A plain HTTP door on loopback for a proxy on the same computer was weighed and left out: one more listener and a door without TLS for a gain the HTTPS one already gives.

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

A refused command is reported as the event `command.refused` with its number, type and reason; a handler's throw as `command.failed`. So a hub in the wrong hands gets the agreed folders, not the machine's disk. Consent is given on the machine (`MachineStore.agree`), by whatever connects a project to it; a hub's command cannot give it, with one exception the machine itself chose:

- **The folder of projects.** A machine that joined a hub agreed to one folder at `join` (`--root`, by default `projects` in the user's home), kept in `identity` as `root`. The hub's `projects.assign` (`ASSIGN_COMMAND`, `{project, folder}`) is agreed to by the machine itself when the folder is inside that root — the consent is recorded and the command runs — and refused `folder` otherwise; a machine with no root refuses it `project`. So the hub can give a machine a project, never a folder outside what its owner named.

## The stores

- **Hub:** the state database, step 51 — `machines` and `machine_commands`, step 52 — `project_machines` and `machine_tasks`, step 55 — `machines.invite_expires`, `joined_at` and `about` (`docs/storage.md`), through `DatabaseHubStore` and `Assignments`.
- **Machine:** a PGlite database of its own in `state/machine/` (`MACHINE_STEPS`, opened by `openMachineDatabase`, numbered like the state database's and never edited once merged). The link's tables: `outbox` (the unsent events), `commands` (the numbers taken, with the newest `KEPT_COMMANDS` finished ones), `consents` and `identity` (the connection token, and after a `join` the hub's address as `hub` and the folder of projects as `root`). It is not in the backups: lost or out of step with the state database, it is made anew with a new own machine. The later steps' tables: `seam.md`, "The machine's stores".

## Tests

| Test | What it checks |
| --- | --- |
| `src/link/link.test.ts` | both ends over `Wire` of `link.fixture.ts` with fake timers: the hub away (`down`), a break (`cut`), a proxy that holds frames (`hold`, `release`), lost frames (`mute`), posts without an answer (`hang`), answers lost after the hub took the post (`loseAnswers`); the one-time string (joined once, expired, reissued, opening nothing else) and the consent by the root |
| `src/link/machine-store.test.ts`, `src/storage/database-machines.test.ts` | the PGlite stores (`link.test.ts` keeps its stores in memory) |
| `src/link/carrier.test.ts` | the real HTTPS carrier on loopback: the headers, the pin, the refusals, a join over HTTPS, "a request to join by the address" |
| `src/machine/remote.test.ts` | `RemoteMachine` and `MachineRunner` over the same `Wire`: a break between a launch and its result, a launch command that comes twice, a machine stopped mid-launch, the mirror against the snapshot of a new connection, a brief handed over, the task folders mirrored |
| `src/machine/alone.test.ts` | the link broken under a limit: the machine continues the session by itself, after a restart too, and the hub back takes the new session without moving it again |
| `src/machine/services.test.ts` | the services: an account notice back by its code, a file carried whole, a reply's files refused outside the agreed folder, the initial records |
| `src/service/hub-brief.test.ts` | a brief built, read back through `BriefCopy` and sent only when it changed |
| `src/machine/state.test.ts` | the machine's stores moved once |
| `src/storage/database-machine-tasks.test.ts` | step 52: the own machine on the sample of the step before, the assignments |
| `src/storage/database-machine-join.test.ts` | step 55 |
| `src/service/machine-network.test.ts` | the listener by the setting, the offered addresses, the join, the attachment to a project; a `MachineEnd` over `httpsTransport` into its own mirror, brief and limits |
| `src/machine/join.test.ts` | the refusals of `even-keel join` |
| `src/link/join-code.test.ts` | one certificate and nonce give one code on both sides, another certificate another |
| `src/link/join-requests.test.ts` | the request by the address: the expiry, `busy`, `full`, decline |
| `web/src/machineAdd.test.ts` | the page's side of the request (`shownRequests`) |
| `src/service/machine-process.test.ts` | the claim and `contactAt` |
| `src/e2e/` | the assembled service over the link in every scenario |

What no test covers live: `docs/unverified/machines.md`.
