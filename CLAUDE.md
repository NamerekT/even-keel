# Even Keel

Formerly called Baton (Батон): that is how it is recorded in old commits, tasks and memory; the Huly key `BTN` and the `btn-*` branches stayed.

A dispatcher of Claude Code session chains. It takes a project's open tasks from the tracker, builds the order from `blocks` relations, starts a session on the first task and, when the task goes to Done, starts the next one. A web page shows the chain and, for each session, the stage, the current action and how full the context is. It runs as a service on the user's workstation: agents are launched only here.

The global rules from `~/.claude/CLAUDE.md` apply in full. Below is only what is specific to this project.

## Documentation

This file holds the rules and traps needed in every session. Reference on how things are built is in `docs/`; read the document for your area before working in it:

| Document | What is in it |
| --- | --- |
| `docs/chain.md` | entry into the chain, order, task worktrees, cleanup after Done, why one folder holds one project, "slot" mode, the exceptions to invariant 1 in detail, state files and their schema version |
| `docs/storage.md` | the state database `state/even-keel/` (PGlite): its owner and port, tables, schema steps, the import of the SQLite file and the v0.1 files, backup and export, readers outside the service |
| `docs/trackers.md` | the `src/tracker/` layer, the Huly, GitHub and Linear adapters, `brief`/`complete`, Claude Code plugins |
| `docs/ci.md` | the `src/ci/` layer, the Forgejo and GitHub Actions adapters, which remote gets a CI, polling, Forgejo API traps |
| `docs/sessions.md` | the `claude` CLI, transcripts, the model by label, prompt assembly, limit polling |
| `docs/packages.md` | plugins and MCP servers of a project's set, `state/packages.json`, install and update, the keys, the local MCP gateway, the launch flags, the check before a launch |
| `docs/accounts.md` | account folders, sign-in and switching, the apps panel, transferring the shared configuration |
| `docs/web.md` | the interface, translation (`language`, message codes), live config, `dev:fake` parameters |
| `docs/settings.md` | every setting and the levels it is set at (Even Keel, project, task label), what is not a setting, the settings tables for the database and how labels become values |
| `docs/stats.md` | the `/stats` page, its routes and URLs, rule changes; the collector is in `tally/CLAUDE.md` |
| `docs/service.md` | the service on Windows, Linux and macOS |
| `docs/releases.md` | the branches `main`, `dev` and `release/*` and their folders, the trackers `BTN`, `EKR` and GitHub issues, a fix and its way into `dev`, a release as a push to `main` and a tag, the switch at `v0.1.0`, the CLI check, Tally across clones |
| `docs/guide/` | the user guide behind the README: every feature, setup and updating, every variable and config key — public, see below |
| `docs/unverified.md` | behaviour never checked live, linked from the README: what is assumed, what breaks if it is wrong, the workaround |
| `docs/posts/` | drafts of posts about the project, each with a `.sql` of the Tally queries behind its numbers; the user publishes them |

Behaviour written without a way to check it live (the situation never came up or cannot be created) gets an entry in `docs/unverified.md` (a `###` heading) and a row in its "What to check first" table, placed by how many it reaches and what it costs them; an entry and its row go once it is checked.

`README.md` (in English, for those seeing the project for the first time), the user guide `docs/guide/` and `LICENSE` (MIT) are the public documentation (BTN-60). The README stays short — the pitch, a line per feature, the quick start, the service, updating — and links to the guide: `features.md` (every feature in full), `setup.md` (the CLIs it depends on, projects, trackers and plugins, the page, the service, updating, uninstall), `reference.md` (every variable and config key). When installation, a config key, an environment variable or behaviour described there changes, the guide is edited too, and the README only when its short version stops being true; the CLI versions in the README's "Before you run it" are the latest ones it was verified on. The guide is for users: no task IDs in its text; internals stay in the other `docs/` and are only linked.

