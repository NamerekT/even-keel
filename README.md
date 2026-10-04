# Even Keel

Even Keel runs your backlog through [Claude Code](https://docs.claude.com/en/docs/claude-code/overview), one task at a time. It reads the open tasks of a project from your tracker, orders them by their `blocks` links, starts a Claude Code session on the first one, and when the task is done — its branch merged into `main` — cleans up and starts the next. A web page shows the chain and, for every session, what it is doing right now and how full its context is.

It runs as a service on your own machine, next to your repositories and your Claude Code login. Trackers out of the box: [Huly](https://huly.io), GitHub Issues and [Linear](https://linear.app).

## Sequential by design

Most agent orchestrators sell width: ten agents in parallel, each in its own worktree. Even Keel deliberately runs the tasks of a project one after another, in the order the `blocks` links give. Why:

- **Backlog tasks are connected.** A parallel agent working on task B decides on its own what task A, not yet done, will look like. The sequential agent on B reads A's merged code.
- **The bottleneck is human attention, not typing speed.** Questions, reviews and merges are yours to handle. Ten agents produce ten queues of them at once.
- **A worktree isolates the work, not the result.** Conflicts, especially semantic ones that git does not see, move to merge time, where they are more expensive.
- **The subscription limit is shared.** Parallel agents spend it sooner, not on more; and each of them reads the same area of the code again.

Even Keel wins in time, not in width: the agent keeps working while you are away, and the chain survives what usually stops it — the usage limit running out, a context grown too large, a switch of accounts. That steady going is what the name means.

One chain is active at a time; other projects wait in a queue and start when it ends. Several chains on different projects at once is an idea for later.

## What it does

- **The chain.** Tasks enter the chain by status (by default: ready and in-progress tasks — not the backlog, not closed ones) and by labels you choose. Order: open blockers first, then the order you set by dragging on the page, then milestone, priority, task number. A task with an open blocker waits; a task with subtasks never runs itself — its subtasks do.
- **Sessions.** Each task gets a background session (`claude --bg`) in its own git worktree `.claude/worktrees/<key>-<number>` on a branch `<key>-<number>/task`, made from `main`. The session does the task and merges its branch into `main`; Even Keel sees the merge, closes the task in the tracker, stops the session, removes the worktree and the branch, and syncs `main` with the remote. Labels `Sonnet`, `Opus` or `Haiku` on a task pick the model.
- **Slots.** For repositories with heavy ignored caches (Unity's `Library`, big `node_modules`) a project can use a pool of permanent worktrees instead of a fresh one per task, so the next task rebuilds only the difference.
- **Handoffs.** A session that hit the usage limit is resumed after the reset if its prompt cache is still warm, otherwise stopped and replaced by a new session in the same worktree with a handoff prompt. The same handoff happens when a session ends its turn with a `CHECKPOINT: <path to a note>` line — the [checkpoint](plugins/checkpoint) plugin asks for it once the context grows past 150k tokens — and when you press **New session** on the page.
- **Hands off a stopped session.** A session that asks a question or fails is left alone: you answer it — from your phone through Remote Control, if you like — or move the task in the tracker yourself. Even Keel never writes into a session that stopped on its own. You can skip a task, and a session that files a blocker for its task gets the task postponed until the blocker is done.
- **Accounts.** Several Claude subscriptions, one config folder each. Log in, renew and remove accounts from the page, pick the one the chain uses; when one account runs out of limit, switch to another and the chain carries on. The page also switches the account of the Claude Code extension in VS Code.
- **Limits.** The 5-hour and weekly windows of every account, read with the CLI's own `/usage` command (no quota spent). While a window is exhausted the next task waits for its reset.
- **Statistics.** A built-in collector (Tally) reads the session transcripts every five minutes into an embedded Postgres ([PGlite](https://pglite.dev)): spend by day and project, cost and time per task, where sessions got stuck, slow commands, estimates against actual time, and before/after comparisons of changes to your rule files. All of it on the `/stats` page.
- **Languages.** The page is in English or Russian; the prompts Even Keel sends to sessions can be in either, separately.

## Requirements

- **Node.js 24** or newer, and git.
- **Claude Code CLI**, logged in with a Claude subscription (`claude` once in a terminal). Even Keel finds `~/.local/bin/claude.exe` on Windows and `claude` on `PATH` elsewhere, or the binary of the VS Code extension; `EVEN_KEEL_CLAUDE_BIN` overrides.
- **A tracker:** a Huly workspace, GitHub repositories with Issues, or a Linear workspace.
- **Statistics** need nothing more: the database is embedded. An external Postgres is optional.
- Windows, Linux or macOS. Windows is where it runs every day; Linux was checked end to end under WSL (Ubuntu); macOS is expected to work but has not been checked.

## Before you run it

- **Even Keel depends on undocumented behaviour of the Claude Code CLI**: `claude agents --json`, the `sessions/<pid>.json` records, the background daemon (`claude --bg`, `claude daemon`), the transcript format, the text of `/usage`, the layout of `~/.claude.json` and `.credentials.json`. None of it is a public API. Last checked against **Claude Code 2.1.289**. A CLI update may break a part of Even Keel until it is adapted — please open an issue when it does.
- **Sessions run with `--permission-mode auto`**: they act without asking you on each tool call. Set up the permissions and hooks you want in your Claude Code settings before you start a chain.
- Even Keel reads only the expiry dates from `.credentials.json`; tokens stay with the CLI and are never read, copied or sent anywhere.

## Install

### 1. Get it and build

```sh
git clone <this repository> even-keel
cd even-keel
npm install
npm run build
```

`npm run dev:fake` shows the page on fake data, with no tracker and no sessions — a quick way to see what you are installing.

### 2. Configure

```sh
cp .env.example .env
cp even-keel.config.example.json even-keel.config.json
```

`.env` holds the tracker credentials ([below](#environment)); `even-keel.config.json` lists your projects ([reference](#configuration)). Both are ignored by git.

Each project needs:

- a git repository with a `main` branch; with a remote, Even Keel pushes `main` after every task;
- the repository trusted by Claude Code: open `claude` in it once and accept the trust prompt, or the first launch pauses the chain and asks for it;
- a rule that the session merges its branch when done. Without the plugin ([level 2](#2-with-the-plugin)) put it into the project's `CLAUDE.md`, for example:

  > When the task is done and the checks pass, commit, then merge the branch into `main` in the main checkout with `git merge --no-edit <branch>`. Do not remove the worktree or the branch afterwards.

### 3. Pick how sessions work with the tracker

#### 1. Minimum: the adapter only

Even Keel reads the tasks itself, puts the title and description of the task into the session's prompt, and closes the task when its branch lands in `main`. You set the tracker's variables in `.env` and nothing else.

- **Huly:** `HULY_URL`, `HULY_WORKSPACE`, `HULY_EMAIL`, `HULY_PASSWORD`. The project key in the config is the Huly project identifier (`ABC` for `ABC-12`).
- **GitHub:** `GITHUB_TOKEN` — a [fine-grained token](https://github.com/settings/personal-access-tokens) with **Issues: Read and write** on the repositories. A project names its repository: `{ "repo": "…", "tracker": "github", "github": "octo-org/abc" }`. GitHub has no backlog, so keep entry to the chain on a label: `"chain": { "requiredLabels": ["ready"] }`. Details and the mapping of statuses, blockers, sub-issues and priorities: [plugins/github/README.md](plugins/github/README.md).
- **Linear:** `LINEAR_TOKEN` — a [personal API key](https://linear.app/settings/account/security). The project key in the config is the team key (`ENG` for `ENG-12`); `"linear": "Web app"` narrows the team down to one Linear project: `{ "repo": "…", "tracker": "linear", "linear": "Web app" }`. Details and the mapping: [plugins/linear/README.md](plugins/linear/README.md).

On this level the session does not write to the tracker. What you do not get:

- **Postponing on a blocker.** The session cannot file a blocker for its task, so it cannot hand the task back and let the blocker run first. Blockers you link yourself still order the chain.
- **Question tasks.** A session cannot file a `Question: …` task for a decision it took on its own; it can only tell you in its final message.
- **Comments and decisions.** Nothing is written back: no closing comment, no decisions folded into the description, no new tasks for bugs found on the way.
- **Attachments and discussion.** The session sees only the title and the description.

#### 2. With the plugin

On top of the adapter, a Claude Code plugin from this repository gives the sessions the tracker's MCP server and a skill for working a task: the session reads the task and its attachments, records decisions in the description, files blockers and question tasks, creates new tasks, leaves a closing comment and merges.

With your default Claude Code config (no `CLAUDE_CONFIG_DIR` set), from the root of the tracked project:

```sh
claude plugin marketplace add <git URL or local path of this repository>
claude plugin install huly@even-keel --scope project     # or github@even-keel, linear@even-keel
```

or inside a session: `/plugin marketplace add …`, then `/plugin install huly@even-keel` with the project scope. Then:

1. Commit the project's `.claude/settings.json` (it now has `enabledPlugins`): tasks run in worktrees made from `main`, and a worktree without the file has no plugin.
2. Give the MCP server its credentials in the `env` of `~/.claude/settings.json` — `HULY_URL`, `HULY_WORKSPACE`, `HULY_TOKEN` (or `HULY_EMAIL` and `HULY_PASSWORD`) for Huly, `GITHUB_PERSONAL_ACCESS_TOKEN` for GitHub, `LINEAR_API_KEY` for Linear. Not system environment variables: Even Keel keeps its own tracker credentials out of the sessions it starts.
3. Turn the brief off for the project, or the session reads its task twice: `{ "repo": "…", "brief": false }`. With `brief` off Even Keel checks that the project's sessions see the tracker's MCP server and warns on the page when they do not.

The GitHub skill sets "blocked by" links through the [GitHub CLI](https://cli.github.com/), so `gh auth login` once. Everything else — troubleshooting, what the skills do — is in [plugins/huly/README.md](plugins/huly/README.md), [plugins/github/README.md](plugins/github/README.md) and [plugins/linear/README.md](plugins/linear/README.md).

### Several trackers

Each project has its own tracker (`tracker` in the project's entry, or one for all at the top level), and they work at the same time: project A on Huly, project B on GitHub. There is one connection per kind of tracker — one Huly workspace, one GitHub token, one Linear key. Several connections of the same tracker are not supported yet.

### 4. Run

Without a service, on any system:

```sh
npm start
```

and open `http://localhost:4747`. Open a project, press **Start**: the chain takes its first task. Other projects can be queued after it.

To answer sessions from your phone, turn on Remote Control at startup in `/config` of Claude Code; the page links each session's Remote Control.

### As a service

The service starts with the system and restarts Even Keel if it fails. Stopping the service does not kill running sessions: they belong to the CLI's daemon.

**Windows.** From PowerShell 7 as administrator:

```powershell
.\service\install.ps1
```

It installs the dependencies, builds the page, compiles a small service host with the `csc.exe` that ships with Windows (.NET Framework 4), and registers the service `EvenKeel` under your account. The script never asks for your password: enter it in `services.msc` → EvenKeel → Properties → Log On, which also grants the "Log on as a service" right, then start the service. Log: `logs\even-keel.log`. After updating the code, run `install.ps1` again. `service\uninstall.ps1` removes the service.

**Linux and macOS.** As your own user, not with `sudo`:

```sh
service/install.sh
```

On Linux it installs a systemd user unit (`systemctl --user status even-keel`, log: `journalctl --user -u even-keel`). A user unit stops when you log out; to keep it running, `loginctl enable-linger $USER`. On macOS it installs a launchd agent `local.even-keel` (log: `logs/even-keel.log`), which runs while you are logged in. The script takes `PATH` and `node` from your shell; if `node` changes (nvm and the like), run it again. Run it again after updating the code too. `service/uninstall.sh` removes it.

## Environment

`.env` in the repository root. A tracker whose variables are all empty is off; set in part, it is a startup error.

| Variable | |
| --- | --- |
| `HULY_URL`, `HULY_WORKSPACE`, `HULY_EMAIL`, `HULY_PASSWORD` | Huly adapter |
| `GITHUB_TOKEN` | GitHub adapter |
| `LINEAR_TOKEN` | Linear adapter |
| `EVEN_KEEL_ACCOUNTS_DIR` | folder of the extra Claude account folders; default `~/.claude-accounts` |
| `EVEN_KEEL_CLAUDE_BIN` | path to the `claude` binary |
| `EVEN_KEEL_CONFIG` | path to the config; default `even-keel.config.json` in the root |
| `EVEN_KEEL_STATE_DIR` | where state lives (chain order, accounts, launch log, statistics database); default `state/` |
| `TALLY_DB_HOST`, `TALLY_DB_PORT`, `TALLY_DB_NAME`, `TALLY_WRITER_PASSWORD`, `TALLY_READER_PASSWORD` | your own Postgres for the statistics instead of the embedded one: the collector writes as `tally_writer`, the page reads as `tally_reader`. `tally/deploy/` has a Compose file that creates both roles |
| `TALLY_LLM_URL`, `TALLY_LLM_KEY`, `TALLY_LLM_MODEL` | optional classifier of the stuck spans on `/stats`: an OpenAI-compatible endpoint, its key and a model it serves; without them the spans are found but not explained |

## Configuration

`even-keel.config.json`, starting from [even-keel.config.example.json](even-keel.config.example.json). The service rereads it on the fly: `chain`, `brief`, `modelPrompts`, `stats`, `language`, `promptLanguage` and `unattended` apply at once, the rest after a restart. A broken file keeps the last good one running and shows the error on the page.

| Key | Default | |
| --- | --- | --- |
| `host`, `port` | `0.0.0.0`, `4747` | where the page listens |
| `tracker` | `huly` | tracker of every project that does not name its own: `huly`, `github` or `linear` |
| `brief` | `true` | put the task's title and description into the prompt; `false` for projects whose sessions read the task through the tracker's plugin |
| `chain.active` | ready and in-progress categories | status names that enter the chain |
| `chain.terminal` | done and canceled categories | status names that close a task |
| `chain.requiredLabels` | `[]` | a task needs at least one of them; empty — no label needed |
| `chain.excludedLabels` | `["Manual", "Вручную"]` | a task with one of them never enters the chain: you run it yourself |
| `projects` | — | project key (a letter, then up to four letters, digits or `_`) → repository path, or an object below |
| `projects.<KEY>.repo` | — | path to the main checkout |
| `projects.<KEY>.tracker`, `.brief`, `.chain` | the shared ones | per project; a project's `chain` key replaces the shared key whole |
| `projects.<KEY>.github` | — | `owner/name` of the repository, for a project on GitHub |
| `projects.<KEY>.linear` | the whole team | name of the Linear project the team is narrowed down to, for a project on Linear (the key is the team key) |
| `projects.<KEY>.slot` | off | `true` or a number: a pool of permanent worktrees instead of one per task |
| `context` | `{ "window": 600000, "warn": 50, "danger": 80 }` | context bar on the page: window size in tokens, warning and danger thresholds in percent |
| `modelPrompts` | `{}` | text added to the prompt of sessions on `sonnet`, `opus` or `haiku` |
| `stats.compare` | `{ "minTasks": 5, "minSessions": 10, "days": 7 }` | before/after comparisons on `/stats`: minimum sample and days on each side |
| `language` | the browser's | language of the page: `en` or `ru` |
| `promptLanguage` | `language`, then `en` | language of the prompts Even Keel sends to sessions |
| `unattended` | `false` | for when nobody will answer, e.g. overnight: sessions are told to ask nothing, to do everything a question does not hold, and to park a task held by one — committed on its branch, unmerged, question in a comment, moved to Backlog; a session that ended its turn without the task done is skipped after 10 minutes |

Statuses are matched by name, case-insensitively. Without `active` and `terminal` the chain goes by status category, so the backlog stays out and a task enters the chain when you move it to a ready status. Status names differ between trackers: if you set them at the top level, a project on another tracker needs its own (GitHub's are `Open`, `Completed`, `Not planned`, `Duplicate`; Linear's are the team's workflow states), as in the example.

## Extending

### Your own tracker

The chain never talks to a tracker directly: it reads tasks through an adapter. The contract, with what each field means and what to return when your tracker lacks something, is the JSDoc of [src/tracker/source.ts](src/tracker/source.ts) (`TrackerAdapter`, `TaskSource`). `src/github/` is a compact example, `src/huly/` a fuller one. Register the adapter in [src/tracker/adapters.ts](src/tracker/adapters.ts) and pick it with `tracker` in the config. `brief` and `complete` are optional: without them, sessions must learn the task and close it some other way.

### A plugin for it

A plugin gives sessions the tracker's MCP server and a skill for working a task. Use [plugins/huly](plugins/huly) as the pattern: `.claude-plugin/plugin.json`, `.mcp.json` with the server, `skills/task/SKILL.md`; add an entry to [.claude-plugin/marketplace.json](.claude-plugin/marketplace.json) and name the server in the adapter's `mcpServer`, so that Even Keel can check sessions see it. Raise the plugin's `version` on every change: installed copies are cached by version.

### Where it could grow

- Other trackers: Jira, GitLab, YouTrack…
- Your own classifier for the statistics, or a different model behind it.
- Other APIs and other agents: today Even Keel is built around the Claude Code CLI and its subscription limits.

## Development

```sh
npm test            # vitest
npm run typecheck
npm run dev         # the server, restarting on changes
npm run dev:web     # the page with hot reload, proxying /api to a running server
npm run dev:fake    # the page on fake data
```

## License

[MIT](LICENSE)
