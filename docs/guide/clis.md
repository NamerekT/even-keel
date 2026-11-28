# The CLIs it depends on

Even Keel drives the agents' CLIs through behaviour none of them documents, so a CLI update can break it. This page lists what it relies on in each CLI and where it finds the binaries.

Each agent's **CLI version** (in the setup's Agent step or Settings → **Providers and models**) is **Yours**, the CLI installed on the machine, or **Checked**, Even Keel's own copy of the version it was checked against ([CLI copies](agents.md#cli-copies)). Below, for each CLI, is where that copy comes from.

## Claude Code

**Even Keel depends on undocumented behaviour of the Claude Code CLI**: `claude agents --json`, the `sessions/<pid>.json` records and the `jobs/<id>/state.json` job files, the background daemon (`claude --bg`, `--bg --resume`, `claude daemon`), the transcript format, the text of `/usage`, the layout of `~/.claude.json`, `.credentials.json` and `plugins/installed_plugins.json`, and on macOS the name of the Keychain item that holds a folder's sign-in. None of it is a public API.

A version becomes the checked one after one live session on it went through a launch, a question answered from the chat, the chat's feed, a handoff and a stop.

By default chain sessions run on your own CLI, on whatever version it has updated itself to, and the event log (**Log** in the header) gets a warning when that is another version than the checked one: the stage, the context fill or a limit may then be read wrong, at worst a session does not start.

**Checked** runs them on the checked version instead; the log's warning opens the setting. Even Keel downloads it from Anthropic into `state/cli/claude/<version>/` (~340 MB a version, checked against Anthropic's sha256) and turns the auto-updater off for those sessions so they never update your own install. The pin has limits:

- A session runs on the version of its account folder's daemon. A daemon on another version is restarted only once no session of that folder is live, and a newer `claude --bg` or `claude agents` run in the same account folder replaces the pinned daemon with its own version: keep your own background sessions out of the chain's account folder.
- Anthropic's servers may refuse an old version, and an old version may not know a new model's alias. Then the checked version is raised in a new release of Even Keel.
- The transcripts your own sessions write on a newer version are read as before: the pin covers how chain sessions are run, not those files.

Where Even Keel finds Claude Code: its native install in `~/.local/bin` (`claude.exe` on Windows), then the native binary of `npm install -g @anthropic-ai/claude-code`, then the binary of the VS Code extension, then `claude` on `PATH`; `EVEN_KEEL_CLAUDE_BIN` overrides. The page suggests the native installer (`curl -fsSL https://claude.ai/install.sh | bash`, on Windows `irm https://claude.ai/install.ps1 | iex` in PowerShell): a newer npm skips the package's postinstall unless allowed, and then `claude` in a terminal prints "claude native binary not installed", though Even Keel still finds the binary inside the package.

## Codex

**The same goes for the Codex CLI**: the events of `codex exec --json` (`thread.started`, `item.completed`, `turn.completed`, `turn.failed`), `-c` overrides of its config keys (`mcp_servers`, `marketplaces`, `plugins`, `hooks.state`), the rollout files `sessions/YYYY/MM/DD/rollout-*.jsonl` and their `session_meta`, `turn_context`, `event_msg` (`token_count` with the context fill and the rate limit windows, `task_complete`, errors) and `response_item` lines, the `plugin/install` and `hooks/list` calls of `codex app-server`, the `[plugins.*]` tables of `config.toml` and the `plugins/cache` layout, the claims of the ID token in `auth.json`, the text of `codex login status` and of its quota errors, and the layout of the npm package on Windows. Codex lists models by the client's version, so an old pinned version may not offer a new model.

With **Checked**, Codex sessions run on the checked version the same way: Even Keel unpacks the platform's npm package `@openai/codex@<version>-<platform>` (Apache-2.0, checked against the registry's sha512) into `state/cli/codex/<version>/`.