**Where to write new things.** Here goes only a rule or a trap without which a session will go wrong in any task, in a line or two. How a feature is built, routes, parameters, field mappings, measurements go into the area's document in `docs/` (if none fits — a new document and a row in the table above) or into JSDoc next to the code. Do not retell what is visible from the code. Documentation in the repository is written in English; the rule that the content of Huly tasks is in Russian stays as is.

## Stack

- Node.js 24 + TypeScript, tests — vitest. The interface is React + Vite in `web/`, built into `dist/web`; the client takes state types from `src/state.ts` — only types there, no `node:*`.
- The tracker is reached only through the `src/tracker/` layer: the chain, the order, the rules and the page know the neutral model and the adapter contract, not Huly. The repository has the Huly (`src/huly/`), GitHub (`src/github/`) and Linear (`src/linear/`) adapters.
- Sessions are the `claude --bg` CLI, with a configuration folder per account (`CLAUDE_CONFIG_DIR`). The agent is reached only through the `src/agent/` layer (`Agent`, `AGENTS`); Claude Code is the adapter in `src/claude/` (`docs/sessions.md`).
- Stats are Tally (`tally/`); the collector and the embedded database run inside the service.
- The settings and projects are in the state database (BTN-199; `even-keel.config.json` is only imported once, a hand edit is `npm run storage -- config-export`/`config-import`). The service applies them and `.env` on the fly, every key (BTN-130): a restart is only for a new version and a few start-only variables (`docs/service.md`). A new setting must apply live too. The address is `EVEN_KEEL_HOST`/`EVEN_KEEL_PORT`, not the config.
- A project's main branch is its `branch` key (`main` by default): never write a literal `main` into git calls or session prompts.

## Traps

- `claude agents --json` gives neither `pid` nor `status`, and `state` stays even for dead sessions. A live session is only a `sessions/<pid>.json` entry with a live `pid`.
- A Codex session between turns has no process: live means a live pid or `resting` — check through `isLive`, never `pid` alone.
- A pending `AskUserQuestion` is in the transcript at once only from CLI 2.1.302: 2.1.296 wrote the message with the call only once it was answered, `claude stop` lost it, and until then the question was only in `jobs/<id>/state.json` — keep reading it from there for such CLIs (`docs/sessions.md`).
- `claude stop`/`claude agents` from a terminal do not reach the service's daemon (Windows session 0): `stop` prints "stopped" and marks the job `stopped` while the process lives on. Stop chain sessions through Even Keel or by killing the pid.
- The CLI creates several keys for one folder in `.claude.json` (`d:/…`, `D:/…`, `D:\…`). Compare paths only through `src/paths.ts`.
- A session inherits its daemon's environment (frozen at the daemon's start) and puts the `settings.json` `env` read at its own start on top: a changed key reaches new sessions at once, a removed one stays until the daemon restarts, and the environment of a later `claude --bg` never reaches its session (`docs/accounts.md`).
- Do not poll `/usage` more often than once per 5 minutes: 429, and then the CLI does not query that token for ~45 min. No window lines means "no data", not an error.
- Chain sessions get plugins and MCP only as packages (`--strict-mcp-config`, `--plugin-dir`, `docs/packages.md`): a server in `.mcp.json` or a plugin enabled in settings does not reach them. Keys stay in Even Keel's `.env` behind the gateway on 127.0.0.1; `sessionBase` removes every key a package or a tracker reads from the sessions' environment.
- A plugin change comes with a new `version` in its `plugin.json`, otherwise `claude plugin update` picks up nothing.
- The Claude desktop app rewrites the profile in `~/.claude`: keep the same account there as in the app.
- A second Even Keel instance from a Claude Code session — without its `CLAUDE*` variables: an inherited `CLAUDE_CONFIG_DIR` makes `global` the session's account folder.
- A session in a worktree does not read the main checkout's `.claude/settings.local.json`: whatever chain sessions need from it goes only through `--settings` (`src/tools/panel.ts`).
- A session prompt is assembled through `fill`: an empty value is an error and a chain pause, not a blank space.
- A server message for the page is a code, not text: a new code goes into `src/notice/en.ts` and `web/src/i18n/notices-ru.ts` (the type checks that they are equal). The service log is in English.
- A project key is not its id: the files of `state/` and the page's URLs name a project by its GUID (`projects[].id`, `config.ids`), the running service, the tracker and branches by its key; `src/chain/store.ts` translates.
- A change of a file format in the config or `state/` is a new `SCHEMA_VERSION`, a migration step in `src/storage/migrations.ts` and a new frozen sample in `test/fixtures/` — never an edit of an old step or sample. A change of the state database is a new step in `STEPS` (`src/storage/database.ts`) and a new `test/fixtures/database-v<N>/` — never an edit of a merged step.
- The chain state, the questions, the launch log and the handoff snapshots are in the PGlite folder `state/even-keel/`, not in files (`docs/storage.md`): the `*.imported` files next to it are not read. One process owns the folder (`owner.json`); anything else reads it through `readStateDatabase`, never by opening `pgdata/` while the service runs.
- The service serves the built `dist/web`: after a code change — `npm run build` and a service restart, otherwise the page is stale or 503.

