<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg">
    <img src="assets/logo-light.svg" alt="Even Keel" height="40">
  </picture>
</h1>

**Hand your backlog to [Claude Code](https://docs.claude.com/en/docs/claude-code/overview) or [Codex](https://github.com/openai/codex) and stop babysitting it.** Even Keel takes the open tasks of a project from your tracker, in the order of their `blocks` links, and works through them one at a time while you do something else: a session on the first task, and when its branch lands in `main`, cleanup and the next. It waits out a spent usage limit, hands a long session over to a fresh one and keeps going while you are away. Only what really needs you — a question, a decision — waits for you: on its page, in the tracker or on your phone.

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

- **The chain.** Tasks enter the chain by status (by default: ready and in-progress tasks — not the backlog, not closed ones) and by labels you choose; a task labelled `Manual` or `Вручную` never enters it, it is yours to run. Order: open blockers first, then the order you set by dragging on the page, then milestone, priority, task number. A task with an open blocker waits; a task with subtasks never runs itself — its subtasks do, and on Huly Even Keel closes it once they are all closed.
- **Sessions.** Each task gets a background session (`claude --bg`) in its own git worktree `.claude/worktrees/<key>-<number>` on a branch `<key>-<number>/task`, made from `main` (or the project's `branch`; `main` below means that branch). The session does the task and merges its branch into `main`; Even Keel sees the merge, closes the task in the tracker, stops the session, removes the worktree and the branch, and syncs `main` with the remote. What a session runs on — the provider, its model and its account — is set in the config, shared and per project; Claude sessions run on Opus by default, whatever `/model` last saved in the CLI settings. With `modelLabels` on, a task's label `Claude | sonnet`, `Codex | gpt-6.1-sol` or a bare `Codex` picks it for that task; a label of a provider with no account set runs the task on the project's provider and says so in a toast.
- **Codex (preview).** The shared or a project's `provider` key (the shared one is also moved by giving the Even Keel role to the Codex account on the accounts page), or a `Codex` label on a task, runs the task's sessions on the OpenAI Codex CLI instead: one `codex exec --json` per turn, the transcript, context fill and limits (5-hour and weekly, or the free plan's 30-day one) read from Codex's own session files, the project's packages passed on every turn. Codex has no question tool, so a turn that ends without the task done waits for your reply in the chat window. Run as a chain only on short test tasks. From the Windows service the Codex sandbox does not start (a Codex bug), so on Windows it needs `execution.codex` set to `bypass`, which runs Codex sessions with no sandbox at all ([docs/unverified.md](docs/unverified.md#codex)).
- **Slots.** For repositories with heavy ignored caches (Unity's `Library`, big `node_modules`) a project can use a pool of permanent worktrees instead of a fresh one per task, so the next task rebuilds only the difference.
- **Handoffs.** A session that hit the usage limit is resumed after the reset if its prompt cache is still warm, otherwise stopped and replaced by a new session in the same worktree with a handoff prompt. The same handoff happens when a session ends its turn with a `CHECKPOINT: <path to a note>` line — the [checkpoint](plugins/checkpoint) plugin asks for it once the context grows past a threshold, 200k tokens until the project's own statistics give a better one, and stops asking below 300k after three handoffs of a task — and when you press **New session** on the page.
- **Chat with the session.** The **Chat** button of the current session opens its whole transcript with a reply box: the session's questions one at a time as a card with radio buttons or checkboxes, free text and files — picked with `+`, pasted with Ctrl+V (a screenshot straight from the clipboard) or dropped on the window — which land in the task's `.temp/inbox/`. Pictures the session read and the ones you sent show as thumbnails that open full-window, with a pager through all of them. The button turns amber while the session waits for you. Even Keel stops the session and resumes it with your answer. You can also write to a session while it works ("not there", "mind X too"): a hook of the [checkpoint](plugins/checkpoint) plugin hands the message over at its next tool call or at the end of the turn, without stopping it, and the chat shows whether it waits, was delivered, or came back because the session asked a question meanwhile. A question with options is also posted to the tracker as a numbered comment; reply with `2`, `1, 3` or text. Remote Control still works for Claude sessions: the page links each one's Remote Control.
- **Task cards.** A click on a task's title opens its card: the description and comments rendered from Markdown, labels with what each means to the chain, milestone, priority, and the tasks it blocks, waits for or relates to. A backlog task moves to Todo from its card, straight from the backlog panel or, when it holds a chain task, from its locked row in the chain, so the phone rarely needs the tracker's own page. On GitHub there is no backlog, so no Todo button. The milestone on the card is a pick: choosing another one moves the task there in the tracker at once, and the chain reorders. Tracker changes reach the page on the next poll, every 30 seconds; the refresh button in the project head reads the tracker now.
- **Changelog drafts.** A button on a milestone's head in the chain has the agent write that milestone's changelog section in the Keep a Changelog format, from the titles and closing comments of its done tasks, in the language of your `CHANGELOG.md` (or `README.md`). It runs read-only, on the account and model the project's next session would get, and starts from the section already in your changelog file, so your own edits there stay. You ask for changes in words and see them highlighted, with what each turn cost and on which account; "Write" puts the section into the file (the project setting `changelog`, `CHANGELOG.md` by default) and commits it to the main branch of your checkout; tasks closed later are added to the section with one button, and a released version's section is left alone.
- **Hands off a stopped session.** A session that asks a question or fails is left alone: you answer it or move the task in the tracker yourself. Even Keel never writes into a session that stopped on its own — only your own answer goes in, and only while the session waits for it. You can skip a task, and a session that files a blocker for its task gets the task postponed until the blocker is done.
- **Unattended mode.** For when nobody will answer — a switch in **Settings → Chain** (the gear in the header). Sessions are told to ask nothing, to do everything a question does not hold, and to park a task held by one: committed on its branch, unmerged, the question left in the task, the task moved to Backlog. A session that sits 10 minutes without the task done is skipped, and the session of a done task that stays busy for 10 quiet minutes is no longer waited for, so one stuck session does not stop the whole run.
- **Lean sessions.** Chain sessions start without claude.ai skills and plugins, and with niche bundled skills reachable only through `/name`, so their skill listing does not eat the context; the project's own settings still win. It is a switch in **Settings → Sessions**, and the settings files stay untouched. The `/tools` page shows what sessions get, for one project or several side by side: what will not reach them, settings by level, and the skills and tools the last session actually saw.
- **Packages.** Plugins and MCP servers are a set per project, kept by Even Keel and given to chain sessions by flags at every launch: a pinned version installed with one button, updated with another, while a running task stays on the version it started with. MCP servers run behind a local gateway, so the keys stay in Even Keel's `.env`. Codex sessions get the same set: the MCP servers, and of a plugin its skills and hooks (not its commands and agents), installed into each Codex folder on its first turn there and kept off for your own Codex sessions. The chain does not start a task while a package of its project is not installed, lacks a key or does not answer.
- **Accounts.** Your own Claude and Codex subscriptions — a personal and a work one, say — one config folder each. At most one Codex account may be on the free plan: OpenAI's terms do not allow several free accounts to get round the limits, so Even Keel refuses a second one ([docs/accounts.md](docs/accounts.md#the-codex-folders-btn-168-btn-176)). The `/accounts` page lists them in a section per provider (Claude Code, Codex), as cards with their connection, limits and what runs on each now (VS Code chats by their tab titles); a section's "Add" asks for the connection (CLI or API key), then shows that kind's own sign-in; a provider whose CLI is not installed cannot be added, and the page says where to get it. Without the CLI's own folder (`~/.claude`, `~/.codex`), the first account of a provider you add is the one its sessions run on. Renew and remove accounts there, and move Even Keel's chain to an account from that account's card. The same field moves the Claude Code extension in VS Code; the Claude desktop app is not switched, but can be launched on an account folder by hand ([docs/accounts.md](docs/accounts.md#the-claude-desktop-app)). An account can also be an Anthropic API key, checked with Anthropic when added and then hourly: its sessions pay from the key, the page shows its spend today instead of limits (with statistics on), and it has no Remote Control and no waiting out a limit; a session whose key runs out of credit is held, the key is checked every 5 minutes, and the chain goes on once it is topped up ([docs/accounts.md](docs/accounts.md#api-accounts-btn-99)). A Codex account can be an OpenAI API key the same way, checked with OpenAI; a Codex session whose key runs out of money is held the same way, the key checked with OpenAI.
- **Limits.** The 5-hour and weekly windows of every account, read with the CLI's own `/usage` command (no quota spent). Even Keel stays inside them: while a window is exhausted the next task waits for its reset.
- **Statistics (optional).** A built-in collector (Tally) reads the session transcripts every five minutes into an embedded Postgres ([PGlite](https://pglite.dev)) or your own: spend by day and project, cost and time per task, where sessions got stuck, slow commands, estimates against actual time, and before/after comparisons of changes to your rule files. All of it on the `/stats` page. On the first start the page asks whether you want it — no stats, the local database or your own Postgres — and nothing is collected until you choose; the copy takes about a third of the transcripts' size. Switch it on or off any time in Settings → Stats: it applies at once, and turning it off deletes no data. Without stats the checkpoint threshold stays at 200k tokens. A comparison is easier to judge when you know why a rule changed: add the hook `tally/bin/rule-hook.mjs` to `~/.claude/settings.json` and a session that edits a `CLAUDE.md`, skill, hook, agent or settings file is asked to log the reason in `<state>/rule-history.jsonl` (`ruleHistory` in `tally/tally.config.json`), which `/stats` attaches to the change:

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
- **Claude Code CLI** ([install](https://docs.claude.com/en/docs/claude-code/setup)), logged in with a Claude subscription (`claude` once in a terminal). Even Keel finds the native install in `~/.local/bin` (`claude.exe` on Windows), then the binary of the VS Code extension, then `claude` on `PATH`; `EVEN_KEEL_CLAUDE_BIN` overrides. Chain sessions run on Even Keel's own copy of the checked version once it is downloaded ("Before you run it").
- **Codex CLI** (optional, only for projects or tasks on Codex): `npm install -g @openai/codex`, signed in with `codex login` or from the accounts page. Its own folder is `CODEX_HOME` or `~/.codex`, the accounts added from the page live in `~/.codex-accounts`; `EVEN_KEEL_CODEX_BIN` overrides the binary. Checked on **codex-cli 0.162.1**.
- **A tracker:** a Huly workspace, GitHub repositories with Issues, or a Linear workspace.
- **Statistics** are optional and need nothing more: the database is embedded. An external Postgres is optional too.
- **PowerShell 7** on Windows, for installing the service. The MSI installers of Node and PowerShell 7 can sit on "Preparing to install…" for a long time — over 10 minutes on a machine with 4 GB of RAM — and then go through: wait it out.
- Windows, Linux or macOS. Windows is where it runs every day; Linux was checked end to end under WSL and on a clean Ubuntu server, by this README; macOS is expected to work but has not been checked.

## Before you run it

- **Even Keel depends on undocumented behaviour of the Claude Code CLI**: `claude agents --json`, the `sessions/<pid>.json` records and the `jobs/<id>/state.json` job files, the background daemon (`claude --bg`, `--bg --resume`, `claude daemon`), the transcript format, the text of `/usage`, the layout of `~/.claude.json`, `.credentials.json` and `plugins/installed_plugins.json`. None of it is a public API. Last checked against **Claude Code 2.1.303**: a version becomes the checked one after one live session on it went through a launch, a question answered from the chat, the chat's feed, a checkpoint and a stop (`npm run cli-check`, [docs/releases.md](docs/releases.md)). So chain sessions run on that version, not on the one your CLI has updated itself to: Even Keel downloads it from Anthropic into `state/cli/claude/<version>/` (~270 MB a version, checked against Anthropic's sha256) at the first call, runs the installed CLI until the download ends, and turns the auto-updater off for those sessions so they never update your own install ([docs/sessions.md](docs/sessions.md#the-checked-cli-btn-250-srcagentpinnedts)). Settings → Models, "CLI version", `Installed` puts a provider back on your CLI; the page shows a banner while sessions would run on another version than the checked one. The pin has limits:
  - A session runs on the version of its account folder's daemon. A daemon on another version is restarted only once no session of that folder is live, and a newer `claude --bg` or `claude agents` run in the same account folder replaces the pinned daemon with its own version: keep your own background sessions out of the chain's account folder. Whether a terminal reaches the service's daemon on Windows to do that has not been checked.
  - Anthropic's servers may refuse an old version, and an old version may not know a new model's alias; Codex lists models by the client's version. Then the checked version is raised in a new release of Even Keel.
  - The transcripts your own sessions write on a newer version are read as before: the pin covers how chain sessions are run, not those files.

  A CLI update may break a part of Even Keel until it is adapted — please open an issue when it does.
- **The same goes for the Codex CLI**: the events of `codex exec --json` (`thread.started`, `item.completed`, `turn.completed`, `turn.failed`), `-c` overrides of its config keys (`mcp_servers`, `marketplaces`, `plugins`, `hooks.state`), the rollout files `sessions/YYYY/MM/DD/rollout-*.jsonl` and their `session_meta`, `turn_context`, `event_msg` (`token_count` with the context fill and the rate limit windows, `task_complete`, errors) and `response_item` lines, the `plugin/install` and `hooks/list` calls of `codex app-server`, the `[plugins.*]` tables of `config.toml` and the `plugins/cache` layout, the claims of the ID token in `auth.json`, the text of `codex login status` and of its quota errors, and the layout of the npm package on Windows. Last checked against **codex-cli 0.163.0** the same way, and Codex sessions run on that version the same way: Even Keel unpacks the platform's npm package `@openai/codex@<version>-<platform>` (Apache-2.0, checked against the registry's sha512) into `state/cli/codex/<version>/`.
- **Your subscription, the providers' terms.** Sessions run on the accounts you sign in with, through the unmodified `claude` and `codex` CLIs, and wait out their limits: a project runs on one account per provider, and a spent limit is never got round by switching to another account ([docs/sessions.md](docs/sessions.md#run-profiles-btn-173-srcsessionslaunchts)). Claude sessions are governed by Anthropic's [Consumer Terms](https://www.anthropic.com/legal/consumer-terms) and [Usage Policy](https://www.anthropic.com/legal/aup) (the [Commercial Terms](https://www.anthropic.com/legal/commercial-terms) for Team, Enterprise and API keys). Codex sessions are governed by OpenAI's [Terms of Use](https://openai.com/policies/terms-of-use/) and [Usage Policies](https://openai.com/policies/usage-policies/) when you sign in with ChatGPT (the [Services Agreement](https://openai.com/policies/services-agreement/) for Business, Enterprise, Edu and API keys), with the [Service Terms](https://openai.com/policies/service-terms/) on top. OpenAI's terms do not allow getting round its usage limits, so Even Keel keeps at most one Codex account on the free plan: it refuses to add a second and starts no session on one signed in some other way. An API key pays from your own account with its provider. Even Keel does not share, pool or resell access: use accounts that are yours.
- **Sessions run without asking you on each tool call**: Claude sessions with `--permission-mode auto`, Codex sessions with `--approve-for-me`, or with no sandbox at all when `execution.codex` is `bypass`. Set up the permissions and hooks you want in your Claude Code and Codex settings before you start a chain.
- Even Keel reads only the expiry dates from Claude's `.credentials.json`, and only the e-mail and the plan from the ID token in Codex's `auth.json`; sign-in tokens stay with the CLIs and are never copied or sent anywhere. An API key you add is written into its account folder, where the CLI reads it, and is sent only to its own provider, to check it.
- **Some behaviour has never been checked live** — macOS, an early reset of Claude limits, long chains on Codex, a few tracker and CI paths. Read [What has not been verified](docs/unverified.md) before relying on any of them.

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
```

`.env` holds the tracker credentials ([below](#environment)) and is ignored by git. The projects and the settings live in Even Keel's database and are edited on the page ([reference](#configuration)); there is no file to create: the first start has no projects and the page opens the wizard that adds one. You give it the repository folder, pick a tracker profile (or add one right there) and the project in that tracker, which it suggests from the tracker's list and, on GitHub, from the repository's remote. The wizard checks the repository and its main branch (it suggests the checkout's current branch), the project in the tracker (it shows how many open tasks it sees), Claude Code's trust in the folder and where tasks run — a worktree per task or a pool of slots. A project is removed at the bottom of its **Settings** → **Repository**; the page refuses while its chain runs or waits in the queue, a session works for it or in its folders, or a task still holds a place, and says which. Removal does not touch the repository, its worktrees or branches.

Each project needs:

- a git repository with a main branch — `main` unless the project names another in `branch`; with a remote, Even Keel pushes it after every task;
- the repository trusted by Claude Code: open `claude` in it once and accept the trust prompt, or the first launch pauses the chain and asks for it (accepting it in the repository covers the task worktrees the message names; then press **Resume**: the chain does not retry by itself).

The rule that a session commits and merges its branch into `main` when the task is done comes with the launch and handoff prompts, plugin or not (in PR mode the prompt says to end the turn for a pull request instead).

### 3. Pick how sessions work with the tracker

#### 1. Minimum: the adapter only

Even Keel reads the tasks itself, puts the title and description of the task into the session's prompt, and closes the task when its branch lands in `main`. You add a **tracker profile** on `/settings` → **Access** → **Add profile**, and nothing else: pick the tracker, fill in its fields, press **Check** — Even Keel signs in and shows whom as — then **Save**. A profile is saved only once the tracker took it; the page never shows a saved token or password again. Profiles live in Even Keel's state database on your machine, not in git.

- **Huly:** the server address, the workspace, and the e-mail and password of a separate Huly account with access to the projects — create one for Even Keel. A token instead only if your Huly shows an API tokens page in the account settings: released self-hosted Huly has none, and its sign-in token comes from the e-mail and password anyway ([plugins/huly/README.md](plugins/huly/README.md#credentials)). The project key in the config is the Huly project identifier (`ABC` for `ABC-12`).
- **GitHub:** a [fine-grained token](https://github.com/settings/personal-access-tokens/new) with **Issues: Read and write** on the repositories, and **Actions: Read** if you want to see their GitHub Actions. A fine-grained token covers one owner: a personal repository and an organization's need a profile each. The profile shows when its token expires. A project names its repository: `{ "repo": "…", "tracker": "github", "github": "octo-org/abc" }`. GitHub has no backlog, so keep entry to the chain on a label: `"chain": { "requiredLabels": ["ready"] }`. Details and the mapping of statuses, blockers, sub-issues and priorities: [plugins/github/README.md](plugins/github/README.md).
- **Linear:** a [personal API key](https://linear.app/settings/account/security) with write access. The project key in the config is the team key (`ENG` for `ENG-12`); `"linear": "Web app"` narrows the team down to one Linear project: `{ "repo": "…", "tracker": "linear", "linear": "Web app" }`. Details and the mapping: [plugins/linear/README.md](plugins/linear/README.md).

On this level the session does not write to the tracker. What you do not get:

- **Postponing on a blocker.** The session cannot file a blocker for its task, so it cannot hand the task back and let the blocker run first. Blockers you link yourself still order the chain.
- **Question tasks.** A session cannot file a `Question: …` task for a decision it took on its own; it can only tell you in its final message.
- **Comments and decisions.** Nothing is written back: no closing comment, no decisions folded into the description, no new tasks for bugs found on the way.
- **Attachments and discussion.** The session sees only the title and the description.

#### 2. With the plugin

On top of the adapter, a Claude Code plugin from this repository gives the sessions the tracker's MCP server and a skill for working a task: the session reads the task and its attachments, records decisions in the description, files blockers and question tasks, creates new tasks, leaves a closing comment and merges.

Even Keel offers its own plugins from this folder, with no marketplace to add first:

1. On the `/tools` page, press **Add a package** under Packages, choose **Plugin** and pick `huly@even-keel` (or `github@even-keel`, `linear@even-keel`) for every project or one. Even Keel copies the plugin, installs a pinned version of its MCP server and gives both to every chain session at launch; turn it off per project in the table. A plugin your projects already had enabled when you upgraded is in the table already.
2. The MCP server takes the credentials of the project's tracker profile: it runs behind a local gateway on `127.0.0.1:4748` (`EVEN_KEEL_MCP_PORT`), so the sessions never see them. Another key a package needs shows in **Keys** on the same page, and the project's chain waits until it is set.
3. Nothing to switch off: once a package of the project brings the tracker's MCP server, the prompt carries only the task ID and the session reads the task itself (`brief` left as auto). `brief: true` or `false` overrides that; with `false` the chain waits while no package of the project brings the server.

Sessions you start by hand get none of this. For them, Claude Code needs this repository as a marketplace: `/tools` offers to add it with a button while your default config (no `CLAUDE_CONFIG_DIR` set) does not know it, or run `claude plugin marketplace add <git URL or local path of this repository>` yourself. Then `claude plugin install huly@even-keel --scope project` in the project and the credentials in the `env` of `~/.claude/settings.json` (`HULY_URL`, `HULY_WORKSPACE`, `HULY_TOKEN` or `HULY_EMAIL` and `HULY_PASSWORD`; `GITHUB_PERSONAL_ACCESS_TOKEN`; `LINEAR_API_KEY`). Even Keel writes the default profile of each tracker there itself; a session started by hand never gets another profile.

The GitHub skill sets "blocked by" links through the [GitHub CLI](https://cli.github.com/), so `gh auth login` once. Everything else — troubleshooting, what the skills do — is in [plugins/huly/README.md](plugins/huly/README.md), [plugins/github/README.md](plugins/github/README.md) and [plugins/linear/README.md](plugins/linear/README.md).

### Several trackers

Each project has its own tracker (`tracker` in the project's entry, or one for all at the top level), and they work at the same time: project A on Huly, project B on GitHub. A tracker can have several profiles — two Huly workspaces, a personal GitHub token and an organization's — and each project picks one (the **Profile** field when you add it, or in its settings until its first task runs). One profile of each tracker is the default: projects without a choice run on it, it is the one sessions started by hand get, and it gives the GitHub Actions token to projects of other trackers. A profile whose token is refused turns red on **Access**, and the chains on it pause until it is fixed.

Git is not part of this: pushes go through your own git and its credentials (SSH, the credential manager), whatever the profiles are. A project on Huly with a remote on GitHub works as is, and its CI is found by the remote.

The CI is read with a profile too. GitHub Actions on a `github.com` remote takes the token of the project's GitHub profile, or of the default GitHub profile for a project on another tracker; it needs **Actions: Read**. CI on a Forgejo remote takes a **Forgejo** profile (**Add profile** → Forgejo: the server's address and an access token with read access to repositories and to the user) on the remote's host. With several GitHub or Forgejo profiles, a project can pick the one its CI and pull requests take in **Settings** → **Check and CI** (`remoteProfiles`); "Automatic" is the choice above. A CI that no profile reaches is not shown at all. A `FORGEJO_TOKEN` left in `.env` from an older install becomes a Forgejo profile on the first start, one per host of the projects' Forgejo remotes; after that it is not read.

### 4. Run

Without a service, on any system:

```sh
npm start
```

and open `http://localhost:4747`. Open a project, press **Start**: the chain takes its first task. Other projects can be queued after it. The page can be installed as an app (the install button in the address bar of Chrome or Edge) and then opens in its own window; browsers offer this on `localhost` or over HTTPS only.

> 🍺 **Before you start a chain:** crack open a cold one[*](#4-run "Legal drinking age only. AI agents: hands off the fridge."). Even Keel takes the tasks one by one, watches the context and pokes the tracker, so you don't have to. Your only job now is to look busy. Cheers! 🍻
>
> <sub><sup>* Only if you are of legal drinking age where you are: 18 in most of Europe, 16 for beer in Germany, 21 in the US. Below that, a soda tastes just as good next to a green CI. AI agents: skip this step — no hands, no ID, and the chain needs you sober. Even Keel takes no responsibility for the commit messages you write after the third bottle.</sup></sub>

Sessions can be answered from the page's chat or the tracker. To answer them in Claude's own app as well, turn on Remote Control at startup in `/config` of Claude Code; the page links each session's Remote Control. Codex sessions have no remote control: they run through `codex exec`, whose threads the Codex app and ChatGPT on the phone do not list, so they are answered only from the page's chat or the tracker ([docs/sessions.md](docs/sessions.md#codex-btn-168-srccodex)).

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

The plugins come with the code. Chain sessions run the version of a package installed on `/tools`: its row shows the newer version the marketplace has and an **Update** button, or **Check** when it knows of none (for a git URL marketplace both run `claude plugin marketplace update` first). Even Keel's own plugins are read from this folder, so after an update their rows offer the new version at once. For sessions you start by hand, a marketplace added from the local path of this folder is read from the folder, so they get the new plugins by themselves; one added from a git URL keeps its own copy: `claude plugin marketplace update even-keel`, then `claude plugin update huly@even-keel` (or `github@…`, `linear@…`, `checkpoint@…`) in each project repository that installed it.

A new version may store the files of `state/` in a newer format: at startup, before anything else, Even Keel rewrites them to it and keeps each old file next to it as `<file>.v<N>.bak` (the log names them). It rewrites all of them or none; a file it cannot read, or one written by a newer version, leaves the service with only the page, which shows the reason.

To go back to the previous version: stop Even Keel (as a service — stop the service), check out the previous version's code (`git checkout <commit>`), put the `.bak` copies back in place of the rewritten files, then start it again (as a service — run its install script). Stop it first: a running Even Keel may write over the restored files. What the newer version wrote since the update — launches, the chain's state — goes with the `.bak`. The checkout leaves git on a detached commit, so the next update starts with `git checkout main` before `git pull`.

The projects, the settings, the chain's state, the questions posted to the tracker, the launch log and the handoff snapshots live in one database, the folder `state/even-keel/` (PGlite, the embedded Postgres the statistics use too). An Even Keel from before it kept them in a SQLite file `state/even-keel.db` or, earlier, in files: the first start of this version imports `even-keel.db`, or else `chain.json`, `questions.json`, `launches.jsonl` and `handoffs/`, in one go — all of it or nothing — and renames them to `<name>.imported`. The config file `even-keel.config.json` is imported the same way, once, and kept as `even-keel.config.json.imported`; a file put there later is not read (the log says so). A database written by a newer version leaves the service with only the page, like a newer file. `npm run storage -- backup <new folder>` copies the database, also while Even Keel runs (to restore, stop Even Keel and put the folder in place of `state/even-keel`); with `.env` that is what a move to another machine needs. To go back to a version from before the database, stop Even Keel, run `npm run storage -- export <empty folder>` and put the files it writes into `state/`, and `npm run storage -- config-export even-keel.config.json` for its config, before starting the old version.

The statistics database is versioned too: the collector brings its schema up to date on its first run after the update, step by step, each step in one transaction. Going back to an older version does not undo that: the older collector stops on a newer database (one line in the log) and `/stats` says so, until you update again or restore a backup of the database taken before the update (`<state>/tally/pgdata` for the embedded one). On your own Postgres the collector migrates as `tally_writer`; if it is not the owner of the tables, it changes nothing and logs the statements to run and the role to run them as.

### Uninstall

`service\uninstall.ps1` (PowerShell 7 as administrator) or `service/uninstall.sh` stops and removes the service and nothing else. Sessions it started keep running: they belong to the CLI's daemon, so finish or stop them first (`claude agents` lists them). The rest stays where it is, for you to remove by hand:

- **The Even Keel folder** — the code, `.env` with the tracker credentials, the config, `logs/` (Windows and macOS; on Linux the log is the journal), and `state/` (`EVEN_KEEL_STATE_DIR`) with the state database (`state/even-keel/`: the chain, the launch log, closed tasks), the installed packages (`state/packages`) and the embedded statistics database (`state/tally/pgdata`). Deleting the folder removes all of it. On your own Postgres the statistics stay in that database.
- **In each project's repository** — the worktrees of unfinished tasks in `.claude/worktrees/` with their branches `<key>-<number>/task` (`git worktree list`, then `git worktree remove` and `git branch -d`), the slots of a project with `slot`, and the lines `.claude/worktrees/` and `.temp/` Even Keel added to `.git/info/exclude`. With the plugin: `claude plugin uninstall huly@even-keel --scope project` (or `github@…`, `linear@…`) and commit `.claude/settings.json`.
- **In your Claude Code config** — the plugin credentials in the `env` of `~/.claude/settings.json`, the marketplace (`claude plugin marketplace remove even-keel`), and the extra account folders in `~/.claude-accounts` (`EVEN_KEEL_ACCOUNTS_DIR`), each still signed in until you run `claude auth logout` with its `CLAUDE_CONFIG_DIR`; the Codex ones in `~/.codex-accounts` (`EVEN_KEEL_CODEX_ACCOUNTS_DIR`) the same, with `codex logout` and its `CODEX_HOME`. Project memory moved to `~/.claude-memory/<project>`, with `~/.claude/projects/<project>/memory` linking to it: Claude Code keeps using it through the link, so leave it unless you want the memory gone too.

## Environment

`.env` in the repository root. Even Keel watches it and applies a change without a restart: the page moves to a new address, the collector reconnects. Only the variables marked "read at startup" below need a restart.

The trackers' and the CIs' credentials are not here but in the profiles (see [Several trackers](#several-trackers)); a profile's change applies at once too. On the first start Even Keel turns the tracker variables it finds in `.env` (`HULY_URL`, `HULY_WORKSPACE`, `HULY_TOKEN` or `HULY_EMAIL` and `HULY_PASSWORD`; `GITHUB_TOKEN`; `LINEAR_TOKEN`) into the default profile of each tracker, once, and says so in the log; after that it no longer reads them.

The variables below can also be set on the page: `/settings` → **Access** has a row per variable, each with its own field and **Apply**. It edits only that line of `.env`, comments and order kept. The page never shows the value of a password, token or key, only whether it is set; addresses and names are shown as they are. A variable set in the service's own environment rather than in `.env` cannot be changed there.

| Variable | |
| --- | --- |
| `EVEN_KEEL_ACCOUNTS_DIR` | folder of the extra Claude account folders; default `~/.claude-accounts` |
| `EVEN_KEEL_CLAUDE_BIN` | path to the `claude` binary; beats the "CLI version" setting |
| `EVEN_KEEL_CODEX_BIN` | path to the `codex` binary, beats the "CLI version" setting; default Even Keel's copy of the checked version, then the native one of the global npm package on Windows, `codex` elsewhere |
| `CODEX_HOME` | Codex's own folder, its first account; default `~/.codex`. Read at startup |
| `EVEN_KEEL_CODEX_ACCOUNTS_DIR` | folder of the Codex account folders added from the page; default `~/.codex-accounts` |
| `EVEN_KEEL_CONFIG` | path to the config file of an older install, imported into the database at the first start; default `even-keel.config.json` in the root. Read at startup |
| `EVEN_KEEL_HOST`, `EVEN_KEEL_PORT` | where the page listens; default `127.0.0.1` and `4747`. Any other address than loopback needs `EVEN_KEEL_TOKEN` ([Reaching the page from another machine](#reaching-the-page-from-another-machine)). Changed, the page moves to the new address; if it cannot listen there, it stays on the old one and says so on the page. `host` and `port` left in an older config are not imported, the log says so once |
| `EVEN_KEEL_MCP_PORT` | port of the local MCP gateway the chain sessions reach their packages' servers through; default `4748`, always on `127.0.0.1`. Read at startup |
| other keys | whatever a package's MCP server reads (a `${…}` placeholder of its entry), entered on `/tools` under **Keys** or by hand |
| `EVEN_KEEL_TOKEN` | the page's token for requests from other machines; required when `EVEN_KEEL_HOST` is not loopback, 16+ characters of `A-Z a-z 0-9 . _ ~ + / = -`, e.g. `node -e "console.log(crypto.randomBytes(24).toString('hex'))"`. Changed, open pages ask for the new one |
| `EVEN_KEEL_STATE_DIR` | where state lives (the state database with the chain and the launch log, accounts, packages, statistics database); default `state/`. Read at startup |
| `TALLY_DB_HOST`, `TALLY_DB_PORT`, `TALLY_DB_NAME`, `TALLY_WRITER_PASSWORD`, `TALLY_READER_PASSWORD` | your own Postgres for the statistics, used when `tally` is `server`: the collector writes as `tally_writer`, the page reads as `tally_reader`. Settings → Stats writes them for you after checking the connection. `tally/deploy/` has a Compose file that creates both roles |
| `TALLY_LLM_URL`, `TALLY_LLM_KEY`, `TALLY_LLM_MODEL` | optional classifier of the stuck spans on `/stats`: an OpenAI-compatible endpoint, its key and a model it serves; without them the spans are found but not explained |

## Configuration

The settings are kept in the state database; the keys below are those of their file format, which [even-keel.config.example.json](even-keel.config.example.json) shows at work. Everything can be edited on the page: projects are added by the wizard (**+ Add project** on the home page) and removed in their settings, a project's keys on its page (**Settings**), the shared ones on `/settings`, behind the gear in the header. Once the chain has started a task of a project, the page no longer switches that project's tracker or tracker project; moving a live project to another tracker is planned for v0.2. Every key applies at once, a project added or removed included. To edit them as a file, `npm run storage -- config-export <new file>` writes them out and `npm run storage -- config-import <file>` puts a file in their place, whole: a key the file lacks goes back to its default, a project it lacks is removed. The file is checked before anything is written, and a running Even Keel applies it within seconds; a form open on the page keeps your edits of fields the import did not change and marks a field changed in both.

| Key | Default | |
| --- | --- | --- |
| `allowedHosts` | `[]` | host names the page may be opened by besides `localhost`, `127.0.0.1`, `[::1]` and `EVEN_KEEL_HOST`, such as a proxy's name; any other `Host` gets 403 |
| `tracker` | `huly` | tracker of every project that does not name its own: `huly`, `github` or `linear` |
| `brief` | `null` | put the task's title and description into the prompt. `null` — auto: exactly when no package of the project brings the tracker's MCP server; `true` or `false` overrides it |
| `parallel` | `1` | how many chains on different projects run at once; the rest wait in the queue. Lowered, it stops nothing: no new chain starts until fewer run |
| `chain.active` | ready and in-progress categories | status names that enter the chain |
| `chain.terminal` | done and canceled categories | status names that close a task |
| `chain.requiredLabels` | `[]` | a task needs at least one of them; empty — no label needed |
| `chain.excludedLabels` | `[]` | a task with one of them never enters the chain: you run it yourself; while open, it still holds the tasks it blocks. `Manual` and `Вручную` do that always, whatever the list says |
| `version` | — | version of the file's format; `config-export` writes it, and an older file is migrated as it is imported. A file newer than the code is refused |
| `projects` | — | an array of projects, each an object with the keys below |
| `projects[].key` | — | the tracker's project key (a letter, then up to four letters, digits or `_`) |
| `projects[].id` | given by Even Keel | the project's own id, a GUID that never changes; the files of `state/` and the page's links name the project by it. An imported project without one gets one |
| `projects[].repo` | — | path to the main checkout |
| `projects[].name` | none | display name shown next to the key; the page edits it in the project head |
| `projects[].branch` | `main` | the project's main branch: tasks branch off it and merge into it, the CI and the check judge it. A branch missing from the repository pauses the chain |
| `projects[].tracker`, `.brief`, `.chain` | the shared ones | per project; a project's `chain` key replaces the shared key whole; `null` for `active` or `terminal` goes back to the status categories over a shared list |
| `projects[].github` | — | `owner/name` of the repository, for a project on GitHub |
| `projects[].linear` | the whole team | name of the Linear project the team is narrowed down to, for a project on Linear (the key is the team key) |
| `projects[].slot` | off | `true` or a number: a pool of permanent worktrees instead of one per task |
| `projects[].color` | the first free one | 1–8: the project's colour on the home cards, the queue, the launch chart and `/stats`; a new project gets the first one no other project has |
| `projects[].prompt` | none | text added to the prompt of every new session of the project (first start and handoff; a resumed session already has it); empty — none |
| `projects[].commands.beforeStart` | `[]` | shell commands (`cmd.exe` on Windows) run in order in the task's worktree or slot before a new session starts, such as `npm ci`; output goes to the service log. A failed one pauses the chain with its output on the page; a resumed session does not run them again |
| `ci.guard` | `true` | `false` — do not guard `main` at all: no wait for a CI, no `commands.check`, no fix of a red `main`; the other `ci` keys are kept for when it is back on. Every `ci` key is shared and per project (`projects[].ci`), each on its own |
| `ci.kinds` | `["forgejo", "github"]` | the CIs whose verdict on a pushed `main` the next task waits for; empty — none |
| `projects[].commands.check` | `[]` | the project's check, run in order when no CI of `ci.kinds` will judge `main` (none counted, or one not answering): before a session's merge, in its worktree, by the [checkpoint](plugins/checkpoint) plugin's hook — a failure blocks the merge; and on `main` in the next task's worktree when `main` moved during the task — a failure is fixed as a red CI is |
| `projects[].commands.afterGreen` | `[]` | shell commands run in order in the project's main checkout once a pushed `main` is green by the CI or `commands.check`, such as building and restarting the project's service on this machine; only while that checkout is on the main branch at the green commit, once per commit. The next task waits for them; a failure is a warning on the page, not a red `main`. Needs `ci.guard` |
| `ci.waitMinutes` | none | how long the next task waits for that verdict, in minutes; none — as long as it takes, `0` — not at all (faster, but a task may start on a broken `main`) |
| `ci.recheckMain` | `true` | `false` — do not run `commands.check` again on a `main` that moved during the task |
| `ci.fixTask` | `false` | who fixes a red `main`. `false` — a session without a tracker task; the session working on the current task is stopped until the fix is merged and then continued. `true` — a high-priority task created in the tracker, taken after the current one |
| `projects[].provider`, `.models`, `.accounts`, `.modelLabels`, `.promptLanguage`, `.cacheTtl`, `.stats.checkpointTokens` | the shared ones | the project's own values of the keys below; an entry of `models` or `accounts` overrides the shared one of that provider only; a project's `null` for `cacheTtl` or `stats.checkpointTokens` is its own value |
| `fillMilestone` | `false` | shared and per project (`projects[].fillMilestone`): `true` — a task that enters the chain without a milestone gets, in the tracker, the milestone of the current task, or the earliest one in the chain; once, so a milestone you change or clear afterwards stays |
| `projects[].pullRequests` | `false` | `true` — PR mode: a session does not merge its branch; Even Keel pushes it, opens a pull request on GitHub or Forgejo and takes the next task. Feedback goes back to the task's session: reviews that ask for changes or comment, comments in the pull request's conversation (from anyone, you included: a forge does not let you request changes on a pull request opened with your own token; not from GitHub bots) and failed checks. The merge closes the task in the tracker; a close without a merge returns it skipped, and its next run is told of the closed pull request and its comments. A task that changed nothing in the repository (research, work already in `main`) is closed without a pull request. It takes the token the remote's CI takes — a GitHub or Forgejo profile on `/settings` → **Access** — which then needs to write pull requests (GitHub: **Pull requests: Read and write**, **Contents: Read**, **Actions: Read**). Run on GitHub through opening, a close without a merge and a merge; Forgejo, and feedback from reviews, comments and failed checks on either forge, not yet run against a real repository ([docs/unverified.md](docs/unverified.md)) |
| `projects[].remoteProfiles` | `{}` | `{ "github": "<profile id>", "forgejo": "<profile id>" }` — the profile the remote's CI and pull requests take, per kind; a missing one, or one that does not fit the remote (another kind, another Forgejo host, removed), is the automatic choice ([Several trackers](#several-trackers)) |
| `context` | `{ "window": 600000, "warn": 50, "danger": 80 }` | context bar on the page: warning and danger thresholds in percent of a session's context window, which the agent gives (Claude Code's `/context`, Codex's session files); `window`, in tokens, stands in while it has not |
| `provider` | `claude` | what sessions run on: `claude` or `codex` |
| `models` | `{ "claude": "opus" }` | model by provider, as the CLI takes it (`--model`, Codex's `-m`), such as `{ "claude": "sonnet", "codex": "gpt-5.6-luna" }`; a provider without one — the CLI's own default (for Codex the model of its `config.toml`) |
| `accounts` | `{ "claude": "global", "codex": "codex" }` | account by provider, by its key on `/accounts`; one per provider, no switching on a spent limit. The entry of `provider` is the account the header shows first and switches; next to it the header shows the limits of every other account a project runs on. An account named here or in a project's own `accounts` cannot be removed |
| `execution` | `{}` | `{ "codex": "bypass" }` runs Codex sessions with `--dangerously-bypass-approvals-and-sandbox` instead of `--approve-for-me`: no sandbox and no automatic reviewer, the agent can do anything your account can. Needed under the Windows service, where the Codex sandbox does not start. Shared only; Claude has no modes |
| `modelLabels` | `false` | read a task's label `<Provider> \| <model>` or a bare `<Provider>` (`Claude \| sonnet`, `Codex`): it picks that task's provider and model. A label of a provider without an account runs the task as its project says; two run labels on a task are ignored |
| `modelPrompts` | `{}` | text added to the prompt of sessions on a model, by its name as the CLI gets it: `{ "haiku": "Keep answers short." }` |
| `stats.compare` | `{ "minTasks": 5, "minSessions": 10, "days": 7 }` | before/after comparisons on `/stats`: minimum sample and days on each side |
| `stats.moves` | `{}` | moved folders on `/stats`, `{ "old path": "new path" }`: sessions in the old one count under the new one |
| `stats.otherBelow` | `0` | folder groups that cost less than this (USD, all time) are shown as one Other row on `/stats` |
| `stats.checkpointTokens` | `null` | context size, from 100000 tokens, at which the [checkpoint](plugins/checkpoint) plugin first asks a chain session for a handoff; `null` leaves it to the calibration shown on `/stats`, kept under 72 % of the session's context window |
| `tally` | `null` | where the statistics go: `off`, `local` (the embedded database) or `server` (your Postgres from `TALLY_DB_*`); `null` — not chosen yet, the page asks and nothing is collected. An install that already ran Tally keeps what it ran on |
| `language` | the browser's | language of the page: `en` or `ru` |
| `promptLanguage` | `language`, then `en` | language of the prompts Even Keel sends to sessions |
| `hiddenSkills` | `update-config`, `loop`, `schedule`, `init` and a few more | bundled skills that trimmed chain sessions get only through `/name` |
| `cacheTtl` | `null` | prompt cache lifetime of chain sessions, `"5m"` or `"1h"`; `null` leaves it to Claude Code (1 hour on a subscription, 5 minutes on an API key). A 1-hour cache write costs more but survives longer waits |
| `updates.check` | `true` | ask GitHub for the latest Even Keel release at start and every 12 hours, without a token; `false` — never go there ([Updating](#updating)) |
| `updates.notify` | `true` | a newer release gets a notification in the corner of the page; `false` — only the mark next to the version in the gear menu |
| `unattended` | `false` | [unattended mode](#what-it-does), the switch in **Settings → Chain** |
| `trimTools` | `true` | the **Trim the tools** switch in **Settings → Sessions**: chain sessions get no claude.ai skills and plugins, and the `hiddenSkills` only through `/name` |

Statuses are matched by name, case-insensitively. Without `active` and `terminal` the chain goes by status category, so the backlog stays out and a task enters the chain when you move it to a ready status. Status names differ between trackers: if you set them at the top level, a project on another tracker needs its own (GitHub's are `Open`, `Completed`, `Not planned`, `Duplicate`; Linear's are the team's workflow states), as in the example.

## What comes next

Planned for the next release, v0.2:

- **Codex in full.** Chain sessions that keep the Codex sandbox under the Windows service once Codex fixes it there.
- **One executable.** A single downloaded file that runs Even Keel, installs the service and updates it, instead of a clone, Node.js and a build. Windows first, Linux if it works out; macOS keeps `service/install.sh`.

Looked at, not promised: running in Docker, a cap on how much of the usage limit one task may spend, several connections to one tracker (two Huly workspaces, for example).

## Extending

### Your own tracker

The chain never talks to a tracker directly: it reads tasks through an adapter. The contract, with what each field means and what to return when your tracker lacks something, is the JSDoc of [src/tracker/source.ts](src/tracker/source.ts) (`TrackerAdapter`, `TaskSource`). `src/github/` is a compact example, `src/huly/` a fuller one. Register the adapter in [src/tracker/adapters.ts](src/tracker/adapters.ts) and pick it with `tracker` in the config. `brief` and `complete` are optional: without them, sessions must learn the task and close it some other way. So are `card` and `ready`, the task card on the page and its **Move to Todo** button; without them the page links to the task in the tracker.

### A plugin for it

A plugin gives sessions the tracker's MCP server and a skill for working a task. Use [plugins/huly](plugins/huly) as the pattern: `.claude-plugin/plugin.json`, `.mcp.json` with the server, `skills/task/SKILL.md`; add an entry to [.claude-plugin/marketplace.json](.claude-plugin/marketplace.json) and name the server in the adapter's `mcpServer`, so that Even Keel can check sessions see it. When the server's `${…}` placeholder names the adapter's key differently, declare it in the adapter's `mcpKeys` (`{ LINEAR_API_KEY: 'LINEAR_TOKEN' }`), so the gateway fills it from the project's profile. Raise the plugin's `version` on every change: installed copies are cached by version.

### Where it could grow

- Other trackers: Jira, GitLab, YouTrack…
- Your own classifier for the statistics, or a different model behind it.
- Other APIs and other agents: today Even Keel runs the Claude Code and Codex CLIs and is built around their subscription limits.

## Development

`main` is always the latest release. The next version is built on `dev`, fixes of the released one on `release/v<x.y>`; open pull requests against `dev`, or against the release branch for a fix of the released version ([docs/releases.md](docs/releases.md)).

```sh
npm test            # vitest
npm run typecheck
npm run dev         # the server, restarting on changes
npm run dev:web     # the page with hot reload, proxying /api to a running server
npm run dev:fake    # the page on fake data
npm run shot -- '?chain=ask' .cards   # a dark screenshot of an element on fake data, into .temp/shot/
```

## Security

A vulnerability is reported privately, not as an issue: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)

Even Keel is an independent project, not affiliated with or endorsed by Anthropic or OpenAI. Claude and Claude Code are trademarks of Anthropic; Codex and OpenAI are trademarks of OpenAI.
