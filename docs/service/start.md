# What applies on the fly and a slow start

## What applies on the fly

A restart is needed only for a new version of Even Keel (BTN-130). The service looks at the settings in its database (`ConfigStore`, `src/config-store.ts`) and at `.env` (`EnvFile`, `src/env-file.ts`), each every 2 s, and applies a change at once.

**The config.** Every key (`docs/settings.md`) applies live, whether the page saved it or `npm run storage -- config-import` replaced the settings (`docs/storage.md`):

- **A project added** gets its tracker, CI watches and packages.
- **A project removed** has its chain let go (`Dispatcher.forget`); its sessions are left as they are.
- **A key renamed** under the same `id` moves nothing, since the state names a project by its `id` (BTN-271): one log line.
- **A changed `repo` or tracker** rebuilds that project's tracker link (`Trackers.apply`) and CI watches (`CiWatches.apply`). A remote or a first workflow added to the same checkout gets its CI watch within a minute (`docs/ci.md`).
- **A smaller `slot`** keeps finding the slots busy tasks are in: the pool spans the most slots it had since the start (`slotSpan`).

**`.env`.** A variable the process got from outside the file stays as it was at the start. `envTargets` says who reads a changed one:

| Variable | What a change does |
| --- | --- |
| `EVEN_KEEL_ACCOUNTS_DIR`, `EVEN_KEEL_<AGENT>_ACCOUNTS_DIR` (`CODEX`, `OPENCODE`, `COPILOT`) | moves the account roots |
| `EVEN_KEEL_TOKEN` | changes the page guard and closes the open event streams, so pages ask for the token again |
| `EVEN_KEEL_HOST`, `EVEN_KEEL_PORT` | moves the page to a new server; the old one closes once the new one listens, a refusal keeps the old address and shows `server.rebindFailed` in the config banner |
| `TALLY_DB_*`, `TALLY_READER_*`, `TALLY_WRITER_*` | restarts the collector against the new database |

The trackers' credentials and the CI tokens are not in `.env` but in profiles: a changed profile rebuilds its tracker links and gives every CI watch a new source (`docs/trackers.md`, `docs/ci.md`). The sessions' environment is built at each launch (`AgentOptions.env`), so a removed key never reaches a new session.

**Start-only.** Read once; change them with a restart:

- `EVEN_KEEL_MCP_PORT` — live sessions have the gateway's address in their flags;
- `EVEN_KEEL_MACHINES_PORT` — the hub's listener for machines; whether it listens follows "Hub address for machines" live;
- `EVEN_KEEL_STATE_DIR` — the files and the database the service has open;
- `EVEN_KEEL_CONFIG` — the config file imported once at the first start (`docs/storage.md`);
- `CLAUDE_CONFIG_DIR`, `CODEX_HOME` — the `global`/`codex` account folders;
- `EVEN_KEEL_CPU_PROFILE` ("Diagnostics" below).

## Failed start and exit

`src/main.ts` is only the entry: it imports `src/start.ts`, the service's real start. When that import fails because a package is not installed (`ERR_MODULE_NOT_FOUND` "Cannot find package", `src/diagnostics/missing-package.ts`), it writes one line instead of a stack — `even-keel cannot start: the package <name> is not installed. Run \`npm install\` in <folder>, then start it again` — and exits 1; the host restarts it with its backoff (BTN-1239). Every package is resolved while the modules load, before a line of theirs runs, so the check cannot live inside `start.ts`.

`src/diagnostics/stop.ts` records `stopping: SIGINT`/`SIGTERM` before the shutdown. `start.ts` installs an `uncaughtExceptionMonitor` before storage starts: a fatal exception or unhandled rejection writes `stopping: uncaughtException`/`unhandledRejection` and the stack synchronously to stderr, and Node's fatal exit stays as it is. A missing stop line does not exclude SIGKILL, a machine shutdown or a native crash.

## HTTP/1.1 only

Right after that `start.ts` sends every `fetch` and `WebSocket` of the process over HTTP/1.1 through a global dispatcher of the `undici` package (`src/fetch-dispatcher.ts`, BTN-1227): Node 26's own fetch takes HTTP/2 where a server offers it, and its bundled undici crashed the service on a network failure with an `error` on an idle HTTP/2 stream nothing listened to.

## Diagnostics (BTN-680)

`src/diagnostics/start-watch.ts`, started by `src/start.ts` right after `.env` is read:

- **`start: modules … s, storage … s, service … s`** — once the service's top level is done: the time from the process start to `start.ts`'s own modules loaded, then opening and upgrading the storage, then `service.ts` (its imports and its wiring up to the timers).
- **`event loop: blocked up to N ms in the last 5 s (p99 M ms)`** — for as long as the service runs, a 20 ms timer measures the time between ticks. The tick that ends a five-second window records its last interval before reading the histogram and rotating the CPU profile, so a block that crosses the boundary stays in the window being reported. A window with a delay of at least 1 s gets a log line. A blocked loop also delays network probes and tracker timeouts.
- **`EVEN_KEEL_CPU_PROFILE=<seconds>`** in `.env` — the process profiles its own CPU through an in-process inspector session (no port opens) for that many seconds of the start, at most 600, sampling every 1 ms, and writes `logs/start-<time>.cpuprofile`. Remove the variable after the run.
- **`EVEN_KEEL_STALL_PROFILE=1`** in `.env` — continuous in-process sampling at 10 ms, opt-in, about 1% of one core ([`verified/platforms.md`](../verified/platforms.md)). A change takes effect at the next window boundary after the environment reloads; during a startup profile, at the first boundary after it. A window reaching the delay threshold is saved as `logs/stall-<UTC time>.cpuprofile`, at most once an hour per process. The log names the file, the delay and up to five active functions ranked by sampled self time across callers; Chrome DevTools or VS Code shows their stacks and the timeline. The newest 20 stall files are kept across restarts. Ordinary delay warnings go on during the cooldown and when profiling is off.

## What keeps a start fast

The profiles of the service (BTN-680, BTN-827 and their fixes; the numbers are rows of [`verified/platforms.md`](../verified/platforms.md)) left these rules, each of them once the fix of a stall of seconds:

- **Account folders** are listed once per synchronous pass, not by every account's limits and view (`AccountHomes.list` was O(accounts²)).
- **Session registries** (`TurnRegistry`, `SdkRegistry`) are read at most once a second, not on every sessions tick.
- **Transcripts** are folded in small slices under one budget per turn of the loop for all readers ([`sessions/agents.md`](../sessions/agents.md)), so the catch-up after a restart does not hold the loop.
- **The page's state** is built at most once per 200 ms and sent as patches after the first whole frame ([`web/interface.md`](../web/interface.md)); each build is still whole.
- **A lookup over the config's projects** (the demo's project, `samePath` with `realpath`) is done once per config object, never per task: a change replaces `projects` whole (BTN-848).
- **Tables rewritten often** are not rewritten on every tick (`session_windows`, BTN-951) and are vacuumed by the service itself, since PGlite runs no autovacuum ([`storage/database.md`](../storage/database.md), BTN-952).

What still costs time and has no fix planned: running `node --import tsx src/main.ts` from a checkout compiles the `.ts` files changed since the last start on the main thread (seconds after a pull, before `listening`, so it times nothing out); spawning `git` and CLI processes (a synchronous CreateProcess on Windows); the sessions monitor's tick, spread over its parts with none of them dominant. The stalls left under normal chain work are in [`verified/machines.md`](../verified/machines.md) (entry 210).