## Hosting

Two remotes — `origin` (self-hosted Forgejo) and `github` (`github.com/NamerekT/even-keel`, an organization, private for now). `main`, `dev` and `release/*` are pushed only by `git sync` (a global alias: fetches the current branch from all remotes, merges and pushes to all) — not `git push origin <branch>`, otherwise the remotes diverge. Task branches are not pushed to a remote, except in PR mode (`pullRequests`), where Even Keel pushes a task's branch to the pull request's remote.

Branches (`docs/releases.md`): `main` is the latest release and gets no commits of its own — users `git pull` it; the next version is built on `dev` (the main checkout `even-keel`, Huly `BTN`), fixes of the released one on `release/v<x.y>` (the clone `even-keel-github`, Huly `EKR`), carried into `dev` by hand. `v0.1.0` itself is released from `release/v0.1`; its `BTN` tasks still open are `Вручную`, done by hand in `even-keel-github`. Both folders share one auto-memory: a memory that holds only for one branch or folder names it, and one read from memory is checked against the branch you are on.

## Tasks

Work on this repository is tracked in Huly: project `BTN` for the next version, `EKR` for fixes of the released one (the same rules, with the key `EKR`/`ekr`).
The rules, statuses and order of actions are in the `huly-tracker` skill; read it before creating a task or starting work on one.

- Code is written under an active task, in its worktree. A direct request without a task is a commit to the branch of the checkout it is made in — `dev` or `release/v<x.y>`, never `main` (this overrides the global CLAUDE.md).
- Branch: `btn-<number>/short-description`. Commit: `[BTN-<number>] Message`.
- The content of tasks (titles, descriptions, comments) is in Russian.
- A session brings a task to the project's branch itself: after the reviewer's approval it merges the branch (`git merge --no-edit` in the main working copy). The user gets a report of what was done, not a merge command. After the merge, a session from the chain leaves the worktree, the branch and the push alone — Even Keel does that and closes the task. A session started by hand cleans up after itself per the skill and pushes through `git sync`.

An exception to the skill: working with the Huly API directly is allowed here — it is the point of the project.

GitHub issues of `NamerekT/even-keel` are where users report; no chain reads them. A session asked to take one copies it into `EKR` (a bug that must reach the released version) or `BTN` (the rest) with a link to the issue, and decisions come only from the Huly task, never from a comment on the issue (`docs/releases.md`, "Trackers"). The old `EVK-<number>` commits are of the project that ran GitHub issues in `even-keel-github` until 2026-10-20.

## Task worktrees

Even Keel prepares the worktree itself (`src/git/worktree.ts`, `src/git/slot.ts`), sessions do not create it: `.claude/worktrees/<key>-<number>` on the branch `<key>-<number>/task`, or a slot from the pool. After Done it stops the task's sessions, removes the worktree and the branch and runs `git sync`; it leaves dirty or occupied ones alone and writes them to `leftovers`. In detail — `docs/chain.md`.

## Invariants

