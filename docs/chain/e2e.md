# Chain: end-to-end tests (`src/e2e/`, BTN-571)

`src/e2e/` runs the assembled service against a scripted agent; the level of real CLIs (`src/e2e-cli/`) is [e2e-cli.md](e2e-cli.md).

## Which files to run

A session runs before its merge only the files of the area it touched; the whole of `src/e2e/` runs on CI as a job of its own (`docs/ci/workflows.md`, "This repository's workflows"), and a scenario of another area broken by a merge shows up there as a red `main`. One file is `npx vitest run src/e2e/ci-fix`.

| Area | Files |
| --- | --- |
| the order, handoffs, cleanup after Done, restarts | `chain`, `restarts`, `returns`, `turns`, `cleanup`, `plain`, `continuation-prompt`, `push` |
| the service's start, `src/service.ts` wiring | `huly-client`, `restarts` |
| rebuilding a hub and restoring its running commit | `rebuild` |
| session records and context windows | `session-context` |
| questions, chat mail, pauses | `questions`, `mail`, `pauses` |
| project chats (`src/chats/`) | `chats` |
| labels, statuses, the tracker adapters | `labels`, `statuses`, `feeds`, `intake`, `builtin` |
| the CI, a red `main`, a shared remote, the sync, `commands.check` | `ci`, `ci-fix`, `ci-sessions`, `check`, `remote`, `remote-tasks` |
| PR mode | `review`, `feedback`, `feedback-chain` |
| carries of a release project | `carry`, `carry-agent` |
| limits and accounts | `limits`, `accounts`, `cloud` |
| the demo (`src/demo/`, `src/service/demo.ts`) | `demo`, `builtin`, `restarts` |
| machines elsewhere: the link, the pool's connection, the followed catalog | `elsewhere`, `own-plugins` |

A chain bug found live gets a scenario here besides its unit test, when the scripted agent reproduces it. A bug in the format of a CLI's output gets a sample instead (BTN-568); one in the live process of a particular CLI belongs to [e2e-cli.md](e2e-cli.md).

## Reading a failed run (BTN-1108)

A pipe into `tail` eats vitest's exit code and cuts the failures' details off, and a session that saw only "1 failed" used to rerun the whole suite for a name. `LastRunReporter` (`scripts/vitest-last-run.ts`) runs beside vitest's own reporters in every vitest run of the repository — `npm test`, the e2e scripts, a single file, CI — and leaves the exit code alone:

- **The last lines of the output** are a `FAIL file > suite > test` line for each failed test, a line for a file that broke outside its tests and for an unhandled error, then a `RETRIED file > suite > test: <first failure>` line for each test that passed only on a retry, then the verdict `vitest: passed|FAILED|INTERRUPTED — …` with the counts ("1 passed only on a retry" among them). At most twenty lines, the failures first, so `| tail -3` names a single failure and a green run is one line.
- **`.temp/vitest-last.json`** of the working folder (each worktree has its own) keeps the totals and every failure with its message, stack and diff, and `retried` with the errors of the failed attempts of a test that passed on a retry: read it instead of rerunning. The next run of any scope overwrites it.
- **Timeouts.** Only the macOS e2e job retries, and only a timeout (`E2E_SLOW_RUNNER`, `docs/ci/workflows.md`, "macOS"). A scenario's own timeout is written `{ timeout: scaled(60_000) }` (`test/slow-runner.ts`), never a bare number: `test/slow-runner.test.ts` fails on one in `src/e2e/`.

## The scope

The unit tests of `src/chain/` go through `setup()` of `dispatcher.fixture.ts`, where every dependency of the dispatcher is a fake. `src/e2e/` runs the assembled service instead: `src/main.ts` imported as the service starts, real git in a temporary folder (worktrees, merges, cleanup after Done), the real PGlite state database, the service's own HTTP server for the page's commands.