Codex's own folder is `CODEX_HOME` or `~/.codex`, the accounts added from the page live in `~/.codex-accounts`; `EVEN_KEEL_CODEX_BIN` overrides the binary.

## OpenCode

**OpenCode too**: Even Keel relies on the JSON events of `opencode run --format json`, its `-s` and `--title`, `OPENCODE_CONFIG_CONTENT`, the XDG folders, `auth.json`, the tables `session`, `message` and `part` of `opencode.db`, and the text of `opencode providers login`.

With **Checked**, its sessions run on the checked version: Even Keel unpacks the platform's npm package of its native binary (`opencode-windows-x64@<version>` and the like, MIT, checked against the registry's sha512, ~80 MB a version) into `state/cli/opencode/<version>/`, with self-update turned off. An x64 processor without AVX2 needs OpenCode's `-baseline` build, which Even Keel does not take: keep its **CLI version** on **Yours** there.

With **Yours**, sessions run on the `opencode` you installed (`npm install -g opencode-ai`; Even Keel takes the native binary inside the global npm package, also when npm skipped the package's postinstall); `EVEN_KEEL_OPENCODE_BIN` overrides both.

Its accounts live only in `~/.opencode-accounts`: your own OpenCode's folders are not listed.

## GitHub Copilot

**GitHub Copilot too**: Even Keel relies on the JSONL of `copilot -p --output-format json`, its `--session-id`, `--resume`, `--no-ask-user`, `--add-dir`, `--additional-mcp-config`, `--disable-mcp-server` and `--plugin-dir`, `COPILOT_HOME` and `COPILOT_GITHUB_TOKEN`, and the events of `session-state/<id>/events.jsonl`.

With **Checked**, its sessions run on the checked version: Even Keel unpacks the platform's npm package of its native binary (`@github/copilot-win32-x64@<version>` and the like, checked against the registry's sha512, ~155 MB a version) into `state/cli/copilot/<version>/`, with `--no-auto-update` and `COPILOT_AUTO_UPDATE=false`.

With **Yours**, sessions run on the `copilot` you installed: on Windows Even Keel finds by itself the `copilot.exe` of `winget install GitHub.Copilot` and the native `copilot.exe` of `npm install -g @github/copilot` (npm's own `copilot` wrappers need a shell and are not run); `EVEN_KEEL_COPILOT_BIN` overrides both, for a binary installed anywhere else. When the binary cannot be started, the chain pauses and says so, with a button to the **CLI version** setting.

Sign in once with `copilot login`, or add accounts with tokens on the accounts page. Its accounts live only in `~/.copilot-accounts`: your own `~/.copilot` is not listed.

### Copilot's own sign-in on Linux without a keyring

On Linux without a keyring, Copilot's own sign-in needs a terminal and the managed account's folder:

1. When the CLI confirms that folder is signed out, the accounts page shows "Sign-in needed" and a command to copy, with the account's folder and the same CLI binary as sessions.
2. Run it on the machine running Even Keel, as the same OS user: in cmd on Windows, standard sh on Linux and macOS. The command sets the account's `COPILOT_HOME` and leaves out `COPILOT_GITHUB_TOKEN`, `GH_TOKEN` and `GITHUB_TOKEN` for itself; your terminal's environment stays as it was.
3. The CLI asks whether to save the token as plain text in that folder's `config.json`, since there is no keyring: answer yes.
4. The card updates after the next account check, without restarting Even Keel.

Things to know:

- A sign-in without the account's `COPILOT_HOME` saves into your own `~/.copilot`, which managed sessions do not read; a sign-in without a terminal may report "token was not saved" without asking about plain text.
- A check that cannot tell — the CLI missing, a timeout, an empty or unreadable status — shows "Could not check" and lets sessions start.
- An account signed in this way shows no remaining-allowance bar.
- Instead of signing in, you can add a token on the accounts page; a folder's own token takes priority over the machine's sign-in.
