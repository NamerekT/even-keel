# Reference

Every environment variable and every setting. How to set Even Keel up is in [setup](setup.md), what it does in the [guide's pages](README.md).

- [Environment](#environment) — the variables of `.env`: the page's address and token, folders, paths to the CLIs, the statistics database
- [Configuration](config.md#configuration) — the page and the service, machines, the chain, projects, a project's tracker
- [Configuration: CI, sessions and statistics](config-sessions.md) — CI and pull requests, sessions and agents, context, cache and handoffs, statistics
- [Protection setting](#protection-setting) — the format of the `protection` key
- [Task labels, for scripts](#task-labels-for-scripts) — the API call that changes a task's labels

Each table row gives a name, its default and what it does. Where the page has the setting under a name of its own, the row gives that name in bold.

## Environment

`.env` is in the data folder: a clone's own folder, or for an install with npm `%LOCALAPPDATA%\even-keel`, `~/Library/Application Support/even-keel` or `~/.local/share/even-keel` (`$XDG_DATA_HOME/even-keel`).

- **Changes apply live.** Even Keel watches the file and applies a change without a restart: the page moves to a new address, the collector reconnects. Only the variables marked "read at startup" need a restart.
- **It is Even Keel's own.** Nothing in `.env` reaches the agents' sessions, the task's commands or the MCP servers (a package's key reaches only its own server, through the gateway). Neither do the page token, Tally's passwords and key and the badge secret when they are set in the service's environment instead.
- **What a session needs goes elsewhere.** A variable a session must see, such as the credentials of a cloud account that takes them from the environment, goes into the service's own environment, not into `.env`: the cloud account form looks only there. A Claude Code account run as a background job (`--bg`) hands its sessions the environment its background process started with, so a change reaches them once that process restarts ([Accounts](accounts.md)).
- **Tracker and CI credentials** are not here but in the profiles ([Connecting a tracker](tracker-connect.md)); a profile's change applies at once too. Tracker variables left in `.env` by an older version are taken into profiles once ([From an older version](updating.md#from-an-older-version)).
- **Some are on the page.** The owner key is in **Settings** → **Sign-in and devices**, the statistics database under **Your own Postgres** on **Stats**, the span classifier in its section on **Stats** (a blank key keeps the saved one). The page edits only those lines of `.env`, comments and order kept. It never shows the value of a password, token or key, only whether it is set; addresses and names are shown as they are. A variable set in the service's own environment rather than in `.env` cannot be changed there: its field is off, and its tip says so.

### The page and its folders

| Variable | Default | What it does |
| --- | --- | --- |
| `EVEN_KEEL_HOST`, `EVEN_KEEL_PORT` | `127.0.0.1` and `4747` | where the page listens. Any other address than loopback needs `EVEN_KEEL_TOKEN` ([Reaching the page from another machine](remote.md#reaching-the-page-from-another-machine)). Changed, the page moves to the new address; if it cannot listen there, it stays on the old one and says so on the page. Sessions get the address as `EVEN_KEEL_URL` for the packages' hooks; sessions already running keep the old one |
| `EVEN_KEEL_TOKEN` | — | the owner key: the first sign-in to the page and the way back in when every passkey is lost; scripts send it as `Authorization: Bearer`. Set, a request by any name but a loopback one — another machine, or a proxy on this one — is asked to sign in ([Signing in](remote.md#signing-in)). Required when `EVEN_KEEL_HOST` is not loopback, 16+ characters of `A-Z a-z 0-9 . _ ~ + / = -`, e.g. `node -e "console.log(crypto.randomBytes(24).toString('hex'))"`. Changed, every device signed in with the old key is signed out; passkey sign-ins stay |
| `EVEN_KEEL_MCP_PORT` | `4748` | port of the local MCP gateway the chain sessions reach their packages' servers through; always on `127.0.0.1`. Read at startup |
| `EVEN_KEEL_MACHINES_PORT` | `4749` | port the hub listens on, on all interfaces, for other machines while `machinesAddress` is set ([Hub and machines](hub-machine.md)). Read at startup |
| `EVEN_KEEL_DATA` | the clone's own folder, or the platform's one of an npm install | the data folder — `.env`, `state/`, `logs/`. Set in the environment of the service or the terminal, not in `.env`, which is in it |
| `EVEN_KEEL_STATE_DIR` | `state/` of the data folder | where state lives (the state database with the chain and the launch log, accounts, packages, statistics database). Read at startup |
| `EVEN_KEEL_CONFIG` | `even-keel.config.json` in the data folder | path to the config file of an older install, imported into the database at the first start. Read at startup |

### Agents and their accounts

| Variable | Default | What it does |
| --- | --- | --- |
| `EVEN_KEEL_CLAUDE_BIN` | — | path to the `claude` binary; wins over **CLI version** |
| `EVEN_KEEL_CODEX_BIN` | the CLI **CLI version** picks | path to the `codex` binary; wins over **CLI version** |
| `EVEN_KEEL_OPENCODE_BIN` | the CLI **CLI version** picks | path to the `opencode` binary; wins over **CLI version** |
| `EVEN_KEEL_COPILOT_BIN` | the CLI **CLI version** picks | path to the `copilot` binary; wins over **CLI version** |
| `EVEN_KEEL_ACCOUNTS_DIR` | `~/.claude-accounts` | folder of the extra Claude account folders |
| `CODEX_HOME` | `~/.codex` | Codex's own folder, its first account. Read at startup |
| `EVEN_KEEL_CODEX_ACCOUNTS_DIR` | `~/.codex-accounts` | folder of the Codex account folders added from the page |
| `EVEN_KEEL_OPENCODE_ACCOUNTS_DIR` | `~/.opencode-accounts` | folder of the OpenCode account folders added from the page |
| `EVEN_KEEL_COPILOT_ACCOUNTS_DIR` | `~/.copilot-accounts` | folder of the GitHub Copilot account folders added from the page |
| other keys | — | whatever a package's MCP server reads (a `${…}` placeholder of its entry), entered in its package's details in **Settings** → **Packages** or by hand |

On **Yours**, a CLI is looked up the usual way: on `PATH`, and on Windows the native binary of the global npm package (for Copilot, first the `copilot.exe` winget installed) ([CLI copies](agents.md#cli-copies)).

### Statistics and the badge

| Variable | Default | What it does |
| --- | --- | --- |
| `TALLY_DB_HOST`, `TALLY_DB_PORT`, `TALLY_DB_NAME`, `TALLY_WRITER_PASSWORD`, `TALLY_READER_PASSWORD` | — | your own Postgres for the statistics, used when `tally` is `server`: the collector writes as `tally_writer`, the page reads as `tally_reader` (`TALLY_WRITER_USER` and `TALLY_READER_USER` name other roles). **Settings** → **Stats** writes them for you after checking the connection. `tally/deploy/` has a Compose file that creates both roles |
| `TALLY_LLM_URL`, `TALLY_LLM_KEY`, `TALLY_LLM_MODEL` | the model: `google-gemini-3.1-flash-lite` | your LiteLLM endpoint, its bearer key and model (the default one is on the free tier; fallbacks are set in LiteLLM). Optional; they serve three features: the reasons of stuck spans on `/stats` ([What is counted](stats.md#what-is-counted)), English titles on README badges ([Task titles in English](stats.md#task-titles-in-english)), and with the URL and key the chat microphone ([Chat](chat.md)). Without them spans have no reason and badges show task keys. Read live |
| `TALLY_LLM_DICTATION_MODEL` | `google-gemini-3.5-flash-lite` | the model the chat microphone's recordings go to through the same LiteLLM: one that takes audio, other than the classifier's so they do not share a free quota. Read live |
| `EVEN_KEEL_BADGE_SECRET` | — | the secret the README badge's Worker takes pushes with; without it no badge is pushed |

### For troubleshooting

| Variable | Default | What it does |
| --- | --- | --- |
| `EVEN_KEEL_CPU_PROFILE` | — | seconds of the start to record a CPU profile of, at most 600: the file `logs/start-<time>.cpuprofile` opens in Chrome DevTools or VS Code. For a slow start; remove it afterwards. Read at startup |
| `EVEN_KEEL_STALL_PROFILE` | off | `1` — sample the service every 10 ms: a five-second window with an event-loop delay of a second or more writes `logs/stall-<time>.cpuprofile`, at most once an hour per process, the newest 20 kept. The log names the file and the functions with the most self time. For a page that freezes; read live |

## Protection setting

`protection` is shared and per project, edited in **Settings** → **Sessions** → **Protection** ([Protection](protection.md)). Its default is `{ "disabled": [], "claude": [], "codex": [], "copilot": [], "opencode": [] }`: all built-in groups on, no rules of your own.

- `disabled` lists the groups turned off: `forcePush`, `mirrorPush`, `deleteRemote`, `deleteRoot`, `deleteHome`, `deleteParent`, `ownAddress` (requests to Even Keel's own address), and one per tracker: `deleteHuly`, `deleteGithub`, `deleteGitlab`, `deleteLinear`, `deleteJira`, `deleteForgejo`.
- The other fields add deny rules in each agent's own form: Claude Code permission strings, Codex arrays of command arguments (`["terraform", "destroy"]`), Copilot tool strings, OpenCode command patterns (`git reset --hard*`).
- A project's field replaces the shared one; a field it leaves out is inherited.
- A change applies to new sessions only.

## Task labels, for scripts

A script can change a task's labels with `POST /api/task/labels`: the task's id in `task`, lists of label names in `add` and `remove`. It works on Huly, GitHub, GitLab, Linear, Jira and Forgejo.

- Removals go before additions. Names are matched ignoring case and surrounding spaces; a label already on the task keeps its spelling.
- A label the tracker does not have yet is created in the workspace, repository, project or team; Jira takes free labels.
- The profile needs the right to edit issues and labels.
- The new labels, and what they change in the model choice and the chain rules, take effect at once.
- If the tracker refuses, refresh the task and look at its labels before trying again: a change of several requests may have partly gone through.
