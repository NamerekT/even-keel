# Setting up Even Keel

The [README](../../README.md) has the quick start. This is the rest: the CLIs Even Keel depends on, projects, trackers and plugins, reaching the page, the service, updating and uninstalling. Every variable and key is in the [reference](reference.md).

## The CLIs it depends on

**Even Keel depends on undocumented behaviour of the Claude Code CLI**: `claude agents --json`, the `sessions/<pid>.json` records and the `jobs/<id>/state.json` job files, the background daemon (`claude --bg`, `--bg --resume`, `claude daemon`), the transcript format, the text of `/usage`, the layout of `~/.claude.json`, `.credentials.json` and `plugins/installed_plugins.json`. None of it is a public API.

A version becomes the checked one after one live session on it went through a launch, a question answered from the chat, the chat's feed, a checkpoint and a stop (`npm run cli-check`, [docs/releases.md](../releases.md)). So chain sessions run on that version, not on the one your CLI has updated itself to: Even Keel downloads it from Anthropic into `state/cli/claude/<version>/` (~270 MB a version, checked against Anthropic's sha256) at the first call, runs the installed CLI until the download ends, and turns the auto-updater off for those sessions so they never update your own install ([docs/sessions.md](../sessions.md#the-checked-cli-btn-250-srcagentpinnedts)). Settings → Models, "CLI version", `Installed` puts a provider back on your CLI; the page shows a banner while sessions would run on another version than the checked one. The pin has limits:

- A session runs on the version of its account folder's daemon. A daemon on another version is restarted only once no session of that folder is live, and a newer `claude --bg` or `claude agents` run in the same account folder replaces the pinned daemon with its own version: keep your own background sessions out of the chain's account folder. Whether a terminal reaches the service's daemon on Windows to do that has not been checked.
- Anthropic's servers may refuse an old version, and an old version may not know a new model's alias; Codex lists models by the client's version. Then the checked version is raised in a new release of Even Keel.
- The transcripts your own sessions write on a newer version are read as before: the pin covers how chain sessions are run, not those files.

**The same goes for the Codex CLI**: the events of `codex exec --json` (`thread.started`, `item.completed`, `turn.completed`, `turn.failed`), `-c` overrides of its config keys (`mcp_servers`, `marketplaces`, `plugins`, `hooks.state`), the rollout files `sessions/YYYY/MM/DD/rollout-*.jsonl` and their `session_meta`, `turn_context`, `event_msg` (`token_count` with the context fill and the rate limit windows, `task_complete`, errors) and `response_item` lines, the `plugin/install` and `hooks/list` calls of `codex app-server`, the `[plugins.*]` tables of `config.toml` and the `plugins/cache` layout, the claims of the ID token in `auth.json`, the text of `codex login status` and of its quota errors, and the layout of the npm package on Windows. Codex sessions run on the checked version the same way: Even Keel unpacks the platform's npm package `@openai/codex@<version>-<platform>` (Apache-2.0, checked against the registry's sha512) into `state/cli/codex/<version>/`.

Where Even Keel finds the CLIs: Claude Code's native install in `~/.local/bin` (`claude.exe` on Windows), then the binary of the VS Code extension, then `claude` on `PATH`; `EVEN_KEEL_CLAUDE_BIN` overrides. Codex's own folder is `CODEX_HOME` or `~/.codex`, the accounts added from the page live in `~/.codex-accounts`; `EVEN_KEEL_CODEX_BIN` overrides the binary.

## Projects

The projects and the settings live in Even Keel's database and are edited on the page; there is no file to create: the first start has no projects and the page opens the wizard that adds one. You give it the repository folder, pick a tracker profile (or add one right there) and the project in that tracker, which it suggests from the tracker's list and, on GitHub, from the repository's remote. The wizard checks the repository and its main branch (it suggests the checkout's current branch), the project in the tracker (it shows how many open tasks it sees), Claude Code's trust in the folder and where tasks run — a worktree per task or a pool of slots.

Each project needs:

- a git repository with a main branch — `main` unless the project names another in `branch`; with a remote, Even Keel pushes it after every task;
- the repository trusted by Claude Code (the wizard shows the command to run): open `claude` in it once and accept the trust prompt, or the first launch pauses the chain and asks for it (accepting it in the repository covers the task worktrees the message names; then press **Resume**: the chain does not retry by itself).

The rule that a session commits and merges its branch into `main` when the task is done comes with the launch and handoff prompts, plugin or not (in PR mode the prompt says to end the turn for a pull request instead).

