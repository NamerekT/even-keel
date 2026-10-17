<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo-light.svg" alt="Even Keel" height="40">
  </picture>
</h1>

**Hand your backlog to [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) and stop babysitting it.** Even Keel takes the open tasks of a project from your tracker, in the order of their `blocks` links, and works through them one at a time while you do something else: a session on the first task, and when its branch lands in `main`, cleanup and the next. It waits out a spent usage limit, hands a long session over to a fresh one and keeps going while you are away. Only what really needs you — a question, a decision — waits for you: on its page, in the tracker or on your phone.

**And it shows what each change did.** Built-in statistics show what every task cost, where sessions got stuck and how full their context ran, and compare before and after every change to your rule files. A web page shows the chain and, for every session, what it is doing right now.

It runs as a service on your own machine, next to your repositories: your own subscription, through the unmodified `claude` CLI and its own login. Trackers out of the box: [Huly](https://huly.io), GitHub Issues and [Linear](https://linear.app).

## Sequential by design

Most agent orchestrators sell width: ten agents in parallel, each in its own worktree. Even Keel deliberately runs the tasks of a project one after another, in the order the `blocks` links give. Why:

- **Backlog tasks are connected.** A parallel agent working on task B decides on its own what task A, not yet done, will look like. The sequential agent on B reads A's merged code.
- **The bottleneck is human attention, not typing speed.** Questions, reviews and merges are yours to handle. Ten agents produce ten queues of them at once.
- **A worktree isolates the work, not the result.** Conflicts, especially semantic ones that git does not see, move to merge time, where they are more expensive.
- **The subscription limit is shared.** Parallel agents spend it sooner, not on more; and each of them reads the same area of the code again.

Even Keel wins in time, not in width: the agent keeps working while you are away, and the chain survives what usually stops it — the usage limit running out, a context grown too large. That steady going is what the name means.

Sequential within a project, not across them: different projects are different repositories, so `parallel` in the config lets that many chains run at once (one by default). Other projects wait in a queue and start as soon as a chain ends. The usage limit stays shared: every running chain takes tasks until the window is used up, then they all wait for the reset.

## What it does

- **The chain.** Tasks enter the chain by status (by default: ready and in-progress tasks — not the backlog, not closed ones) and by labels you choose. Order: open blockers first, then the order you set by dragging on the page, then milestone, priority, task number. A task with an open blocker waits; a task with subtasks never runs itself — its subtasks do, and on Huly Even Keel closes it once they are all closed.
- **Sessions.** Each task gets a background session (`claude --bg`) in its own git worktree `.claude/worktrees/<key>-<number>` on a branch `<key>-<number>/task`, made from `main` (or the project's `branch`; `main` below means that branch). The session does the task and merges its branch into `main`; Even Keel sees the merge, closes the task in the tracker, stops the session, removes the worktree and the branch, and syncs `main` with the remote. What a session runs on — the provider, its model and its account — is set in the config, shared and per project; Claude sessions run on Opus by default, whatever `/model` last saved in the CLI settings. With `modelLabels` on, a task's label `Claude | sonnet`, `Codex | gpt-6.1-sol` or a bare `Codex` picks it for that task; a label of a provider with no account set runs the task on the project's provider and says so in a toast.
- **Codex (preview).** The shared or a project's `provider` key (the shared one is also moved by giving the Even Keel role to the Codex account on the accounts page), or a `Codex` label on a task, runs the task's sessions on the OpenAI Codex CLI instead: one `codex exec --json` per turn, the transcript, context fill and limits (5-hour and weekly, or the free plan's 30-day one) read from Codex's own session files, the tracker's MCP server passed on every turn. Codex has no question tool, so a turn that ends without the task done waits for your reply in the chat window. Not yet run as a whole chain. From the Windows service the Codex sandbox does not start (a Codex bug), so on Windows it needs `execution.codex` set to `bypass`, which runs Codex sessions with no sandbox at all ([docs/unverified.md](docs/unverified.md#codex)).
- **Slots.** For repositories with heavy ignored caches (Unity's `Library`, big `node_modules`) a project can use a pool of permanent worktrees instead of a fresh one per task, so the next task rebuilds only the difference.
- **Handoffs.** A session that hit the usage limit is resumed after the reset if its prompt cache is still warm, otherwise stopped and replaced by a new session in the same worktree with a handoff prompt. The same handoff happens when a session ends its turn with a `CHECKPOINT: <path to a note>` line — the [checkpoint](plugins/checkpoint) plugin asks for it once the context grows past a threshold, 200k tokens until the project's own statistics give a better one, and stops asking below 300k after three handoffs of a task — and when you press **New session** on the page.
- **Chat with the session.** The **Chat** button of the current session opens its whole transcript with a reply box: the options of the session's question as tabs and radio buttons or checkboxes, free text and files, which land in the task's `.temp/inbox/`. The button turns amber while the session waits for you. Even Keel stops the session and resumes it with your answer. A question with options is also posted to the tracker as a numbered comment; reply with `2`, `1, 3` or text. Remote Control still works: the page links each session's Remote Control.
- **Task cards.** A click on a task's title opens its card: the description and comments rendered from Markdown, labels with what each means to the chain, milestone, priority, and the tasks it blocks, waits for or relates to. A backlog task moves to Todo from its card, straight from the backlog panel or, when it holds a chain task, from its locked row in the chain, so the phone rarely needs the tracker's own page. On GitHub there is no backlog, so no Todo button.
- **Hands off a stopped session.** A session that asks a question or fails is left alone: you answer it or move the task in the tracker yourself. Even Keel never writes into a session that stopped on its own — only your own answer goes in, and only while the session waits for it. You can skip a task, and a session that files a blocker for its task gets the task postponed until the blocker is done.
- **Unattended mode.** For when nobody will answer — a switch in **Settings → Chain** (the gear in the header). Sessions are told to ask nothing, to do everything a question does not hold, and to park a task held by one: committed on its branch, unmerged, the question left in the task, the task moved to Backlog. A session that sits 10 minutes without the task done is skipped, and the session of a done task that stays busy for 10 quiet minutes is no longer waited for, so one stuck session does not stop the whole run.
- **Lean sessions.** Chain sessions start without claude.ai skills and plugins, and with niche bundled skills reachable only through `/name`, so their skill listing does not eat the context; the project's own settings still win. It is a switch in **Settings → Sessions**, and the settings files stay untouched. The `/tools` page shows what sessions get, for one project or several side by side: what will not reach them, settings by level, MCP servers, and the skills and tools the last session actually saw.
- **Accounts.** Your own Claude and Codex subscriptions — a personal and a work one, say — one config folder each. At most one Codex account may be on the free plan: OpenAI's terms do not allow several free accounts to get round the limits, so Even Keel refuses a second one ([docs/accounts.md](docs/accounts.md#the-codex-folders-btn-168-btn-176)). The `/accounts` page lists them in a section per provider (Claude Code, Codex), as cards with their connection, limits and what runs on each now (VS Code chats by their tab titles); a section's "Add" asks for the connection (CLI or API key), then shows that kind's own sign-in. Renew and remove accounts there, and move Even Keel's chain to an account from that account's card. The same field moves the Claude Code extension in VS Code; the Claude desktop app is not switched, but can be launched on an account folder by hand ([docs/accounts.md](docs/accounts.md#the-claude-desktop-app)). An account can also be an Anthropic API key, checked with Anthropic when added and then hourly: its sessions pay from the key, the page shows its spend today instead of limits (with statistics on), and it has no Remote Control and no waiting out a limit; a session whose key runs out of credit is held, the key is checked every 5 minutes, and the chain goes on once it is topped up ([docs/accounts.md](docs/accounts.md#api-accounts-btn-99)).
- **Limits.** The 5-hour and weekly windows of every account, read with the CLI's own `/usage` command (no quota spent). Even Keel stays inside them: while a window is exhausted the next task waits for its reset.
- **Statistics.** A built-in collector (Tally) reads the session transcripts every five minutes into an embedded Postgres ([PGlite](https://pglite.dev)): spend by day and project, cost and time per task, where sessions got stuck, slow commands, estimates against actual time, and before/after comparisons of changes to your rule files. All of it on the `/stats` page. A comparison is easier to judge when you know why a rule changed: add the hook `tally/bin/rule-hook.mjs` to `~/.claude/settings.json` and a session that edits a `CLAUDE.md`, skill, hook, agent or settings file is asked to log the reason in `<state>/rule-history.jsonl` (`ruleHistory` in `tally/tally.config.json`), which `/stats` attaches to the change:

  ```json
  "hooks": {
    "PostToolUse": [{ "matcher": "Edit|MultiEdit|Write", "hooks": [{ "type": "command", "command": "node \"/path/to/even-keel/tally/bin/rule-hook.mjs\"" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "node \"/path/to/even-keel/tally/bin/rule-hook.mjs\"" }] }]
  }
  ```
- **CI.** A badge in the project's head shows the CI of each remote — Forgejo Actions or GitHub Actions, found from `git remote` and the workflow folders: whether the API answers and a runner takes the runs, the current run with its tasks, jobs and steps against the usual length, and the recent runs. The API is polled only while a run is unfinished or after a push. After a task is merged and `main` is pushed, the next task waits for the CI's verdict (as long as the project allows) while its worktree is prepared; a red `main` is fixed first: Even Keel stops the session working on the current task, starts a session to fix `main` — with the failed jobs and the commits of the push in its prompt, without a task in the tracker — and, once the fix is merged, continues the stopped session with a note to merge `main` into its branch. A project can ask for a high-priority fix task in the tracker instead (`ci.fixTask`). If the fix is red too, the chain pauses instead of starting another.
- **A check without CI.** A project with no CI, or whose CI does not answer, can name its own check commands, such as `npm run typecheck && npm test`. A session's merge into `main` waits until they pass in the task's worktree (a hook of the [checkpoint](plugins/checkpoint) plugin), and a failure goes back to the session to fix. If `main` moved while the task ran, Even Keel runs the check again on `main` in the next task's worktree before that task starts; a failure there is handled like a red CI.
- **Languages.** The page is in English or Russian; the prompts Even Keel sends to sessions can be in either, separately.

## Requirements

- **Node.js 24** or newer ([nodejs.org](https://nodejs.org/en/download); on Linux nvm needs no `sudo`), and git with your name and email set (`git config --global user.name` and `user.email`): sessions commit and merge under them.
- **Claude Code CLI** ([install](https://docs.claude.com/en/docs/claude-code/setup)), logged in with a Claude subscription (`claude` once in a terminal). Even Keel finds the native install in `~/.local/bin` (`claude.exe` on Windows), then the binary of the VS Code extension, then `claude` on `PATH`; `EVEN_KEEL_CLAUDE_BIN` overrides.
- **Codex CLI** (optional, only for projects or tasks on Codex): `npm install -g @openai/codex`, signed in with `codex login` or from the accounts page. Its own folder is `CODEX_HOME` or `~/.codex`, the accounts added from the page live in `~/.codex-accounts`; `EVEN_KEEL_CODEX_BIN` overrides the binary. Checked on **codex-cli 0.162.1**.
- **A tracker:** a Huly workspace, GitHub repositories with Issues, or a Linear workspace.
- **Statistics** need nothing more: the database is embedded. An external Postgres is optional.
- Windows, Linux or macOS. Windows is where it runs every day; Linux was checked end to end under WSL and on a clean Ubuntu server, by this README; macOS is expected to work but has not been checked.

## Before you run it

- **Even Keel depends on undocumented behaviour of the Claude Code CLI**: `claude agents --json`, the `sessions/<pid>.json` records, the background daemon (`claude --bg`, `claude daemon`), the transcript format, the text of `/usage`, the layout of `~/.claude.json` and `.credentials.json`. None of it is a public API. Last checked against **Claude Code 2.1.301**. A CLI update may break a part of Even Keel until it is adapted — please open an issue when it does.
- **Your subscription, Anthropic's terms.** Sessions run on the subscriptions you sign in with, through the unmodified CLI, and wait out their limits. Their use is governed by Anthropic's [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) and [Usage Policy](https://www.anthropic.com/legal/aup) (the Commercial Terms for Team, Enterprise and API keys). Even Keel does not share, pool or resell access: use accounts that are yours.
- **Sessions run with `--permission-mode auto`**: they act without asking you on each tool call. Set up the permissions and hooks you want in your Claude Code settings before you start a chain.
- Even Keel reads only the expiry dates from `.credentials.json`; tokens stay with the CLI and are never read, copied or sent anywhere.
- **Some behaviour has never been checked live** — macOS, an early reset of Claude limits, a chain on Codex, a few tracker and CI paths. Read [What has not been verified](docs/unverified.md) before relying on any of them.

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

- a git repository with a main branch — `main` unless the project names another in `branch`; with a remote, Even Keel pushes it after every task;
- the repository trusted by Claude Code: open `claude` in it once and accept the trust prompt, or the first launch pauses the chain and asks for it (accepting it in the repository covers the task worktrees the message names; then press **Resume**: the chain does not retry by itself);
- a rule that the session merges its branch when done. Without the plugin ([level 2](#2-with-the-plugin)) put it into the project's `CLAUDE.md`, for example:

  > When the task is done and the checks pass, commit, then merge the branch into `main` (the project's main branch) in the main checkout with `git merge --no-edit <branch>`. Do not remove the worktree or the branch afterwards.

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
2. Give the MCP server its credentials in the `env` of `~/.claude/settings.json` — `HULY_URL`, `HULY_WORKSPACE`, `HULY_TOKEN` (or `HULY_EMAIL` and `HULY_PASSWORD`) for Huly, `GITHUB_PERSONAL_ACCESS_TOKEN` for GitHub, `LINEAR_API_KEY` for Linear. Not system environment variables: Even Keel keeps its own tracker credentials out of the sessions it starts. Do it before you next open `claude` in the project: a server that failed without its credentials is not tried again for 15 minutes. Even Keel sees that and holds the project's next task until the 15 minutes are over, with a warning on the page; a session already running without the server says the tracker's MCP server did not connect — press **New session** on it once the wait is over.
3. Turn the brief off for the project, or the session reads its task twice: `{ "repo": "…", "brief": false }`. With `brief` off Even Keel checks that the project's sessions see the tracker's MCP server and warns on the page when they do not.

The GitHub skill sets "blocked by" links through the [GitHub CLI](https://cli.github.com/), so `gh auth login` once. Everything else — troubleshooting, what the skills do — is in [plugins/huly/README.md](plugins/huly/README.md), [plugins/github/README.md](plugins/github/README.md) and [plugins/linear/README.md](plugins/linear/README.md).

### Several trackers

Each project has its own tracker (`tracker` in the project's entry, or one for all at the top level), and they work at the same time: project A on Huly, project B on GitHub. There is one connection per kind of tracker — one Huly workspace, one GitHub token, one Linear key. Several connections of the same tracker are not supported yet.

### 4. Run

Without a service, on any system:

```sh
npm start
```

and open `http://localhost:4747`. Open a project, press **Start**: the chain takes its first task. Other projects can be queued after it. The page can be installed as an app (the install button in the address bar of Chrome or Edge) and then opens in its own window; browsers offer this on `localhost` or over HTTPS only.

Sessions can be answered from the page's chat or the tracker. To answer them in Claude's own app as well, turn on Remote Control at startup in `/config` of Claude Code; the page links each session's Remote Control.

### Reaching the page from another machine

By default the page listens on `127.0.0.1` only, and nothing else on the network sees it. That is on purpose: the page starts sessions with automatic permissions, writes answers into waiting sessions and signs Claude accounts in and out, so whoever reaches it drives your machine. Every request is also checked whatever `EVEN_KEEL_HOST` is:

- its `Host` must be `localhost`, `127.0.0.1`, `[::1]`, `EVEN_KEEL_HOST` or a name in `allowedHosts`, otherwise it gets 403. This stops DNS rebinding — a foreign site whose name was pointed at `127.0.0.1`;
- an `Origin`, if the request has one, must be one of the same names, so another site open in your browser cannot post to the page. Requests without `Origin` (the plugins' hooks, `curl`) pass.

Two ways to reach it from elsewhere:

- **A proxy on the same machine** (recommended). For example a Tailscale Service, `tailscale serve --service=svc:even-keel --https=443 http://localhost:4747`, which also gives the page HTTPS, so it can be installed as an app. The proxy forwards the name it was reached by, so put that name into `allowedHosts`: `"allowedHosts": ["even-keel.example.ts.net"]`. Its requests come from loopback, so the page asks them for no token: who gets in is decided by the tailnet's access rules.
- **Listening on the network.** Set `EVEN_KEEL_HOST` in `.env` to `0.0.0.0` or the machine's address, put the names or addresses you open it by into `allowedHosts` (the configured address itself is let in), and set `EVEN_KEEL_TOKEN` in `.env`. Without the token the service does not start. A request from another machine then needs the token: open the page once as `http://<address>:4747/?token=<token>`, and the service keeps it in an `HttpOnly`, `SameSite=Strict` cookie and drops it from the address; scripts send `Authorization: Bearer <token>`. Plain HTTP shows the token to anyone on the way, so prefer a proxy with HTTPS.

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

### Updating

The gear menu in the header ends with the installed version. Even Keel asks GitHub for its latest release at start and every 12 hours (a request to `api.github.com` without a token; it names only the installed version); a newer one gets a link next to the version and a notification in the corner of the page. Turn the check off on `/settings` → **Interface** or with `"updates": { "check": false }` in the config. To update:

- **run from a terminal** — stop Even Keel, then `git pull`, `npm ci`, `npm run build` and `npm start`;
- **as a service** — `git pull`, then run its install script again: it installs the dependencies, builds the page and restarts the service.

On Windows a running Even Keel holds files in `node_modules`: `npm ci` next to it fails with `EPERM` and leaves the folder half-removed. Stop Even Keel and run `npm ci` again. Running sessions are not stopped by any of this: they belong to the CLI's daemon, and the restarted Even Keel picks them up.

The plugins come with the code. A marketplace added from the local path of this folder is read from the folder, so sessions started after the update get the new plugins. One added from a git URL keeps its own copy: `claude plugin marketplace update even-keel`, then `claude plugin update huly@even-keel` (or `github@…`, `linear@…`, `checkpoint@…`) in each project repository that installed it.

A new version may store the config and `state/` in a newer format: at startup, before anything else, Even Keel rewrites them to it and keeps each old file next to it as `<file>.v<N>.bak` (the log names them). It rewrites all of them or none; a file it cannot read, or one written by a newer version, leaves the service with only the page, which shows the reason.

To go back to the previous version: stop Even Keel (as a service — stop the service), check out the previous version's code (`git checkout <commit>`), put the `.bak` copies back in place of the rewritten files, then start it again (as a service — run its install script). Stop it first: a running Even Keel rereads the restored config and may write over the restored files. What the newer version wrote since the update — launches, the chain's state — goes with the `.bak`. The checkout leaves git on a detached commit, so the next update starts with `git checkout main` before `git pull`.

The statistics database is versioned too: the collector brings its schema up to date on its first run after the update, step by step, each step in one transaction. Going back to an older version does not undo that: the older collector stops on a newer database (one line in the log) and `/stats` says so, until you update again or restore a backup of the database taken before the update (`<state>/tally/pgdata` for the embedded one). On your own Postgres the collector migrates as `tally_writer`; if it is not the owner of the tables, it changes nothing and logs the statements to run and the role to run them as.

### Uninstall

`service\uninstall.ps1` (PowerShell 7 as administrator) or `service/uninstall.sh` stops and removes the service and nothing else. Sessions it started keep running: they belong to the CLI's daemon, so finish or stop them first (`claude agents` lists them). The rest stays where it is, for you to remove by hand:

- **The Even Keel folder** — the code, `.env` with the tracker credentials, the config, `logs/` (Windows and macOS; on Linux the log is the journal), and `state/` (`EVEN_KEEL_STATE_DIR`) with the chain, the launch log and the embedded statistics database (`state/tally/pgdata`). Deleting the folder removes all of it. On your own Postgres the statistics stay in that database.
- **In each project's repository** — the worktrees of unfinished tasks in `.claude/worktrees/` with their branches `<key>-<number>/task` (`git worktree list`, then `git worktree remove` and `git branch -d`), the slots of a project with `slot`, and the line `.claude/worktrees/` Even Keel added to `.git/info/exclude`. With the plugin: `claude plugin uninstall huly@even-keel --scope project` (or `github@…`, `linear@…`) and commit `.claude/settings.json`.
- **In your Claude Code config** — the plugin credentials in the `env` of `~/.claude/settings.json`, the marketplace (`claude plugin marketplace remove even-keel`), and the extra account folders in `~/.claude-accounts` (`EVEN_KEEL_ACCOUNTS_DIR`), each still signed in until you run `claude auth logout` with its `CLAUDE_CONFIG_DIR`; the Codex ones in `~/.codex-accounts` (`EVEN_KEEL_CODEX_ACCOUNTS_DIR`) the same, with `codex logout` and its `CODEX_HOME`. Project memory moved to `~/.claude-memory/<project>`, with `~/.claude/projects/<project>/memory` linking to it: Claude Code keeps using it through the link, so leave it unless you want the memory gone too.

## Environment

`.env` in the repository root. A tracker whose variables are all empty is off; set in part, it is a startup error.

| Variable | |
| --- | --- |
| `HULY_URL`, `HULY_WORKSPACE`, `HULY_EMAIL`, `HULY_PASSWORD` | Huly adapter |
| `GITHUB_TOKEN` | GitHub adapter |
| `LINEAR_TOKEN` | Linear adapter |
| `FORGEJO_TOKEN` | CI runs on a Forgejo remote: a token with read access to repositories. GitHub Actions on a `github.com` remote takes `GITHUB_TOKEN`, which then also needs **Actions: Read**. Without its token a CI shows as not connected |
| `EVEN_KEEL_ACCOUNTS_DIR` | folder of the extra Claude account folders; default `~/.claude-accounts` |
| `EVEN_KEEL_CLAUDE_BIN` | path to the `claude` binary |
| `EVEN_KEEL_CODEX_BIN` | path to the `codex` binary; default the native one of the global npm package on Windows, `codex` elsewhere |
| `CODEX_HOME` | Codex's own folder, its first account; default `~/.codex` |
| `EVEN_KEEL_CODEX_ACCOUNTS_DIR` | folder of the Codex account folders added from the page; default `~/.codex-accounts` |
| `EVEN_KEEL_CONFIG` | path to the config; default `even-keel.config.json` in the root |
| `EVEN_KEEL_HOST`, `EVEN_KEEL_PORT` | where the page listens; default `127.0.0.1` and `4747`. Any other address than loopback needs `EVEN_KEEL_TOKEN` ([Reaching the page from another machine](#reaching-the-page-from-another-machine)). Read at startup; `host` and `port` left in an older config are not read, the log says so once |
| `EVEN_KEEL_TOKEN` | the page's token for requests from other machines; required when `EVEN_KEEL_HOST` is not loopback, 16+ characters of `A-Z a-z 0-9 . _ ~ + / = -`, e.g. `node -e "console.log(crypto.randomBytes(24).toString('hex'))"`. Read at startup |
| `EVEN_KEEL_STATE_DIR` | where state lives (chain order, accounts, launch log, statistics database); default `state/` |
| `TALLY_DB_HOST`, `TALLY_DB_PORT`, `TALLY_DB_NAME`, `TALLY_WRITER_PASSWORD`, `TALLY_READER_PASSWORD` | your own Postgres for the statistics instead of the embedded one: the collector writes as `tally_writer`, the page reads as `tally_reader`. `tally/deploy/` has a Compose file that creates both roles |
| `TALLY_LLM_URL`, `TALLY_LLM_KEY`, `TALLY_LLM_MODEL` | optional classifier of the stuck spans on `/stats`: an OpenAI-compatible endpoint, its key and a model it serves; without them the spans are found but not explained |

## Configuration

`even-keel.config.json`, starting from [even-keel.config.example.json](even-keel.config.example.json). Everything in it except adding a project can be edited on the page: a project's keys on its page (**Settings**), the shared ones on `/settings`, behind the gear in the header. Once the chain has started a task of a project, the page no longer switches that project's tracker or tracker project; moving a live project to another tracker is planned for v0.2. The page writes only the keys you changed and keeps the rest of the file as it is; editing the file by hand works too, even with a form open: a save does not overwrite a hand edit of a field you did not touch, and a field changed in both places is marked. The service rereads it on the fly: `tracker`, `context`, `projects` and a project's `repo`, `slot`, `tracker`, `github` and `linear` apply after a restart (the page marks them), the rest at once. A broken file keeps the last good one running and shows the error on the page, next to the field when it has one.

| Key | Default | |
| --- | --- | --- |
| `allowedHosts` | `[]` | host names the page may be opened by besides `localhost`, `127.0.0.1`, `[::1]` and `EVEN_KEEL_HOST`, such as a proxy's name; any other `Host` gets 403 |
| `tracker` | `huly` | tracker of every project that does not name its own: `huly`, `github` or `linear` |
| `brief` | `true` | put the task's title and description into the prompt; `false` for projects whose sessions read the task through the tracker's plugin |
| `parallel` | `1` | how many chains on different projects run at once; the rest wait in the queue. Lowered, it stops nothing: no new chain starts until fewer run |
| `chain.active` | ready and in-progress categories | status names that enter the chain |
| `chain.terminal` | done and canceled categories | status names that close a task |
| `chain.requiredLabels` | `[]` | a task needs at least one of them; empty — no label needed |
| `chain.excludedLabels` | `["Manual", "Вручную"]` | a task with one of them never enters the chain: you run it yourself; while open, it still holds the tasks it blocks |
| `version` | — | version of the file's format; Even Keel writes it and [migrates](#updating) an older file itself. A file newer than the code is not read |
| `projects` | — | an array of projects, each an object with the keys below |
| `projects[].key` | — | the tracker's project key (a letter, then up to four letters, digits or `_`) |
| `projects[].id` | given at startup | the project's own id, a GUID that never changes; the files of `state/` and the page's links name the project by it. Add a project without one: Even Keel writes it into the file at the next start |
| `projects[].repo` | — | path to the main checkout |
| `projects[].name` | none | display name shown next to the key; the page edits it in the project head |
| `projects[].branch` | `main` | the project's main branch: tasks branch off it and merge into it, the CI and the check judge it. A branch missing from the repository pauses the chain |
| `projects[].tracker`, `.brief`, `.chain` | the shared ones | per project; a project's `chain` key replaces the shared key whole; `null` for `active` or `terminal` goes back to the status categories over a shared list |
| `projects[].github` | — | `owner/name` of the repository, for a project on GitHub |
| `projects[].linear` | the whole team | name of the Linear project the team is narrowed down to, for a project on Linear (the key is the team key) |
| `projects[].slot` | off | `true` or a number: a pool of permanent worktrees instead of one per task |
| `projects[].prompt` | none | text added to the prompt of every new session of the project (first start and handoff; a resumed session already has it); empty — none |
| `projects[].commands.beforeStart` | `[]` | shell commands (`cmd.exe` on Windows) run in order in the task's worktree or slot before a new session starts, such as `npm ci`; output goes to the service log. A failed one pauses the chain with its output on the page; a resumed session does not run them again |
| `projects[].ci.guard` | `true` | `false` — do not guard `main` at all: no wait for a CI, no `commands.check`, no fix of a red `main`; the other `ci` keys are kept for when it is back on |
| `projects[].ci.kinds` | `["forgejo", "github"]` | the CIs whose verdict on a pushed `main` the next task waits for; empty — none |
| `projects[].commands.check` | `[]` | the project's check, run in order when no CI of `ci.kinds` will judge `main` (none counted, or one not answering): before a session's merge, in its worktree, by the [checkpoint](plugins/checkpoint) plugin's hook — a failure blocks the merge; and on `main` in the next task's worktree when `main` moved during the task — a failure is fixed as a red CI is |
| `projects[].commands.afterGreen` | `[]` | shell commands run in order in the project's main checkout once a pushed `main` is green by the CI or `commands.check`, such as building and restarting the project's service on this machine; only while that checkout is on the main branch at the green commit, once per commit. The next task waits for them; a failure is a warning on the page, not a red `main`. Needs `ci.guard` |
| `projects[].ci.waitMinutes` | none | how long the next task waits for that verdict, in minutes; none — as long as it takes, `0` — not at all (faster, but a task may start on a broken `main`) |
| `projects[].ci.recheckMain` | `true` | `false` — do not run `commands.check` again on a `main` that moved during the task |
| `projects[].ci.fixTask` | `false` | who fixes a red `main`. `false` — a session without a tracker task; the session working on the current task is stopped until the fix is merged and then continued. `true` — a high-priority task created in the tracker, taken after the current one |
| `projects[].provider`, `projects[].models`, `projects[].accounts`, `projects[].modelLabels` | the shared ones | the project's own values of the keys below; an entry of `models` or `accounts` overrides the shared one of that provider only |
| `projects[].fillMilestone` | `false` | `true` — a task that enters the chain without a milestone gets, in the tracker, the milestone of the current task, or the earliest one in the chain; once, so a milestone you change or clear afterwards stays |
| `context` | `{ "window": 600000, "warn": 50, "danger": 80 }` | context bar on the page: window size in tokens, warning and danger thresholds in percent |
| `provider` | `claude` | what sessions run on: `claude` or `codex` |
| `models` | `{ "claude": "opus" }` | model by provider, as the CLI takes it (`--model`, Codex's `-m`), such as `{ "claude": "sonnet", "codex": "gpt-5.6-luna" }`; a provider without one — the CLI's own default (for Codex the model of its `config.toml`) |
| `accounts` | `{ "claude": "global", "codex": "codex" }` | account by provider, by its key on `/accounts`; one per provider, no switching on a spent limit. The entry of `provider` is the account the header shows first and switches; next to it the header shows the limits of every other account a project runs on. An account named here or in a project's own `accounts` cannot be removed |
| `execution` | `{}` | `{ "codex": "bypass" }` runs Codex sessions with `--dangerously-bypass-approvals-and-sandbox` instead of `--approve-for-me`: no sandbox and no automatic reviewer, the agent can do anything your account can. Needed under the Windows service, where the Codex sandbox does not start. Shared only; Claude has no modes |
| `modelLabels` | `false` | read a task's label `<Provider> \| <model>` or a bare `<Provider>` (`Claude \| sonnet`, `Codex`): it picks that task's provider and model. A label of a provider without an account runs the task as its project says; two run labels on a task are ignored |
| `modelPrompts` | `{}` | text added to the prompt of sessions on a model, by its name as the CLI gets it: `{ "haiku": "Keep answers short." }` |
| `stats.compare` | `{ "minTasks": 5, "minSessions": 10, "days": 7 }` | before/after comparisons on `/stats`: minimum sample and days on each side |
| `stats.moves` | `{}` | moved folders on `/stats`, `{ "old path": "new path" }`: sessions in the old one count under the new one |
| `stats.otherBelow` | `0` | folder groups that cost less than this (USD, all time) are shown as one Other row on `/stats` |
| `stats.checkpointTokens` | `null` | context size, from 100000 tokens, at which the [checkpoint](plugins/checkpoint) plugin first asks a chain session for a handoff; `null` leaves it to the calibration shown on `/stats` |
| `language` | the browser's | language of the page: `en` or `ru` |
| `promptLanguage` | `language`, then `en` | language of the prompts Even Keel sends to sessions |
| `hiddenSkills` | `update-config`, `loop`, `schedule`, `init` and a few more | bundled skills that trimmed chain sessions get only through `/name` |
| `cacheTtl` | `null` | prompt cache lifetime of chain sessions, `"5m"` or `"1h"`; `null` leaves it to Claude Code (1 hour on a subscription, 5 minutes on an API key). A 1-hour cache write costs more but survives longer waits |
| `updates.check` | `true` | ask GitHub for the latest Even Keel release at start and every 12 hours, without a token; `false` — never go there ([Updating](#updating)) |
| `updates.notify` | `true` | a newer release gets a notification in the corner of the page; `false` — only the mark next to the version in the gear menu |
| `updates.dismissed` | `null` | the version whose notification you closed; the page writes it, and a later release notifies again |

Statuses are matched by name, case-insensitively. Without `active` and `terminal` the chain goes by status category, so the backlog stays out and a task enters the chain when you move it to a ready status. Status names differ between trackers: if you set them at the top level, a project on another tracker needs its own (GitHub's are `Open`, `Completed`, `Not planned`, `Duplicate`; Linear's are the team's workflow states), as in the example.

## What comes next

Planned for the next release, v0.2:

- **Codex in full.** Chain sessions that keep the Codex sandbox under the Windows service once Codex fixes it there.
- **Setup without a config file.** A wizard on the page adds a project and checks it on the way: the repository and its main branch, the project in the tracker, Claude Code's trust in the folder. Even Keel keeps the settings itself, so there is no file to copy or edit.
- **One executable.** A single downloaded file that runs Even Keel, installs the service and updates it, instead of a clone, Node.js and a build. Windows first, Linux if it works out; macOS keeps `service/install.sh`.

Looked at, not promised: running in Docker, a cap on how much of the usage limit one task may spend, several connections to one tracker (two Huly workspaces, for example).

## Extending

### Your own tracker

The chain never talks to a tracker directly: it reads tasks through an adapter. The contract, with what each field means and what to return when your tracker lacks something, is the JSDoc of [src/tracker/source.ts](src/tracker/source.ts) (`TrackerAdapter`, `TaskSource`). `src/github/` is a compact example, `src/huly/` a fuller one. Register the adapter in [src/tracker/adapters.ts](src/tracker/adapters.ts) and pick it with `tracker` in the config. `brief` and `complete` are optional: without them, sessions must learn the task and close it some other way. So are `card` and `ready`, the task card on the page and its **Move to Todo** button; without them the page links to the task in the tracker.

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

## Security

A vulnerability is reported privately, not as an issue: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

Even Keel is an independent project, not affiliated with or endorsed by Anthropic or OpenAI. Claude and Claude Code are trademarks of Anthropic; Codex and OpenAI are trademarks of OpenAI.