- The scenarios are out of `npm test` (BTN-699): `npm run test:e2e` runs them alone, `npm run test:all` both.
- The scope sits in `vitest.config.ts`, not in the scripts (BTN-1108): `src/e2e/`, `src/e2e-cli/` and `src/e2e-trackers/` stay out of every run unless an argument of the run names the folder (`excludedEndToEnd`, `scripts/vitest-scope.ts`). So a bare `npx vitest run` runs what `npm test` does, while `test:e2e`, `test:cli`, `test:trackers`, a single file and the CI jobs still reach theirs; `test:all` keeps `src/e2e/` in through `--mode all`.
- Vitest runs files side by side, not the scenarios inside one, so a file is kept to about two minutes and split by topic past that (BTN-699; the shared setup of split files is in `redmain.fixture.ts` and `carry.fixture.ts`). Inside the whole suite a scenario runs about twice as long as alone.

## The fixtures

- **`Harness`** (`service.fixture.ts`) prepares the folder, the config and the environment, imports the service on a fresh module graph (`vi.resetModules`) and reaches it through `service` of `src/service.ts`; `restart()` closes it and imports it again on the same folder. `refused(command, body)` posts a page's command the service is to refuse and returns its notice; `answer(command, body)` returns its JSON.
  - **The clock.** The timers and `Date` are fake. `until` moves the clock step by step and after each step waits in real time while git or a file read is under way (`process.getActiveResourcesInfo`): without it, on a loaded machine the clock runs ahead of a tracker refresh that has not come back and the scenario times out. A step ends once neither has run for 2 ms, polled by `setImmediate` (a timer of a few ms lasts ~15 ms on Windows). None of the service's own git runs on every tick (BTN-700): the CI watch reads the remote's main every 5 s, the work poll lists worktrees every 15 s, the remotes are read every minute.
  - **Long waits.** A scenario's real time grows with its steps, not with the service's time it covers, and the import of the service takes up to a minute next to other files. So a long wait goes in big steps (10 minutes) up to a little before the moment it checks and in minutes from there, and waits no longer than the logic needs (BTN-676).