A project is removed at the bottom of its **Settings** → **Repository**; the page refuses while its chain runs or waits in the queue, a session works for it or in its folders, or a task still holds a place, and says which. Removal does not touch the repository, its worktrees or branches.

## Trackers and plugins

### Minimum: the adapter only

Even Keel reads the tasks itself, puts the title and description of the task into the session's prompt, and closes the task when its branch lands in `main`. You add a **tracker profile** on `/settings` → **Access** → **Add profile**, and nothing else: pick the tracker, fill in its fields, press **Check** — Even Keel signs in and shows whom as — then **Save**. A profile is saved only once the tracker took it; the page never shows a saved token or password again. Profiles live in Even Keel's state database on your machine, not in git.

- **Huly:** the server address, the workspace, and the e-mail and password of a separate Huly account with access to the projects — create one for Even Keel. A token instead only if your Huly shows an API tokens page in the account settings: released self-hosted Huly has none, and its sign-in token comes from the e-mail and password anyway ([plugins/huly/README.md](../../plugins/huly/README.md#credentials)). The project key is the Huly project identifier (`ABC` for `ABC-12`).
- **GitHub:** a [fine-grained token](https://github.com/settings/personal-access-tokens/new) on the repositories, with the rights in [Token permissions](#token-permissions). A fine-grained token covers one owner: a personal repository and an organization's need a profile each. The profile shows when its token expires. A project names its repository: `{ "repo": "…", "tracker": "github", "github": "octo-org/abc" }`. GitHub has no backlog, so keep entry to the chain on a label: `"chain": { "requiredLabels": ["ready"] }`. For a public repository the label is a must: anyone with a GitHub account can open an issue there, and without the label it would enter the chain and give its text to a session that runs commands on your machine; only collaborators can label an issue, and the wizard warns about a public repository. For the same reason Even Keel reads only the comments of the repository's owner, the members of its organization, its collaborators and the token's own account — as an answer to a question, and in PR mode as a review or a comment on a pull request. Anyone else's is skipped with a line in the service log; the task card on the page still shows it. Details and the mapping of statuses, blockers, sub-issues and priorities: [plugins/github/README.md](../../plugins/github/README.md).
- **Linear:** a [personal API key](https://linear.app/settings/account/security) ([Token permissions](#token-permissions)). The project key is the team key (`ENG` for `ENG-12`); `"linear": "Web app"` narrows the team down to one Linear project: `{ "repo": "…", "tracker": "linear", "linear": "Web app" }`. Details and the mapping: [plugins/linear/README.md](../../plugins/linear/README.md).

On this level the session does not write to the tracker. What you do not get:

- **Postponing on a blocker.** The session cannot file a blocker for its task, so it cannot hand the task back and let the blocker run first. Blockers you link yourself still order the chain.
- **Question tasks.** A session cannot file a `Question: …` task for a decision it took on its own; it can only tell you in its final message.
- **Comments and decisions.** Nothing is written back: no closing comment, no decisions folded into the description, no new tasks for bugs found on the way.
- **Attachments and discussion.** The session sees only the title and the description.

### With the plugin

On top of the adapter, a Claude Code plugin from this repository gives the sessions the tracker's MCP server and a skill for working a task: the session reads the task and its attachments, records decisions in the description, files blockers and question tasks, creates new tasks, leaves a closing comment and merges.

Even Keel offers its own plugins from this folder, with no marketplace to add first:

1. On the `/tools` page, press **Add a package** under Packages, choose **Plugin** and pick `huly@even-keel` (or `github@even-keel`, `linear@even-keel`) for every project or one. Even Keel copies the plugin, installs a pinned version of its MCP server and gives both to every chain session at launch; turn it off per project in the table. A plugin your projects already had enabled when you upgraded is in the table already. A shortcut for one project: **Go to Tools** beside **Task description in the prompt** in the project's settings, or **Open →** on its "What sessions get" plaque while that says the tracker's plugin is missing, opens the same dialog with the tracker's plugin and the project already picked.
2. The MCP server takes the credentials of the project's tracker profile: it runs behind a local gateway on `127.0.0.1:4748` (`EVEN_KEEL_MCP_PORT`), so the sessions never see them. Another key a package needs shows in **Keys** on the same page, and the project's chain waits until it is set.
3. Nothing to switch off: once a package of the project brings the tracker's MCP server, the prompt carries only the task ID and the session reads the task itself (`brief` left as auto). `brief: true` or `false` overrides that; with `false` the chain waits while no package of the project brings the server.

Sessions you start by hand get none of this. For them, Claude Code needs this repository as a marketplace: `/tools` offers to add it with a button while your default config (no `CLAUDE_CONFIG_DIR` set) does not know it, or run `claude plugin marketplace add <git URL or local path of this repository>` yourself. Then `claude plugin install huly@even-keel --scope project` in the project and the credentials in the `env` of `~/.claude/settings.json` (`HULY_URL`, `HULY_WORKSPACE`, `HULY_TOKEN` or `HULY_EMAIL` and `HULY_PASSWORD`; `GITHUB_PERSONAL_ACCESS_TOKEN`; `LINEAR_API_KEY`). Even Keel writes the default profile of each tracker there itself; a session started by hand never gets another profile.

The GitHub skill sets "blocked by" links through the [GitHub CLI](https://cli.github.com/), so `gh auth login` once. Everything else — troubleshooting, what the skills do — is in [plugins/huly/README.md](../../plugins/huly/README.md), [plugins/github/README.md](../../plugins/github/README.md) and [plugins/linear/README.md](../../plugins/linear/README.md).

### Several trackers

Each project has its own tracker (`tracker` in the project's entry, or one for all at the top level), and they work at the same time: project A on Huly, project B on GitHub. A tracker can have several profiles — two Huly workspaces, a personal GitHub token and an organization's — and each project picks one (the **Profile** field when you add it, or in its settings until its first task runs). One profile of each tracker is the default: projects without a choice run on it, it is the one sessions started by hand get, and it gives the GitHub Actions token to projects of other trackers. A profile whose token is refused turns red on **Access**, and the chains on it pause until it is fixed.

Git is not part of this: pushes go through your own git and its credentials (SSH, the credential manager), whatever the profiles are. A project on Huly with a remote on GitHub works as is, and its CI is found by the remote.

### CI and pull requests

The CI is read with a profile too. GitHub Actions on a `github.com` remote takes the token of the project's GitHub profile, or of the default GitHub profile for a project on another tracker. CI on a Forgejo remote takes a **Forgejo** profile (**Add profile** → Forgejo: the server's address and an access token) on the remote's host. Pull requests of PR mode take the same token as the remote's CI. What each token needs is in [Token permissions](#token-permissions). With several GitHub or Forgejo profiles, a project can pick the one its CI and pull requests take in **Settings** → **Check and CI** (`remoteProfiles`); "Automatic" is the choice above. A CI that no profile reaches is not shown at all. Only GitHub and Forgejo (or Gitea) are supported: a remote on `gitlab.com` or `bitbucket.org` has no CI on the page and PR mode on it says the host is not supported. Any other host is taken for Forgejo, so a GitLab server on its own domain is too — and a Forgejo profile with its address fails its check with "is not a Forgejo or Gitea server". A `FORGEJO_TOKEN` left in `.env` from an older install becomes a Forgejo profile on the first start, one per host of the projects' Forgejo remotes; after that it is not read.

### Token permissions

What a profile's token needs, by what it is used for. The profile dialog lists the same for the kind you pick.

| Profile | Tracker | CI | Pull requests (PR mode) |
| --- | --- | --- | --- |
| Huly | a separate account with access to the projects: its e-mail and password, or a token | — | — |
| GitHub, a fine-grained token for the repositories' owner | **Issues: Read and write** | **Actions: Read** | **Pull requests: Read and write**, **Contents: Read**, **Actions: Read** |
| Linear, a personal API key | write access | — | — |
| Forgejo, an access token | — | `read:repository` (the repositories and their Actions), `read:user` (the sign-in check) | `write:repository` (opening a pull request, reading its reviews), `read:issue` (comments in its conversation), `read:user` |

PR mode pushes the task's branch with `git push`, on the git credentials of the account the service runs as (its SSH keys or credential manager), not with a profile's token: without them PR mode stops at the push. A forge that refuses to open a pull request with the token marks the profile's card **PR refused** and names the right it lacks. The Forgejo rights for pull requests follow from the API calls Even Keel makes and are not yet checked against a real server ([What has not been verified](../unverified.md)).

## The page

`http://localhost:4747` by default. The page can be installed as an app (the install button in the address bar of Chrome or Edge) and then opens in its own window; browsers offer this on `localhost` or over HTTPS only.

### Answering from the phone

Sessions can be answered from the page's chat or the tracker. To answer them in Claude's own app as well, turn on Remote Control at startup in `/config` of Claude Code; the page links each session's Remote Control. Codex sessions have no remote control: they run through `codex exec`, whose threads the Codex app and ChatGPT on the phone do not list, so they are answered only from the page's chat or the tracker ([docs/sessions.md](../sessions.md#codex-btn-168-srccodex)).

### Reaching the page from another machine

By default the page listens on `127.0.0.1` only, and nothing else on the network sees it. That is on purpose: the page starts sessions with automatic permissions, writes answers into waiting sessions and signs Claude accounts in and out, so whoever reaches it drives your machine. Every request is also checked whatever `EVEN_KEEL_HOST` is:

- its `Host` must be `localhost`, `127.0.0.1`, `[::1]`, `EVEN_KEEL_HOST` or a name in `allowedHosts`, otherwise it gets 403. This stops DNS rebinding — a foreign site whose name was pointed at `127.0.0.1`;
- an `Origin`, if the request has one, must be one of the same names, so another site open in your browser cannot post to the page. Requests without `Origin` (the plugins' hooks, `curl`) pass.

Two ways to reach it from elsewhere:

- **A proxy on the same machine** (recommended). For example a Tailscale Service, `tailscale serve --service=svc:even-keel --https=443 http://localhost:4747`, which also gives the page HTTPS, so it can be installed as an app. The proxy forwards the name it was reached by, so put that name into `allowedHosts`: `"allowedHosts": ["even-keel.example.ts.net"]`. Its requests come from loopback, so the page asks them for no token: who gets in is decided by the tailnet's access rules.
- **Listening on the network.** Set `EVEN_KEEL_HOST` in `.env` to `0.0.0.0` or the machine's address, put the names or addresses you open it by into `allowedHosts` (the configured address itself is let in), and set `EVEN_KEEL_TOKEN` in `.env`. Without the token the service does not start. A request from another machine then needs the token: open the page once as `http://<address>:4747/?token=<token>`, and the service keeps it in an `HttpOnly`, `SameSite=Strict` cookie and drops it from the address; scripts send `Authorization: Bearer <token>`. Plain HTTP shows the token to anyone on the way, so prefer a proxy with HTTPS.

## As a service

The service starts with the system and restarts Even Keel if it fails. Stopping the service does not kill running sessions: they belong to the CLI's daemon.

**Windows.** `service\install.ps1` from PowerShell 7 as administrator installs the dependencies, builds the page, compiles a small service host with the `csc.exe` that ships with Windows (.NET Framework 4), and registers the service `EvenKeel` under your account. The script never asks for your password: enter it in `services.msc` → EvenKeel → Properties → Log On, which also grants the "Log on as a service" right, then start the service. Log: `logs\even-keel.log`.

**Linux and macOS.** `service/install.sh`, as your own user, not with `sudo`. On Linux it installs a systemd user unit (`systemctl --user status even-keel`, log: `journalctl --user -u even-keel`). A user unit stops when you log out; to keep it running, `loginctl enable-linger $USER`. On macOS it installs a launchd agent `local.even-keel` (log: `logs/even-keel.log`), which runs while you are logged in. The script takes `PATH` and `node` from your shell; if `node` changes (nvm and the like), run it again.

## Updating

The gear menu in the header ends with the installed version. Even Keel asks GitHub for its latest release at start and every 12 hours (a request to `api.github.com` without a token; it names only the installed version); a newer one gets a link next to the version and a notification in the corner of the page. Turn the check off on `/settings` → **Interface** or with `"updates": { "check": false }` in the config. To update:

- **run from a terminal** — stop Even Keel, then `git pull`, `npm ci`, `npm run build` and `npm start`;
- **as a service** — `git pull`, then run its install script again: it installs the dependencies, builds the page and restarts the service.

On Windows a running Even Keel holds files in `node_modules`: `npm ci` next to it fails with `EPERM` and leaves the folder half-removed. Stop Even Keel and run `npm ci` again. Running sessions are not stopped by any of this: they belong to the CLI's daemon, and the restarted Even Keel picks them up.

### Plugins

The plugins come with the code. Chain sessions run the version of a package installed on `/tools`: its row shows the newer version the marketplace has and an **Update** button, or **Check** when it knows of none (for a git URL marketplace both run `claude plugin marketplace update` first). Even Keel's own plugins are read from this folder, so after an update their rows offer the new version at once. For sessions you start by hand, a marketplace added from the local path of this folder is read from the folder, so they get the new plugins by themselves; one added from a git URL keeps its own copy: `claude plugin marketplace update even-keel`, then `claude plugin update huly@even-keel` (or `github@…`, `linear@…`, `checkpoint@…`) in each project repository that installed it.

### Stored state

A new version may store the files of `state/` in a newer format: at startup, before anything else, Even Keel rewrites them to it and keeps each old file next to it as `<file>.v<N>.bak` (the log names them). It rewrites all of them or none; a file it cannot read, or one written by a newer version, leaves the service with only the page, which shows the reason.

The projects, the settings, the chain's state, the questions posted to the tracker, the launch log and the handoff snapshots live in one database, the folder `state/even-keel/` (PGlite, the embedded Postgres the statistics use too). An Even Keel from before it kept them in a SQLite file `state/even-keel.db` or, earlier, in files: the first start of this version imports `even-keel.db`, or else `chain.json`, `questions.json`, `launches.jsonl` and `handoffs/`, in one go — all of it or nothing — and renames them to `<name>.imported`. The config file `even-keel.config.json` is imported the same way, once, and kept as `even-keel.config.json.imported`; a file put there later is not read (the log says so). A database written by a newer version leaves the service with only the page, like a newer file.

`npm run storage -- backup <new folder>` copies the database, also while Even Keel runs (to restore, stop Even Keel and put the folder in place of `state/even-keel`); with `.env` that is what a move to another machine needs.

The statistics database is versioned too: the collector brings its schema up to date on its first run after the update, step by step, each step in one transaction. Going back to an older version does not undo that: the older collector stops on a newer database (one line in the log) and `/stats` says so, until you update again or restore a backup of the database taken before the update (`<state>/tally/pgdata` for the embedded one). On your own Postgres the collector migrates as `tally_writer`; if it is not the owner of the tables, it changes nothing and logs the statements to run and the role to run them as.

### Going back

Stop Even Keel (as a service — stop the service), check out the previous version's code (`git checkout <commit>`), put the `.bak` copies back in place of the rewritten files, then start it again (as a service — run its install script). Stop it first: a running Even Keel may write over the restored files. What the newer version wrote since the update — launches, the chain's state — goes with the `.bak`. The checkout leaves git on a detached commit, so the next update starts with `git checkout main` before `git pull`.

To go back to a version from before the database, stop Even Keel, run `npm run storage -- export <empty folder>` and put the files it writes into `state/`, and `npm run storage -- config-export even-keel.config.json` for its config, before starting the old version.

## Uninstall

`service\uninstall.ps1` (PowerShell 7 as administrator) or `service/uninstall.sh` stops and removes the service and nothing else. Sessions it started keep running: they belong to the CLI's daemon, so finish or stop them first (`claude agents` lists them). The rest stays where it is, for you to remove by hand:

- **The Even Keel folder** — the code, `.env` with the tracker credentials, the config, `logs/` (Windows and macOS; on Linux the log is the journal), and `state/` (`EVEN_KEEL_STATE_DIR`) with the state database (`state/even-keel/`: the chain, the launch log, closed tasks), the installed packages (`state/packages`) and the embedded statistics database (`state/tally/pgdata`). Deleting the folder removes all of it. On your own Postgres the statistics stay in that database.
- **In each project's repository** — the worktrees of unfinished tasks in `.claude/worktrees/` with their branches `<key>-<number>/task` (`git worktree list`, then `git worktree remove` and `git branch -d`), the slots of a project with `slot`, and the lines `.claude/worktrees/` and `.temp/` Even Keel added to `.git/info/exclude`. With the plugin: `claude plugin uninstall huly@even-keel --scope project` (or `github@…`, `linear@…`) and commit `.claude/settings.json`.
- **In your Claude Code config** — the plugin credentials in the `env` of `~/.claude/settings.json`, the marketplace (`claude plugin marketplace remove even-keel`), and the extra account folders in `~/.claude-accounts` (`EVEN_KEEL_ACCOUNTS_DIR`), each still signed in until you run `claude auth logout` with its `CLAUDE_CONFIG_DIR`; the Codex ones in `~/.codex-accounts` (`EVEN_KEEL_CODEX_ACCOUNTS_DIR`) the same, with `codex logout` and its `CODEX_HOME`. Project memory moved to `~/.claude-memory/<project>`, with `~/.claude/projects/<project>/memory` linking to it: Claude Code keeps using it through the link, so leave it unless you want the memory gone too.
