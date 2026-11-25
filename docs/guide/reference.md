# Reference

Every environment variable and every setting. How to set Even Keel up is in [setup](setup.md), what it does in the [guide's pages](README.md).

- [Environment](#environment) — the variables of `.env`: the page's address and token, folders, paths to the CLIs, the statistics database
- [Configuration](config.md#configuration) — the page and the service, the chain, projects, a project's tracker
- [Configuration: CI, sessions and statistics](config-sessions.md) — CI and pull requests, sessions and agents, context, cache and handoffs, statistics
- [Protection setting](#protection-setting) — the format of the `protection` key
- [Task labels](#task-labels) — the API call that changes a task's labels

Each table row gives a name, its default and what it does. Where the page has the setting under a name of its own, the row gives that name in bold.

## Environment

`.env` in the data folder: a clone's own folder, or for an install with npm `%LOCALAPPDATA%\even-keel`, `~/Library/Application Support/even-keel` or `~/.local/share/even-keel` (`$XDG_DATA_HOME/even-keel`).

Even Keel watches it and applies a change without a restart: the page moves to a new address, the collector reconnects. Only the variables marked "read at startup" below need a restart.

`.env` is Even Keel's own: nothing in it reaches the agents' sessions, the task's commands or the MCP servers (a package's key reaches only its own server, through the gateway). Neither do the page token, Tally's passwords and key and the badge secret when set in the service's environment instead.

A variable a session needs, such as the credentials of a cloud account's "environment" way, goes into the service's own environment, not into `.env`; the cloud account form looks only there and does not see credentials set in `.env`.

A Claude account folder's background daemon started before this rule keeps handing the old environment to its sessions until it restarts.

The trackers' and the CIs' credentials are not here but in the profiles (see [Trackers and plugins](tracker-builtin.md#trackers-and-plugins)); a profile's change applies at once too.

On the first start Even Keel turns the tracker variables it finds in `.env` (`HULY_URL`, `HULY_WORKSPACE`, `HULY_TOKEN` or `HULY_EMAIL` and `HULY_PASSWORD`; `GITHUB_TOKEN`; `LINEAR_TOKEN`; `GITLAB_TOKEN` and optional `GITLAB_URL` (default `https://gitlab.com`, the web address without `/api/v4`); `JIRA_URL`, `JIRA_EMAIL` and `JIRA_TOKEN`, with the optional `JIRA_MCP_TOKEN` of the Jira plugin; `FORGEJO_TOKEN` and optional `FORGEJO_URL`, a profile per Forgejo host) into the default profile of each tracker, once, and says so in the log; after that it no longer reads them.

Most variables below can also be set on the page, where they belong: the owner key on `/settings` → **Sign-in and devices**, the stats database under **Your own Postgres** on **Stats**, the span classifier in its section on **Stats** (a blank key keeps the saved one).

The page edits only those lines of `.env`, comments and order kept.

It never shows the value of a password, token or key, only whether it is set; addresses and names are shown as they are.

A variable set in the service's own environment rather than in `.env` cannot be changed there: its field is off, and its tip says so.

### The page and its folders

| Variable | Default | What it does |
| --- | --- | --- |
| `EVEN_KEEL_HOST`, `EVEN_KEEL_PORT` | `127.0.0.1` and `4747` | where the page listens. Any other address than loopback needs `EVEN_KEEL_TOKEN` ([Reaching the page from another machine](remote.md#reaching-the-page-from-another-machine)). Changed, the page moves to the new address; if it cannot listen there, it stays on the old one and says so on the page. Sessions get the address as `EVEN_KEEL_URL` for the packages' hooks; sessions already running keep the old one. `host` and `port` left in an older config are not imported, the log says so once |
| `EVEN_KEEL_TOKEN` | — | the owner key: the first sign-in to the page and the way back in when every passkey is lost; scripts send it as `Authorization: Bearer`. Set, a request by any name but a loopback one — another machine, or a proxy on this one — is asked to sign in ([Signing in](remote.md#signing-in)). Required when `EVEN_KEEL_HOST` is not loopback, 16+ characters of `A-Z a-z 0-9 . _ ~ + / = -`, e.g. `node -e "console.log(crypto.randomBytes(24).toString('hex'))"`. Changed, every device signed in with the old key is signed out; passkey sign-ins stay |
| `EVEN_KEEL_MCP_PORT` | `4748` | port of the local MCP gateway the chain sessions reach their packages' servers through; always on `127.0.0.1`. Read at startup |
| `EVEN_KEEL_MACHINES_PORT` | `4749` | port the hub listens on, on all interfaces, for other machines while `machinesAddress` is set; machines elsewhere do not run tasks yet. Read at startup |
| `EVEN_KEEL_DATA` | the clone's own folder, or the platform's one of an npm install | the data folder — `.env`, `state/`, `logs/`. Set in the environment of the service or the terminal, not in `.env`, which is in it |
| `EVEN_KEEL_STATE_DIR` | `state/` of the data folder | where state lives (the state database with the chain and the launch log, accounts, packages, statistics database). Read at startup |
| `EVEN_KEEL_CONFIG` | `even-keel.config.json` in the data folder | path to the config file of an older install, imported into the database at the first start. Read at startup |
| `EVEN_KEEL_CPU_PROFILE` | — | seconds of the start to record a CPU profile of, at most 600: the file `logs/start-<time>.cpuprofile` opens in Chrome DevTools or VS Code. For a slow start; remove it afterwards. Read at startup |
| `EVEN_KEEL_STALL_PROFILE` | off | Set to `1` to sample the service every 10 ms. A five-second window with an event-loop delay of at least one second can produce a `logs/stall-<time>.cpuprofile` file, at most once per hour per process. The service keeps the newest 20. Its log names the file and the functions with the most self time. Change this live in `.env`. |

### Agents and their accounts

| Variable | Default | What it does |
| --- | --- | --- |
| `EVEN_KEEL_CLAUDE_BIN` | — | path to the `claude` binary; beats the "CLI version" setting |
| `EVEN_KEEL_ACCOUNTS_DIR` | `~/.claude-accounts` | folder of the extra Claude account folders |
| `EVEN_KEEL_CODEX_BIN` | Even Keel's copy of the checked version when the "CLI version" setting is Checked, otherwise the native one of the global npm package on Windows, `codex` elsewhere | path to the `codex` binary; beats the "CLI version" setting |
| `CODEX_HOME` | `~/.codex` | Codex's own folder, its first account. Read at startup |
| `EVEN_KEEL_CODEX_ACCOUNTS_DIR` | `~/.codex-accounts` | folder of the Codex account folders added from the page |
| `EVEN_KEEL_OPENCODE_BIN` | Even Keel's copy of the checked version when the "CLI version" setting is Checked, otherwise the native one of the global npm package on Windows, `opencode` elsewhere | path to the `opencode` binary; beats the "CLI version" setting |
| `EVEN_KEEL_OPENCODE_ACCOUNTS_DIR` | `~/.opencode-accounts` | folder of the OpenCode account folders added from the page |
| `EVEN_KEEL_COPILOT_BIN` | Even Keel's copy of the checked version when the "CLI version" setting is Checked, otherwise on Windows the `copilot.exe` winget installed, else the native `copilot.exe` of the global npm package, `copilot` elsewhere | path to the `copilot` binary; beats the "CLI version" setting |
| `EVEN_KEEL_COPILOT_ACCOUNTS_DIR` | `~/.copilot-accounts` | folder of the GitHub Copilot account folders added from the page |
| other keys | — | whatever a package's MCP server reads (a `${…}` placeholder of its entry), entered in its package's details in **Settings → Packages** or by hand |

### Statistics and the badge

| Variable | Default | What it does |
| --- | --- | --- |
| `TALLY_DB_HOST`, `TALLY_DB_PORT`, `TALLY_DB_NAME`, `TALLY_WRITER_PASSWORD`, `TALLY_READER_PASSWORD` | — | your own Postgres for the statistics, used when `tally` is `server`: the collector writes as `tally_writer`, the page reads as `tally_reader` (`TALLY_WRITER_USER` and `TALLY_READER_USER` name other roles). Settings → Stats writes them for you after checking the connection. `tally/deploy/` has a Compose file that creates both roles |
| `TALLY_LLM_URL`, `TALLY_LLM_KEY`, `TALLY_LLM_MODEL` | the model: `google-gemini-3.1-flash-lite` | optional classifier of stuck spans on `/stats` and English titles on README badges: your LiteLLM endpoint, its bearer key and model (the default one is on the free tier; fallbacks set in LiteLLM). Without them spans have no explanation and badges show task keys. Badge translation reads changes live and retries failures after 30 minutes, or at once after a change of these three. With the URL and key the chat microphone records and the model transcribes (`docs/guide/chat.md`) |
| `TALLY_LLM_DICTATION_MODEL` | `google-gemini-3.5-flash-lite` | the model the chat microphone's recordings go to through the same LiteLLM: one that takes audio, other than the classifier's so they do not share a free quota. Read live |
| `EVEN_KEEL_BADGE_SECRET` | — | the secret the README badge's Worker takes pushes with; without it no badge is pushed |

## Protection setting

`protection` is shared and per project, edited in **Sessions → Protection**. Its default is `{ "disabled": [], "claude": [], "codex": [], "copilot": [], "opencode": [] }`: all built-in groups on, no extra native rules.

`disabled` lists groups to turn off: `forcePush`, `mirrorPush`, `deleteRemote`, `deleteRoot`, `deleteHome`, `deleteParent`, `ownAddress` (requests to Even Keel's own address), and one per tracker: `deleteHuly`, `deleteGithub`, `deleteGitlab`, `deleteLinear`, `deleteJira`, `deleteForgejo`.

The other fields add native deny rules: Claude permission strings, Codex arrays of command arguments (for example `["terraform", "destroy"]`), Copilot tool strings, and OpenCode bash command glob patterns (for example `git reset --hard*`).

A project's field replaces its shared counterpart; omitted fields inherit.

New launches only; see [coverage and limits](protection.md).

## Task labels

Automation clients can call `POST /api/task/labels` with a task ID in `task` and lists of label names in `add` and `remove`.

Huly, GitHub, GitLab, Linear, Jira and Forgejo support it.

Removals precede additions; names are matched without case and surrounding whitespace, and labels already present keep their spelling.

Missing label definitions are created in the workspace, repository, project or team as appropriate; Jira uses free labels.

The profile needs permission to edit issues and labels.

Saved labels, including their effect on model selection and chain rules, appear in service state immediately.

If the tracker refuses, refresh the task and check its labels before retrying: a multi-request operation may have partly completed. See the [adapter reference](../trackers.md) for details.
