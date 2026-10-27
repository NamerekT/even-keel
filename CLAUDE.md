# Even Keel

Formerly called Baton (Батон): that is how it is recorded in old commits, tasks and memory; the Huly key `BTN` and the `btn-*` branches stayed.

A dispatcher of Claude Code session chains. It takes a project's open tasks from the tracker, builds the order from `blocks` relations, starts a session on the first task and, when the task goes to Done, starts the next one. A web page shows the chain and, for each session, the stage, the current action and how full the context is. It runs as a service on the user's workstation: agents are launched only here.

The global rules from `~/.claude/CLAUDE.md` apply in full. Below is only what is specific to this project.

## Documentation

This file holds only the rules and traps every session needs. How things are built is in `docs/`; read the document of your area before working in it:

| Document | Area |
| --- | --- |
| `docs/chain.md` | the chain: order, worktrees and slots, cleanup after Done, invariant 1's exceptions in detail, what the dispatcher owns, unattended mode, state files |
| `docs/storage.md` | the state database `state/even-keel/` (PGlite): owner, tables, schema steps, imports, backup, readers outside the service |
| `docs/trackers.md` | the `src/tracker/` layer, the Huly, GitHub and Linear adapters, Claude Code plugins |
| `docs/ci.md` | the `src/ci/` layer, the Forgejo and GitHub Actions adapters, polling |
| `docs/sessions.md` | the agent CLIs, transcripts, the model by label, prompt assembly, limits |
| `docs/packages.md` | plugins and MCP servers of a project's set, keys, the MCP gateway, launch flags |
| `docs/accounts.md` | account folders, sign-in and switching, the apps panel |
| `docs/web.md` | the interface, translation and message codes, live config, `dev:fake` |
| `docs/design.md` | how the page looks: tokens, the CSS test, shared blocks, the check of a screen |
| `docs/settings.md` | every setting and its levels (Even Keel, project, task label) |
| `docs/stats.md` | the `/stats` page; the collector is in `tally/CLAUDE.md` |
| `docs/service.md` | the service on Windows, Linux and macOS |
| `docs/releases.md` | branches `main`, `dev`, `release/*`; trackers `BTN`, `EKR`, GitHub issues; releases and the CLI check |
| `docs/guide/` | the public user guide behind the README |
| `docs/unverified.md`, `docs/verified.md` | behaviour never checked live; the log of every live check |
| `docs/posts/` | drafts of posts, each with the `.sql` of its Tally numbers |

Behaviour written without a way to check it live gets an entry in `docs/unverified.md` and a row in its "What to check first" table. Every live check — of such an entry, a "Проверка" task, a live run inside a task — gets a row in `docs/verified.md`; a checked entry moves there, never just deleted (the heads of both files say how).

The public documentation is `README.md`, `docs/guide/` (`features.md`, `setup.md`, `reference.md`) and `LICENSE` (MIT). A change of installation, a config key, an environment variable or behaviour described there edits the guide too; the README stays short and changes only when its short version stops being true. The guide has no task IDs and only links the internals.

**Where to write new things.** Here goes only a rule or a trap without which a session will go wrong in any task, in a line or two. How a feature is built, its routes, parameters and measurements go into the area's document (none fits — a new one and a row above) or into JSDoc. Documentation in the repository is in English; Huly tasks stay in Russian.

## Stack

- Node.js 24 + TypeScript, tests — vitest. The interface is React + Vite in `web/`, built into `dist/web`; the client takes state types from `src/state.ts` — only types there, no `node:*`.
- The tracker is reached only through the `src/tracker/` layer, the agent only through `src/agent/` (`Agent`, `AGENTS`): the chain, the rules and the page know the neutral model, not Huly or Claude.
- Claude sessions are the `claude --bg` CLI or, per account folder, the same CLI through the Agent SDK, with a configuration folder per account (`CLAUDE_CONFIG_DIR`).
- Stats are Tally (`tally/`); the collector and its database run inside the service.
- The settings and projects are in the state database; a hand edit is `npm run storage -- config-export`/`config-import`. The service applies them and `.env` live, and a new setting must apply live too; a restart is only for a new version and a few start-only variables (`docs/service.md`). The address is `EVEN_KEEL_HOST`/`EVEN_KEEL_PORT`.
- A project's main branch is its `branch` key (`main` by default): never write a literal `main` into git calls or session prompts.

## Traps