- **`Board`** (`tracker.fixture.ts`) is the tracker: an adapter registered in `ADAPTERS` under `board`, its tasks in memory, `blockedBy` for the order, comments per task. It has the optional parts of `TaskSource` the chain uses (BTN-672): labels, statuses moved by the user (`move`) or the service, subtasks, a `complete` into a named done status. Scenario flags make calls throw (`refuseComplete`, `refuseRelabel`, `failReads`); `create` files `<KEY>-101` and on in Todo; `keys` gives each project only its key's tasks, so two projects share the board.
- **The forge and the CI** (BTN-664). With `Harness.forge` the checkout is a clone of a bare repository `remote`: its `origin` is an address where nothing listens, and `url.<bare>.insteadOf` leads git to the bare repository while the service reads a Forgejo remote (a committed workflow and `FORGEJO_TOKEN` make the profile). `GIT_CONFIG_GLOBAL` points at a file of the bench, so the sync after Done is the built-in fetch, merge and push, not the machine's `git sync` alias, and the machine's hooks path is out of the way. `Ci` (`ci.fixture.ts`) replaces the Forgejo adapter in `CI_SOURCES`: one run per new head of a branch, its status from `outcome(subject, commit)`, `finish` ends a run under way; a poll without a branch (PR mode) makes the runs of every branch.
- **Pull requests** (BTN-683, BTN-688). `Pulls` (`forge.fixture.ts`) answers as the Forgejo API through its own `fetch`, and the start puts the real `forgejoPulls` over it into `FORGES`, so trust by access runs the adapter's own code. Heads and mergeability come from the bare repository; `merge`, `close`, `comment`, `review`, `access`, `refuse` (the next opening's HTTP status) act on it. `Harness.githubPulls` is a second `Pulls` answering as api.github.com over `githubBare`, with `access` as `author_association` and `bots` as app accounts.
- **More projects.** `Harness.second` adds `DEF` (`SECOND_ID`), another clone `repo2` of the same remote; `Harness.release` adds `REL` (`RELEASE_ID`), a clone on `release/v0.1` with `mergeInto` `ABC` (BTN-684). `start(prepared)` runs `prepared` once the checkouts are ready, before the service reads them. `Harness.config` holds top-level config keys such as `parallel`.
- **Feeds and GitHub** (BTN-673). `Harness.feed` gives the project a feed `GHI` (`FEED_ID`) on a second board `Harness.lane` (adapter `lane`, `LANE_TOKEN`). `Harness.githubRemote` adds a `github` remote led to `githubBare`, and `GitHub` (`github.fixture.ts`) stands in for the global `fetch` toward api.github.com: issues, labels, comments with `author_association`, tags, releases, `/user`; any other address goes to the real `fetch`.
- **`ScriptedAgent`** (`agent.fixture.ts`, core `src/agent/scripted.ts` shared with the demo's agent, BTN-776) is registered in `AGENTS` for Claude in place of every provider; with `Harness.codex` it plays Codex too, on `CODEX_ACCOUNT` (off by default: a second account is read on every step). Each launch or resume plays the task's next turn from `script(task, ...turns)`: real git in the session's folder, ending as a transcript would — a reply, a question, a limit, `CHECKPOINT:`, `NO CHANGES:`, `TASK DONE` (`done`), PR mode's mark (`pullRequest`, `forReview`) or a crash. `parked(gate, turn)` holds a turn mid-turn until the gate opens; `TurnContext.background()` ends it in `shell`. Each `Call` records the account folder, the agent and the model; a busy session is listed with `silentSince`, hung past `TURN_HANG_MS`.
- **Limits and accounts** (BTN-663). `ScriptedAgent.windows(account, at)` gives a `usage` by the bench's clock (`'missing'` for a provider with none, `null` for an unreadable answer); `usageGate` holds every `usage` call; `TurnContext.limits` reports windows mid-turn; a turn may end in `credit`. `statuses` sets what a sign-in shows; `Harness.spare` adds `SPARE_ACCOUNT` to switch to. The network check before an account's call is mocked, and each start waits for the MCP gateway's line, so a restart right after a start does not find its port still held.
- **A machine elsewhere** (BTN-1306). `Elsewhere` (`elsewhere.fixture.ts`) is a second installation in the bench's process, assembled as `src/machine-service.ts` does, with its own state, accounts, packages, gateway and link to the hub's door for machines (`EVEN_KEEL_MACHINES_PORT`); it shares the hub's module graph, so the scripted agent and the fake clock are the bench's. It needs `Harness.forge`; `prepare` leads its clones to the bare repository and gives them a git identity, `join` joins by a connection string, `Harness.checkouts` lets the agent find the machine's clone; stop it before the hub. The agent lists a session only to the account folder it was launched in: otherwise the hub's folder of the same key would read a machine's session as its own.

## The scenarios, by file

- `chain`: the `blocks` order with cleanup; a question answered from the chat; a limit waited out; a limit past a cold cache handed over (`relay`, `limit`); a checkpoint handoff with its note; a handoff past a session that failed before answering, with the note the hub kept (BTN-1046); a session found mid-turn at cleanup stopped after its turn; `NO CHANGES:`.
- `push` (BTN-1270, BTN-1274): the task's branch on the remote after a handoff and on a mid-task `AskUserQuestion`, gone after Done.
- `restarts`: a merge while the service is down; a restart mid-session; a task done before and right after the first read of the sessions; "Stop" before that read waits out the turn (BTN-1610). Trap: the halt's `vi.clearAllTimers` rewinds the fake clock to its start, so a scenario whose timing spans a restart sets the clock on in `restart`'s `between`.
- `continuation-prompt`: `modelPrompts` and the unattended rule in a launch's and "New session"'s prompt, in neither a chat answer's resume after a restart.
- `session-context`: the context window of a turn served after Done, with no probe.
- `huly-client` (EKR-52): a start with Huly variables and no Huly client asks for the install, again after a restart without the variables.
- `returns`: a task back from its blocker, from Skip → Unskip, from Backlog after a question (BTN-245), and from Done after an early merge (BTN-689).
- `questions`: a question answered by a tracker comment; one kept open through a restart and answered from the chat.
- `mail`: chat mail taken mid-turn once, left mail sent by a resume, mail around the merge, a refused delivery and its retry, mail after `chain/stopAfter`.
- `chats` (BTN-1653): a cold chat session stopped and resumed by the next message; a fourth chat past `chatSessions` stops the longest idle one.
- `pauses`: a chain started paused for an unseen tracker and for a package lacking its key, each going on once fixed.
- `labels`: a task's run (BTN-983), `run.modelWithoutProvider`, `chain.unknownModel` before any launch, `chain.requiredLabels` with `task/ready`/`task/unready`, `task/labels` and `task.relabelFailed`.
- `statuses`: `statusMoves.start`; a refused `complete` retried every 30 s; parents closed after their subtasks (BTN-1235); Backlog → ready taken in; a tracker failing every read.
- `turns`: "New session" on a quiet turn around `TURN_RESTART_MS` and `TURN_HANG_MS`; `NO CHANGES:` (BTN-637) and `CHECKPOINT:` (BTN-959) on a turn that ended in `shell`.
- `plain`: a project without git (BTN-883) — two tasks in one folder closed by their marks; "Stop after the turn" (BTN-1044); a start after "Stop" closing a marked ended session without a second launch.
- `cleanup`: `project.removeBlocked` while the chain and its session live; on Windows, a worktree path past 260 characters removed.
- `ci`: the next task only on a green push; a queued run past `STUCK_MS` (BTN-719); a run kept watched through a failed poll (EKR-136); `commands.afterGreen` once per green push (BTN-707); a remote added while running (BTN-685).
- `check` (EKR-103): `commands.check` with no CI — `main` checked in the next task's place, or green by the hook's report.
- `ci-fix`: `ci.fixTask`; a red main under a session — handed over, resumed warm, kept warm through a long fix (BTN-1616); `ci.fixFailed`; no e-mail (BTN-537); a fix's `NO CHANGES:` closed after a fix by hand (BTN-1328); `ci.rerunFailed` (BTN-846).
- `ci-sessions`: a session whose branch is in `main` left alone; a task launched just before the red verdict (BTN-550); a session on its question left alone.
- `remote`: two projects on one remote — one fix, `ciWait.by`, `main` fast-forwarded after it; the fix dropped by "Skip"; a fix session stopped from outside.
- `remote-tasks`: a fix task closed by hand with no push; two projects of one key split by milestone (BTN-685); a sync rejected by a push between fetch and push, or inside the push (BTN-686).
- `review`: PR mode — merged, closed unmerged, nothing to open (BTN-222), `review.noRemote`, `review.denied`, a push refused by a hook (BTN-715), a branch moved on the forge (BTN-716).
- `feedback`: a review and an owner's comment brought by a resume, a red run of the head, remarks by access, a conflict with `main`; on GitHub bots, outsiders and collaborators (BTN-688).
- `feedback-chain`: a remark past `WARM_CACHE_MS` handed over; an ended chain started again by a remark; a stopped one kept stopped.
- `carry`: a fast-forward and a merge commit pushed; `forward.failed` without an identity; `forward.conflict` held until a merge by hand; a refused push kept as `last.push`.
- `carry-agent`: the `REL-CARRY` session through a restart to its merge; `carryAgent`; unattended mode letting it go and a new release fix asking again (BTN-692).
- `limits`: an early reset; the first poll after a restart and the kept snapshot's age; windows reported mid-turn (`source: 'sdk'`).
- `accounts`: credit held 30 minutes then `relay` on `account/switch`; a limit with no reset; no windows told; a switch; no e-mail.
- `cloud` (BTN-824): a Microsoft Foundry account checked by a one-off turn, `cloud.azureCredentials`, `account.foundryEndpoint`, `account.foundryModels`.
- `feeds`: a feed's tasks beside the project's own, questions and closes in their own tracker.
- `intake`: GitHub issues made tasks, comments by association, `review.outsiderFiles` (BTN-1207), release comments and closes.
- `builtin` (BTN-767): two tasks filed and linked through `builtin/*`, run in order and closed in the database.
- `elsewhere` (BTN-1306): a task run in a machine's clone with its packages; "Stop" through a hub restart with the machine off the link (BTN-1610); a task pinned to a machine (BTN-1623); a page chat on a machine (BTN-1694).
- `own-plugins` (BTN-1689): an older seeded `agent-bridge` replaced on the hub's own machine, left on a machine elsewhere.
- `demo` (BTN-776): the demo on its real agent through a restart, a chat answer and the end card; `demo/remove`; `demo/again` in Russian; the demo without git (EKR-108).
