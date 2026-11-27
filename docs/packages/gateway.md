# Packages: the gateway, launch and the check

## The gateway (`gateway.ts`)

Every MCP server a chain session gets goes through the gateway, a local HTTP server of the service. It fills in the keys, so they never reach a session's environment.

- **Address.** `http://127.0.0.1:<EVEN_KEEL_MCP_PORT>` (4748 by default), never another interface: Tailscale Service forwards 4747 to localhost, not this port.
- **Route.** `/mcp/<project GUID>/<package>@<install id>/<server>`. The gateway finds the install and the project's current settings by it, so a session resumed with its saved flags reaches its server after a restart of the service.
- **No token between the session and the gateway**; instead `refusal()`: `Host` must be 127.0.0.1 or localhost (DNS rebinding), a request with `Origin` is refused (a browser page), a `POST` must be `application/json` (a browser cannot send it without a preflight).
- **The gateway cannot listen** → `PackagesView.gateway`, and every chain waits (the red banner; each project's own line points at it).

### How a server is served

- **A remote HTTP server** is proxied with its headers filled from the pool (`files.md`, "Keys").
- **A stdio server with a known HTTP mode** (`HTTP_MODES`, by npm package; Huly: `MCP_TRANSPORT=http`, `MCP_HTTP_HOST`, `MCP_HTTP_PORT`, `MCP_AUTH_TOKEN`, path `/mcp`) runs once per route and environment on a free port with a random bearer token. It is ready once it answers HTTP at all (a `GET` of its path, any status, up to 60 s), not once its port accepts: huly-mcp listens before it attaches its handler, and a request in that gap was never answered (EKR-6). The log says `<package>/<server> started in N s`.
- **Any other stdio server gets a bridge**: a child process per MCP session (`Mcp-Session-Id`), JSON replies, `GET` for the server's own messages as SSE, closed by `DELETE` or after 30 minutes (`IDLE_MS`) with no request and no open `GET` stream.
- **On Windows** a stdio command that is not `node` or an `.exe` (`uv`, `npx`) runs through `cmd.exe`, which gets one joined line: every argument with a space or a shell character is quoted (`shellQuoted`), otherwise a path like `…\Claude Extensions\…` falls apart.
- **A machine's own command.** A machine elsewhere may run a stdio server with a command and arguments of its own (BTN-994, `docs/settings/levels.md`, "A machine in a project"): the hub's brief to it gives them in `servers`, and `packageTarget` puts them in place of the catalog's entry (`withOverride`, `src/packages/stdio.ts`) before the settings and the placeholders. `Packages.localStdio` lists the stdio servers a project's gateway starts itself, not those carried to the hub (`hubServers`), for the page's fields and the connection's check.
- **A grant** (BTN-475, [`trackers/profiles.md`](../trackers/profiles.md#jira-mcp-oauth-and-the-mcp-token)) replaces only `Authorization` of a remote server whose URL is its provider's fixed MCP address (same origin and path, no credentials in the URL): the entry's other headers stay, and its `Authorization` key is no longer required. The gateway sends `Bearer <access token>`, never the old Basic header; a 401 gets one refresh and one retry, a second 401 marks the grant for reconnecting. Redirects are refused, so a token never follows one.

### Even Keel's own servers

- **The tasks server** (BTN-768, `docs/trackers/tasks-server.md`, "The tasks server") is answered in the gateway, after `refusal()`: `/tasks` and `/tasks/<project GUID>` for sessions started by hand, and any package route whose server entry is a local address with the path `/tasks` (`isTasksUrl`, the `tasks` plugin's `.mcp.json`) with the route's project and the `?task=` that `sessionPackages` appends. Streamable HTTP with JSON replies only: a single message or a batch, 202 when nothing needs a reply, 405 for `GET` and `DELETE` (no stream, no MCP session).
- **The memory server** (BTN-1029, `docs/sessions/memory.md`) is answered the same way, for a package route whose server entry is a local address with the path `/memory` (`isMemoryUrl`, the `agent-bridge` plugin's `.mcp.json`), with `?task=` too, and only by the hub's gateway: a machine's carries every call of a memory route to the hub, also before the hub's brief lists the route in `Packages.hubServers()` (BTN-1733: a route not listed yet answered 404, and the first probe of a project just added failed for minutes). It has no route for sessions started by hand, which keep the file memory, and `sessionPackages` leaves it out of a Claude Code chain session's servers too (`readsFileMemory`, BTN-1647): only agents without the CLI's file memory get it.

### A machine elsewhere

On a machine connected to the hub (BTN-990, `docs/machines/link.md`, "MCP through the hub") the sessions still talk to the machine's own gateway, but not every server runs there:

- **On the hub.** A server that holds a key and the tasks server run only in the hub's second gateway, which listens on a free port of 127.0.0.1; the machine's gateway carries their requests over the link. `hubOwned` on the hub decides which servers those are, and the hub publishes only their route paths through `Packages.hubServers()` / `GatewayHub.servers` (BTN-1238), old pinned installs included. The machine checks the list before resolving a target, so it needs none of the hub's keys or server entries for these routes. `/tasks` also takes `?task=`, the task of the chain session whose call the machine carries.
- **On the machine.** Every other server. The tasks server's package routes are left out of the hub's list so its local stand-in still handles offline reads, queued writes and files.
- **The catalog.** A machine elsewhere has no catalog of its own to edit: it follows the hub's from the hub's brief, its installs under the hub's ids (BTN-1299, `Packages.follow`).

### Protection's tracker groups

Protection's tracker groups (BTN-541) live here, so they hold for every agent, Codex too. A server whose name is a tracker adapter's `mcpServer` gets `refuseDeletes` (the tracker's title) unless the project's effective Protection disables that tracker's group (`TRACKER_GROUPS`). A `tools/call` that deletes a record never reaches the server (`deletesRecord`). It deletes when:

- the tool's name has the word `delete`;
- the tool is `destructive` (Jira's `executeDestructive`, whatever operation it runs, BTN-659);
- its `arguments.method` has the word `delete` (gitea-mcp's `delete_comment`, `deleteLabel`; BTN-476);
- it is a dispatcher calling such a tool (BTN-641): a tool with `invoke`, `call`, `execute` or `run` in its name, such as Huly's `invoke_tool`, naming the tool in `toolName`, `tool_name`, `name` or `tool` and its arguments in `arguments`, `args`, `params`, `input` or `inputs` — an object or its JSON text, nested to any depth. A tool name in the arguments of any other tool, such as `get_tool_schema`, is a read and passes.

The gateway answers such a call with a tool result `isError: true` saying the user must delete it or turn the tracker off; in a batch the other requests get `-32600` and nothing is sent. The log says `mcp gateway: <route>: Protection refused <tools>`. A tracker server outside the project's packages is not behind the gateway and is not covered.

### Errors and the log

- A request the gateway fails with an error (no token, a refused grant, a server gone) logs `<package>/<server>: <error>` once until the error changes, and `<package>/<server> works again` once a request of that project goes through (BTN-589).
- Error diagnostics share OAuth's credential redaction (`src/error-reason.ts`): placeholder values (including arguments and URLs), the target environment, literal environment values and headers, and generated HTTP-mode variables are removed, along with common OAuth fields and Bearer/Basic credentials. Errors are normalized and limited to 500 characters before logging or deduplication; a recovery still logs once. Stderr keeps the last nonempty line, including an unterminated one, and joins chunks before redaction; a line over 2000 characters becomes `[stderr line truncated]` instead of exposing a partial credential. Each launch uses its resolved settings and keys, so changes and restarts need no saved redaction state.

### A bridge through a restart

Only a bridge keeps a `GET` stream open; the tasks and memory servers answer `GET` with 405, hold nothing between calls and come through any restart.

- **The cause** (BTN-1529, read from the CLI's own MCP logs, `%LOCALAPPDATA%\claude-cli-nodejs\Cache\<folder>\mcp-logs-<server>\`). The Windows service kills node (`Process.Kill()`, `service/EvenKeelService.cs`), so `McpGateway.close()` never runs and every stream is reset. The Claude CLI counts the reset and the retries that meet a closed port as terminal errors, tries a few reconnects and gives up about 18 s after the drop, while a restart is down longer. The server then stays `failed` until the session's process starts again (a resume); the transcript's `deferred_tools_delta` shows it only on the next turn. Measurements: [`verified/packages.md`](../verified/packages.md).
- **The solution** (BTN-1544, `held-port.ts`). `src/start.ts` holds `EVEN_KEEL_MCP_PORT` right after `.env` is read, before the storage and the service, and keeps every request unanswered, its body unread, until `McpGateway.listen` takes the server over and answers them in order. The CLI's reconnects meet a port that accepts within the first seconds of the new process, and a held request is no error to it. A port that cannot be taken (the old process still on it) leaves the hold out and the gateway listens as before, reporting the same error. A start blocked on the storage gives the port back first, answering what waited with 503, and the hub's gateway (port 0) never takes a hold. A Windows stop still kills node: the graceful stop was weighed and left out.
- **The trap.** Not checked live ([`unverified/packages.md`](../unverified/packages.md#a-bridged-server-through-a-service-restart-btn-1544)): a session can still lose a bridged server if node takes longer than ~18 s to reach the hold, or the CLI times a held request out.

### A bridge's idle stream

- **The cause** (BTN-1543). A bridge's `GET` stream with no bytes was cut after about 5 minutes, again and again. The CLI counts each cut as a terminal error, and a `GET` that comes back does not reset the count: only a message does. So every ~18 minutes it closed the transport and sent `initialize` again, which started a new bridge and process while the old one waited out `IDLE_MS`. The cut is the client's: `node:http`'s `requestTimeout` and `headersTimeout` end once a `GET` is read and never touch an open response, while Bun's `fetch`, which the CLI's binary is built on, fails a body that brings nothing for 300 s.
- **The solution.** Each open `GET` stream of a bridge gets an SSE comment `: keep-alive` every 30 s (`STREAM_PING_MS`); an SSE parser skips it, so it is no message to the session.
- **The trap.** An open stream is also a live session: a bridge does not close idle while one is open, and its 30 minutes start when the last one closes. A session that dies closes its socket, so its bridge still goes.

## Launch

What each agent reads of a plugin (`pluginReach` in `src/agent/projectRules.ts`); a plugin with more than the agent reads is marked `unsupported`, which holds nothing:

| Agent | Reads of a plugin | Mark |
| --- | --- | --- |
| Claude Code | everything | — |
| Codex | skills and hooks; commands and agents stay out | — |
| Copilot | everything, in the Claude Code format | — |
| OpenCode | the skills, and the plugin's own `opencode/` scripts | `unsupported`, shown as "no hooks", for a plugin with Claude Code hooks, commands or agents |
| any other | only the servers | `unsupported` |

- **Claude** (`src/claude/cli.ts`): `--mcp-config <JSON>` and `--strict-mcp-config` before the other flags (`--mcp-config` takes several values and would swallow the prompt), `--plugin-dir` per plugin of the set, and in `--settings` `enabledPlugins: false` for every other enabled plugin (`otherPlugins`). `--strict-mcp-config` cuts off `.mcp.json` of the folder and its parents, user and local scope and the plugins' own MCP: every MCP server goes through `--mcp-config`. A plugin's server is named `plugin_<plugin>_<server>`, so its tools stay `mcp__plugin_huly_huly__*` and the plugin's hooks and permission rules keep working; an MCP package's server keeps its own name. `--bg --resume` of a stopped session wakes it with its saved flags (`respawnFlags` in `jobs/<id>/state.json`).
- **Codex** (`src/codex/mcp.ts`, `src/codex/plugins.ts`, BTN-180): `-c mcp_servers.<server>.url=<gateway address>` per server, no keys in the turn's environment; a plugin's server is named `plugin_<plugin>_<server>` as in Claude Code. A plugin reaches it so:
  1. Every install is its own marketplace `ek-<install id>`: `Packages.startOf` writes `state/packages/<package>/<install id>/.claude-plugin/marketplace.json` beside the copy (one plugin, `source: "./plugin"`) on its first session (`ensureMarketplace`).
  2. On the first turn of a plugin in a Codex folder, `codex app-server` installs it (`plugin/install`, into `<folder>/plugins/cache/<marketplace>/<plugin>`) and turns it off again in the folder's `config.toml` (`config/value/write`), so the user's own Codex sessions do not get it; a folder whose cache already has it is not installed into again. Each such first turn logs one line, `installed into folder <tag>` or `found in the cache of folder <tag>`, the tag a hash of the folder's path (EKR-65). A failed install is the notice `codex.pluginsFailed` and the launch fails.
  3. `hooks/list` gives the hashes of its hooks, kept in memory while the service runs. The hash trusted is the hook's own: from 0.164.0 `currentHash` is `sha256:<hook>/sha256:<plugin contents>`, and `trusted_hash` accepts only the part before the `/` — the whole value or the plugin's half reads `modified`, no `hooks.state` reads `untrusted`, and either way the hooks are skipped (EKR-29). A new hash format takes a service restart. Before the hashes are kept, `hooks/list` is asked once more with the turn's own flags; a hook of the plugin not `trusted` there (or gone from the answer) is the notice `codex.hooksUntrusted`, naming the package, the CLI version and each hook's key with its `trustStatus`, and the launch fails, so a change of the format cannot run the chain without `merge-check`, the context reminders and the mail.
  4. Every turn gets `-c` flags, as one inline table: the marketplace (`source_type = "local"`, its folder), the plugin on, the plugin's own MCP servers off (the gateway serves them), every other plugin of the folder's `config.toml` off (as `otherPlugins` for Claude; a key with a `.` cannot be named in `-c` and stays as it is), and `hooks.state` with the hooks trusted by their hash: Codex skips an untrusted hook without a word.

  No `--ignore-user-config`: it would also drop the folder's `model`, project trust, `[windows] sandbox`, `notify` and memory, so the MCP servers of the folder's `config.toml` still reach Codex sessions.
- **OpenCode** (`src/opencode/cli.ts`, `sessionConfig`, BTN-214): the gateway's servers as `remote` servers in `OPENCODE_CONFIG_CONTENT`, the project's own `opencode.json(c)` servers turned off by name (no `OPENCODE_DISABLE_PROJECT_CONFIG`: it drops the project's instructions too); the servers of the account's own config still reach it, as with Codex. A plugin's `skills/` goes into `skills.paths` (with the project's own `.claude/skills` and `.agents/skills`, `skillDirs`, `docs/sessions/opencode.md`), and the scripts of its `opencode/` folder into `plugin` (`pluginFiles`, BTN-274: OpenCode's hooks are JS plugins, so a package brings its own, as `agent-bridge` and `huly` do; what Huly's does is in `docs/trackers/plugins.md`).
- **Copilot** (`src/copilot/cli.ts`, BTN-215): the gateway's servers as `--additional-mcp-config` (`type: "http"`, `tools: ["*"]`), and since Copilot has no strict mode, `--disable-builtin-mcps` and `--disable-mcp-server` for each server of the project's `.mcp.json`, `.github/mcp.json`, `.vscode/mcp.json`, the account's `mcp-config.json` and the set's plugins (`ownServers`). A plugin goes as `--plugin-dir`, which Copilot loads in the Claude Code format with its skills and hooks. Its command hooks were seen running through `cli-check` ([`verified/packages.md`](../verified/packages.md)); skill loading and full handoffs driven by hooks remain unchecked (`docs/unverified.md`).
- **The project's standards** (BTN-359, `docs/sessions/protection.md`, "Project standards") come with the `agent-bridge` package, so each agent gets them its own way above: Claude Code and Codex from the plugin's hooks (Codex's edit is `apply_patch`), Copilot from the same hooks with its own tool names (`view`, `edit`, `create`, `str_replace` — not seen live, `docs/unverified.md`), OpenCode from `opencode/agent-bridge.mjs`. A project without the package's hooks gets no standards.
- **Pins.** Each launch of a task updates its pin before the flags are built (`files.md`, "The file and the cache").

## The check before a launch (`check.ts`)

Problems of a package in a project, and what each does to the chain:

| Problem | What it means | The chain |
| --- | --- | --- |
| `notInstalled` | an enabled package with no install | pauses |
| `installFailed` | its install failed | pauses |
| `lost` | its current install's files are gone (`files.md`, "Lost installs") | pauses |
| `noKey` | a key its servers need is not set (with the variables) | pauses |
| `installing` | an install is under way | waits |
| `probing` | no answer to a probe yet since the service started or the package was installed | waits |
| `noResponse` | the server does not answer the probe | waits |
| the gateway | the gateway cannot listen | waits, every project |
| `noTrackerMcp` | `brief` is explicitly `false` and no enabled package brings the tracker's server — nor `tasks` for a tracker Even Keel's tasks server serves (`servesTasks`, BTN-882; `CheckInput.tracker.also`) | pauses with `chain.noTrackerMcp` |
| `unsupported` | the agent does not read all of a plugin ("Launch") | nothing: only a mark |

- **A wait.** While a project has a problem that holds it (`blocked`), the dispatcher launches nothing for it (`packagesBlocked`) and goes on by itself once the problem is gone. The project's chip says "waiting · packages" (or "· gateway") and its card and page a line naming each package and its problem (`chainWaits` in `web/src/waits.ts`, `ChainWaits.tsx`), with "Open the project's packages" for `noResponse`. `PackagesBanner` shows only the gateway, since it holds every project.
- **A pause** (BTN-657). What only the user fixes (`NEEDS_USER`, `Packages.unready`) pauses the chain instead: the `packagesPause` hook gives `chain.packagesNotReady` with the packages, checked by every launch, Start, Resume and `wake` like `noTrackerMcp` (`SELF_CLEARING`, so Start and Resume go in paused and the pause lifts by itself once the packages are ready), with "Open the project's packages" (`/p/<id>?pkg=1`) beside it.
- **`noTrackerMcp`.** With `brief` auto the setting turns itself on instead, and nothing pauses. `chain.noTrackerMcp` has its buttons beside it (`page.md`, "The tracker's package in two clicks"; `docs/chain/pr-mode.md`, BTN-656).
- A fix session of a red `main` neither waits nor pauses.

### Probes

- A success lives 5 minutes.
- Failures in a row are retried after 30 s, 1, 2, 5, 15, 30 minutes, then once an hour (`PROBE_FAILED_MS`, BTN-589); back to 30 s after a success or any change of the tracker profiles, a save or a new grant (`Probes.retry`).
- While the project's chain runs, not paused (the hub's brief to the machine, `PackagesDeps.waited`), at least once a minute (`PROBE_WAITED_MS`), and at once when the hub's brief brings a chain started or resumed (BTN-1518), so a chain does not wait out the hour's probe once its server is back.
- `noResponse` is a failed answer, a server gone, or silence after the server has answered once. For a server that has answered, only the second such miss in a row counts: the first stays `probing`, asked again in 30 s, since a short drop of the host's network fails every outside call at once (`Probes.run`, BTN-1248); before its first answer a failed one counts at once.
- `probing` is shown as a spinner beside the package's switch in the project's packages, "starting" in its tip, not a problem line: it passes in seconds after every service start. Probes that timed out at 30 seconds are asked again at once. Nothing is asked before the gateway listens, so the first state build of a start is never `noResponse` (BTN-1225). The gateway logs `<package>/<server> did not answer initialize in N s, still starting`.

### The tracker's server in the set

Whatever `brief` is, `ProjectPackages.tracker` tells the page the tracker's server and whether a package of the set brings it (`null` for a tracker without one; `PackagesDeps.tracker`, EKR-5):

- `through: 'tasks'` — only the tasks server brings the tracker: the page names `tasks@even-keel` as the package that brings it and offers no tracker plugin;
- `also: 'tasks'` — the tasks server can serve this tracker, so the page offers it first (BTN-874);
- `both` — the set brings the tracker's own server and the tasks server at once: a warning on the page, holding nothing.