1. **The dispatcher does not touch a session that has stopped.** A question, an error — nothing happens. The user answers from the page's chat window, a tracker comment or Remote Control, or moves the task in the tracker themselves. "Does not touch" means it neither stops it nor writes anything to it. Exceptions (in detail — `docs/chain.md`), all of them `claude stop`, never `rm`:
   1. a limit on the session of the current task of an unpaused chain — `--resume` while the cache is warm, otherwise a new session with a handoff;
   2. the "New session" button (`restart`) — the session is not mid-turn;
   3. a checkpoint: the last line of the last response is `CHECKPOINT: <path>`;
   4. a task in Done — the session has finished its turn and is not waiting for a reply;
   5. a slot is switched to another task's branch — the idle sessions of released tasks in it are stopped; mid-turn, the slot is not switched;
   6. the user's explicit answer — from the chat window or a tracker comment posted after the question — only while the session waits, not mid-turn: `--resume` with the answer;
   7. a red main with `ci.fixTask` off — the only one that stops a session mid-turn: the working (`busy`) session of the current task is stopped, a fix session `<KEY>-FIX` without a tracker task leads the chain, and after its merge the stopped one goes on with a message. A session that waits for an answer is not stopped.
   8. PR mode (`pullRequests`, BTN-205): feedback on a task's pull request (a review, a failed run, a conflict) goes to its session only while it is not mid-turn — `--resume` while the cache is warm, otherwise a new session with a handoff; a mark on a branch with nothing beyond main and uncommitted work is told to the session by `--resume` (with a clean worktree the task goes to Done without a pull request, as exception 4); a pull request closed unmerged stops the task's resting sessions at its cleanup, as a Done does.
   9. a task back from an inactive status (BTN-245): its session ended its turn without an `AskUserQuestion` and the task left the chain (unattended mode asks in a tracker comment and moves it to Backlog); back in Todo, the task gets a new session with a handoff pointing at the answer and the old one is stopped — unless it is mid-turn, waits on a question or someone talked to it since, then it is adopted.

   The one write without a stop (BTN-181): a chat message to a working (`busy`) session whose hooks ask for mail goes into its mailbox, and a hook of `checkpoint` hands it over mid-turn; one the hooks missed goes by `--resume` if the turn ended without a question, or back to the chat if the session asked one.

   The dispatcher may stop waiting for a session that is not mid-turn (`busy`/`waiting`): the task got an open blocker from the chain (`postpone`) or the user pressed "Skip" (`skip`). In unattended mode (`unattended`) it may also stop waiting for a session that has sat idle for 10 minutes without Done (including `waiting`); in detail — `docs/chain.md`.
2. **The tracker is the source of truth for statuses.** The dispatcher owns only the chain order, the pause, the list of skipped tasks, released tasks awaiting cleanup and those of them that left for an inactive status after their session's turn, cleanup warnings, unattended mode, the "trim the tools" switch, the questions it posted to the tracker, the pull requests it opened for tasks in PR mode and the CI verdicts on main: the last green commit, the push it waits on (for the CI or for the project's own check) and the fix of a red main — the session it started for it, or the task it created — with the task whose session it stopped for the fix.
3. **There are no secrets in the repository.** Addresses and credentials come from the environment or a local store outside git (`.env`, the trackers' profiles in the state database); the repository has only `.env.example` with fakes.
4. **The dispatcher does not accept or store the Windows password.** The user enters the service account themselves.

## Service

Without the service: `npm install`, `npm run build`, `npm start`. On Windows — the service `EvenKeel`, installed with `service/install.ps1` from PowerShell 7 as administrator, the log is `logs/even-keel.log`; on Linux and macOS — `service/install.sh`. In detail — `docs/service.md`.

## Tests

TDD for logic: chain order, status transitions, parsing transcripts and tracker answers. Process handling, network and layout are not covered by tests — they are checked live, with screenshots in `.temp/`. The user works only in the dark theme: screenshot it first, the light one only must not break. Look through `npm run shot` (element shots and a text report, dark by default, `docs/web.md`), not the Playwright MCP: each MCP step puts the page's whole accessibility tree into the context; the MCP only for what the script cannot do.