- `claude agents --json` gives neither `pid` nor `status`, and `state` stays even for dead sessions. A live session is only a `sessions/<pid>.json` entry with a live `pid`.
- A Claude session of kind `sdk` is no daemon job and the `--bg` traps do not apply to it: route a session by `SdkSessions.knows`, never by the account's current transport.
- A Codex session between turns has no process: check liveness through `isLive`, never `pid` alone.
- `claude stop`/`claude agents` from a terminal do not reach the service's daemon (Windows session 0): `stop` prints "stopped" while the process lives on. Stop chain sessions through Even Keel or by killing the pid.
- The CLI keeps several keys for one folder in `.claude.json` (`d:/…`, `D:/…`, `D:\…`): compare paths only through `src/paths.ts`.
- A session inherits its daemon's environment, frozen at the daemon's start, with the `settings.json` `env` on top: a removed key stays until the daemon restarts (`docs/accounts.md`).
- Do not poll `/usage` more often than once per 5 minutes: 429, and then the CLI does not query that token for ~45 min.
- Chain sessions get plugins and MCP only as packages (`docs/packages.md`): `.mcp.json` and plugins enabled in settings do not reach them, and keys stay behind the gateway, never in a session's environment.
- A plugin change comes with a new `version` in its `plugin.json`, otherwise `claude plugin update` picks up nothing.
- The Claude desktop app rewrites the profile in `~/.claude`: keep the same account there as in the app.
- A second Even Keel instance from a Claude Code session — without its `CLAUDE*` variables: an inherited `CLAUDE_CONFIG_DIR` makes `global` the session's account folder.
- A session in a worktree does not read the main checkout's `.claude/settings.local.json`: what chain sessions need from it goes through `--settings` (`src/tools/panel.ts`).
- A session prompt is assembled through `fill`: an empty value is an error and a chain pause, not a blank space.
- A server message for the page is a code, not text: a new code goes into `src/notice/en.ts` and `web/src/i18n/notices-ru.ts`. Nothing from the log reaches the page; the log is in English.
- A message a person reads names a setting as the page labels it, says what to do and gives a button where the page has one (`noticeFixOf`); a config path only in the log and `config-import` (`docs/web.md`).
- A project key is not its id and not unique: the service, the database and the URLs name a project by its GUID (`projects[].id`). A text a person reads names a project through `projectLabel`/`withLabels`.
- A file format change in the config or `state/` is a new `SCHEMA_VERSION`, a step in `src/storage/migrations.ts` and a new sample in `test/fixtures/`; a state database change is a new step in `STEPS` (`src/storage/database.ts`) and a new `test/fixtures/database-v<N>/`. Never edit a merged step or sample.
- The chain state, questions, launch log and handoff snapshots are in `state/even-keel/` (`docs/storage.md`), not in the `*.imported` files. One process owns the folder; anything else reads it through `readStateDatabase`, never by opening `pgdata/`.
- The service serves the built `dist/web`: after a code change — `npm run build` and a service restart, otherwise the page is stale or 503.

## Hosting

Two remotes — `origin` (self-hosted Forgejo) and `github` (`github.com/NamerekT/even-keel`, public). `main`, `dev` and `release/*` are pushed only by `git sync` (a global alias: fetch from all remotes, merge, push to all), never `git push origin <branch>`. Task branches are not pushed, except by Even Keel in PR mode.

Branches (`docs/releases.md`): `main` is the latest release and gets no commits of its own; the next version is built on `dev` (this checkout, Huly `BTN`), fixes of the released one on `release/v<x.y>` (the clone `even-keel-github`, Huly `EKR`), carried into `dev` by hand. Both folders share one auto-memory: a memory that holds only for one branch or folder names it.

## Tasks

Work is tracked in Huly: `BTN` for the next version, `EKR` for fixes of the released one (the same rules with its own key). Read the `huly-tracker` skill before creating a task or starting one; working with the Huly API directly is allowed here.

- A session started by hand talks things through and files tasks; the chain codes them. A talk that ends in "do it" becomes a task in `BTN` (Backlog) and the session stops: no worktree, no code. Code by hand only when the user says to do it here (this overrides the global "without a task — commit at once"); such work is a commit to the checkout's branch, `dev` or `release/v<x.y>`, never `main`.
- Branch: `btn-<number>/short-description`. Commit: `[BTN-<number>] Message`. Task content is in Russian.
- A session merges its task branch itself (`git merge --no-edit` in the main working copy) and reports what was done. A chain session then leaves the worktree, the branch and the push to Even Keel; a hand session cleans up per the skill and pushes through `git sync`.
- GitHub issues are taken into `EKR` or `BTN` as `docs/releases.md` ("Trackers") says; decisions come only from the Huly task.

Even Keel prepares a task's worktree itself (`.claude/worktrees/<key>-<number>` or a slot) and removes it after Done; sessions never create one (`docs/chain.md`).

## Invariants

1. **The dispatcher does not touch a session that has stopped** — neither stops it nor writes to it. A question, an error: nothing happens; the user answers from the page's chat, a tracker comment or Remote Control. The exceptions are a closed list, each `claude stop`, never `rm` (`docs/chain.md`, "The exceptions to invariant 1 in detail"): a limit, "New session", a `CHECKPOINT:` mark, a task in Done, a slot switch, the user's explicit answer, a red main (the only one that stops a session mid-turn), PR feedback, a task back from an inactive status. Writes without a stop: a chat message into a working session's mailbox, an answer to a permission dialog the hook holds. A touch with neither: the keep-warm fork. A new way to touch a session is a new exception there and a word here. Not waiting for a session any more (skip, postpone, unattended idle) is not a touch.
2. **The tracker is the source of truth for statuses.** The dispatcher keeps only its own state — order, pause, skips, released tasks, its questions, pull requests, carries, CI verdicts; the full list is in `docs/chain.md`, "What the dispatcher owns".
3. **There are no secrets in the repository.** Addresses and credentials come from the environment or a local store outside git; the repository has only `.env.example` with fakes.
4. **The dispatcher does not accept or store the Windows password.** The user enters the service account themselves.

## Service

Without the service: `npm install`, `npm run build`, `npm start`. On Windows — the sign-in start with a tray icon (`even-keel install`) or the service `EvenKeel` (`service/install.ps1`), one per machine; on Linux and macOS — `service/install.sh`. The log is `logs/even-keel.log`; in detail — `docs/service.md`.

## Tests

TDD for logic: chain order, status transitions, parsing transcripts and tracker answers. Process handling, network and layout are checked live, with screenshots in `.temp/`. The user works only in the dark theme: screenshot it first, the light one only must not break. Look through `npm run shot` (`docs/web.md`), not the Playwright MCP: each MCP step puts the page's whole accessibility tree into the context.
