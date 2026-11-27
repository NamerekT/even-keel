# The service on each platform

## Windows

Two ways to run it: the start at sign-in with a tray icon (BTN-372, `even-keel install`, no administrator — the default) and the Windows service `EvenKeel` (`install.ps1`, runs without a sign-in). One per machine, they share the port: `even-keel install` refuses while the service is registered, `install.ps1` while the `Run` value is.

What both share:

- **The host code** — `service/EvenKeelService.cs` with `EvenKeelHost.cs` and `EvenKeelTray.cs`. It keeps `node --import tsx src/main.ts` running in the repository root (`node dist/src/main.js` in a package, which has no `src/main.ts`), restarts it on a crash and writes the output to `logs/even-keel.log`. A third argument is the data folder of a package: the log goes there and the child gets it as `EVEN_KEEL_DATA`.
- **`.env`** from the repository root (a package: its data folder), and at the first start `even-keel.config.json` from there, if there is one, imported once. The address is `EVEN_KEEL_HOST` and `EVEN_KEEL_PORT` (`127.0.0.1:4747` without them); the port must not be taken by a manual run.
- **The built `dist/web`** is what they serve: the installers run `npm run build`. After a code update, install again (or `npm run build` and a restart), otherwise the page is stale or returns 503.
- **Stopping the host does not kill background sessions**: they are children of the agent's daemon (`claude daemon run`), not of node.
- **Stop it before `npm ci` or `npm install`**, and after an `npm ci` that failed next to a running Even Keel, stop it and run `npm ci` again. The running service holds `node_modules/@esbuild/win32-x64/esbuild.exe` (tsx's esbuild child) while tsx compiles, likely right after an update changed the sources; npm fails on it with `EPERM`, and `npm ci` leaves `node_modules` half-removed (BTN-157). The host stops node with `Process.Kill()` and esbuild exits with it, so stopping the host is enough; `install.ps1` and `even-keel install` stop it themselves ([`verified/updating.md`](../verified/updating.md)).

### The start at sign-in (BTN-372)

- **The host** is compiled by `src/autostart.ts` as `EvenKeel.exe` with `-target:winexe`, so no console window: into `<data>\service` for a package, `service\bin` for a checkout (`hostDirOf`).
- **Install** (`installAutostart`): end a running host first (it holds the exe) and remove the exe once its process lets go of it — `--quit` returns when the host frees its mutex, before the process ends, so `removeHostExe` retries `EPERM`/`EBUSY` for up to 10 s (EKR-93); compile; write `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` → `EvenKeel` = `"<exe>" "<root>" "<node>" ["<data>"] --tray` with `reg.exe`; start it. A value, not a Startup shortcut: a shortcut needs COM through PowerShell, and Settings → Apps → Startup turns either off. From a checkout `even-keel install` runs `npm install` and `npm run build` first, as `install.ps1` does.
- **Uninstall** ends the host, deletes the value and the exe with the same retry, and the folder once empty (the service's host may share it).

**Modes**, the last argument:

| Mode | What it does |
| --- | --- |
| `--tray` | the host with the icon, one per machine (the mutex `Global\EvenKeel.Host`; a second one exits at once) |
| `--start` | tells a running host to start node, or starts a host with the same arguments and `--tray` through a shell start, which inherits no handles, so a caller reading its output does not wait for the host |
| `--stop` | the host stops node and keeps it stopped; the call returns once node is down (30 s at most) |
| `--quit` | the host stops node and exits |

The commands are the events `Global\EvenKeel.Stop|Start|Quit` and `Stopped`: global, so `rebuild.ps1` over SSH, in another Windows session of the same user, reaches the host on the desktop. A stop for an update keeps the host and its icon for that reason: a host started from SSH would have no tray and end with the SSH session. Node held stopped, or started again by a start or **Restart**, begins its crash backoff anew.

**The icon** is the page's `dist/web/icon-192.png` with a dot:

| Dot | When |
| --- | --- |
| green | running |
| amber | a chain paused (`chain.active[].paused`) |
| blue | a session waiting on its question (`sessions[].asking`); a question wins over a pause |
| grey | starting (no answer in the first 2 min after node started) or stopped for an update |
| red | no answer |

It reads `GET /api/tray` every 10 s (BTN-826): only `{language, asking, paused}`, counted from the current sessions and active chains, without building the page's state. The address is `EVEN_KEEL_HOST`/`EVEN_KEEL_PORT` from its environment over `.env` of the data folder, the wildcard on loopback as `stateUrlOf` does. The menu and tooltip follow the state's `language`, the Windows display language before the first answer; an answer with no language keeps the current one. **Restart** kills node and starts it at once; **Quit** ends the host until the next sign-in or `even-keel install`. The log lines are `tray: …` in `logs/even-keel.log`.

- **`EVEN_KEEL_LAUNCHER`.** Node under the host gets the host's exe in it. `serviceControl` takes it only when the parent process is `EvenKeel.exe` too (`launcherOf`): the sessions inherit the variable, not the parent.
- **`PATH`** is built at every node start (`FreshPath`, EKR-57): the registry's machine `Path`, then the user's, then the host's inherited entries neither has (fnm, nvm, Volta of the terminal `even-keel install` ran in), compared case-insensitively without a trailing `\`; an unreadable registry leaves the inherited `PATH` and one log line. So a CLI installed after the host's start is found after the tray's Restart. The service `EvenKeel` runs the same code.
- **The control** is `autostart`: stop `EvenKeel.exe --stop`, start `EvenKeel.exe <root> <node> [<data>] --start` (`autostartControl`). `even-keel update` finds it from the `Run` value (`registeredAutostart`); `rebuild.ps1` passes `--autostart <exe>` when no service `EvenKeel` is installed and the value is.

### The service `EvenKeel`

- The host is compiled during installation by the stock `csc.exe` from .NET Framework; there are no third-party wrappers. To debug without the service: `EvenKeelService.exe <root> <node.exe> [<data folder>] --console`.
- `service/install.ps1` and `service/uninstall.ps1` run from PowerShell 7 as administrator. The script does not ask for the account password: the user enters it on the "Log On" tab in services.msc, which also grants the "Log on as a service" right.

## Linux and macOS

- **Install.** `service/install.sh` as your own user (not via `sudo`): `npm install`, `npm run build`, then on Linux the unit `~/.config/systemd/user/even-keel.service` (`systemctl --user`, log — `journalctl --user -u even-keel`), on macOS the agent `~/Library/LaunchAgents/local.even-keel.plist` (`launchctl`, log — `logs/even-keel.log`, no rotation). Running it again rebuilds and restarts; `service/uninstall.sh` removes it. On macOS `install.sh` checks `launchctl print gui/<uid>` before the build and stops with a message when nobody is signed in to the desktop, instead of `Bootstrap failed: 125` at the end (BTN-735).
- **`PATH`** and the path to `node` are taken from the installer's shell: if `node` changed (nvm and the like), run `install.sh` again. Explicitly supplied `EVEN_KEEL_HOST`/`EVEN_KEEL_PORT` are saved into the unit or plist too, above `.env`.
- **The readiness check.** After starting the unit or bootstrapping the agent, `install.sh` runs `dist/src/service/install-check.js` for up to 60 s, at the address of `listenOf`/`localUrlOf` and the data folder's `.env`. It checks readiness at install time, not continued availability:
  - **passes** on a running service whose `/` gives a 2xx/3xx or an authorization answer (401/403);
  - **keeps waiting** on any other status, 503 included, and on a pending launchd PID or a systemd `activating` state;
  - **fails at once** on an unloaded agent or an inactive or failed unit;
  - **on a failure** — of the bootstrap, the restart or the readiness — prints the manager's state, launchd's PID and last exit code when available, and the last 40 log lines (the journal on Linux), then exits nonzero. A missing piece is marked unavailable; of launchd only selected fields are printed, never its environment. The installation stays registered, so the user can fix it and retry. On macOS the message points to System Settings → General → Login Items → Allow in the Background (the entry can be `node`).
- **Stop and sessions.** Stopping the service does not kill background sessions: the unit has `KillMode=process`, the agent `AbandonProcessGroup`, so the agent's daemon and the update process run on. systemd says so in the journal — `Unit process … (claude) remains running after unit stopped` and `Found left-over process … This usually indicates unclean termination`, one pair per process — the intended behaviour, not a failure (seen in the BTN-143 trial, Ubuntu 26.04, systemd 259). The MCP gateway's servers are not meant to survive: the service kills them itself on `SIGTERM` (BTN-720), since a left-over one keeps the tracker credentials of its start, and waits for each to exit before node does, `SIGKILL` after 5 s (BTN-723); a `huly-mcp` line in that pair means a bug.
- **Living without a login.** A `--user` unit lives while the user is logged in; `loginctl enable-linger <user>` keeps it without a login (the installer reminds you). The macOS agent lives in the desktop session's domain `gui/<uid>` and works only while the user is signed in to the desktop, at the screen or through Screen Sharing: an SSH login alone has no such domain. There is no fallback to the background domain `user/<uid>`: Claude Code keeps its sign-in in the login keychain, which only a desktop sign-in unlocks, so sessions started there would not be signed in (assumed, [unverified](../unverified/platforms.md#macos)). A Mac without a screen keeps its session through automatic login (System Settings → Users & Groups; needs FileVault off).
- **The update process** ([`updates.md`](updates.md#the-update-process)) stops and starts the unit with `systemctl --user stop|start <unit>`, the unit read from `/proc/self/cgroup` (`user@….service/…/<unit>.service`; a system unit gets no button), and the agent with `launchctl bootout gui/<uid>/<label>`, waiting until `launchctl print` no longer finds it, then `launchctl bootstrap gui/<uid> <plist>` after the same check of the domain as `install.sh` (`even-keel update` from SSH on a Mac nobody is signed in to says to sign in, not 125). The label is `XPC_SERVICE_NAME` of the service's environment, the plist `~/Library/LaunchAgents/<label>.plist`.
- **What was checked live.** Linux: a clone's install, the update button and a whole chain task, in WSL and on a server ([`verified/platforms.md`](../verified/platforms.md), [`verified/updating.md`](../verified/updating.md)). macOS, on a Mac: `install.sh`'s agent and its return after a reboot, the refusal with nobody signed in to the desktop, the npm package's agent and the update button under launchd (the same files); a launchd agent disappearing after installation on an Intel Mac is still [unverified](../unverified/platforms.md#a-launchd-agent-disappearing-after-installation-btn-878). GitHub's macOS runner goes through `install.sh` to `uninstall.sh` every night on `dev` and on pushes to `main` and `release/**` (`docs/ci/workflows.md`, "macOS").
- **Trust.** The CLI must know a new repository as trusted: otherwise the launch pauses and asks you to open `claude` in it once.

## Rebuild after a green push

A checkout that runs `dev` or a task branch gets no update button ([`updates.md`](updates.md#who-may)); it is rebuilt by a script, usually the last of the project's commands after a green push (`docs/ci.md`). The script builds the checkout it lives in and restarts the service, only when the checkout's HEAD is the commit it was given; a different HEAD skips the build.

- **The scripts.** `service/rebuild.ps1 -Commit <sha>` on Windows: with no service `EvenKeel` installed and a `Run` value `EvenKeel` there, it restarts node in the tray host instead (`--autostart`). `service/rebuild.sh <sha> [<state URL>]` on Linux and macOS, as the service user: it controls the systemd user unit `even-keel.service` or the launchd agent `local.even-keel`; the state URL defaults to loopback at `EVEN_KEEL_PORT` (4747 by default).
- **What they do.** Each compiles only the update process (`npx tsc -p tsconfig.updates.json`: `src/updates/run.ts` and what it imports, with `noCheck`, so a package the commit added and nobody installed yet fails nothing; BTN-1239), passes it the full SHA and hands it the rest: the steps, the wait for the chains and the rollback are in [`updates.md`](updates.md#rebuild-mode). Output goes to the caller and to `logs/update.log`.
- **As a command after a green push.** The guard of those commands has already made sure HEAD is the green commit, so the line passes HEAD, whether the chain pushed it or a `git sync` by hand did (BTN-707). Its output goes to a file, since the pipe to the service closes when the service stops:
  - Linux and macOS: `service/rebuild.sh "$(git rev-parse HEAD)" >>logs/rebuild.log 2>&1`;
  - Windows: `pwsh -NoProfile -Command "& ./service/rebuild.ps1 -Commit (git rev-parse HEAD) *> logs/rebuild.log"` — `pwsh` is the one process that outlives node's stop (`cmd.exe` running the line dies with it).
- **Over SSH**, for a CI that can reach the machine: both scripts take the commit from `SSH_ORIGINAL_COMMAND` too. The key's line in `authorized_keys` (on Windows, for an administrator, `C:\ProgramData\ssh\administrators_authorized_keys`) forces the script: `from="<runner host>",restrict,command="pwsh -NoProfile -NonInteractive -File <root>\service\rebuild.ps1" ssh-ed25519 …`.

## Docker

The release Dockerfile builds the tag's npm package on the builder architecture, then installs its tarball on the target architecture. The runtime is Debian, Node 26, Git with SSH, `tini` and the unprivileged `node` user. Volume paths and host commands are in the [Docker guide](../guide/docker.md); what it leaves to the code:

- **Compose** persists the home directory and requires the page token.
- **`stop_grace_period: 30s`** on every service of the Compose files, over the shutdown's own deadline `SHUTDOWN_MS` (15 s, `src/service/defaults.ts`): Docker's default 10 s would kill the process mid-shutdown. `src/service/compose.test.ts` holds each file above `SHUTDOWN_MS` (BTN-1442).
- **`0.0.0.0`.** The image listens on all interfaces even without Compose, so the normal `guardToken` check applies.
- **A host install does not move into a volume as is**: the database keeps host paths (project checkouts, account folders, worktrees), so the guide moves only the settings, by `config-export` and the first start's import of `even-keel.config.json`.
- **No update from the page**: [`updates.md`](updates.md#containers).

## An npm install (BTN-265)

The package `even-keel` (`docs/releases.md`, "Publishing to npm") is the built Even Keel: `dist/src`, `dist/tally`, `dist/web`, with the plugins, the status line and the service scripts next to them. Node does not strip types inside `node_modules`, so nothing there runs through tsx; whatever starts a module by its file (the Tally workers, the SDK executor) picks `.js` when its own file is `.js`.

- **Which install.** `src/locations.ts`: `root` is the folder with the nearest `package.json`, `source` is `git` when it has `src/main.ts`, otherwise `npm`. `home` — where `.env`, `state/` and `logs/` are — is `EVEN_KEEL_DATA`, else a checkout's own folder, else the data folder of the platform: `%LOCALAPPDATA%\even-keel`, `~/Library/Application Support/even-keel`, `$XDG_DATA_HOME/even-keel` (`~/.local/share/even-keel`). npm replaces the package's folder at every update, so nothing of the user's lives there. The variable is not `EVEN_KEEL_HOME`: the `tally` plugin finds the code by that one. `tally/bin/sql.mjs` finds the data the same way.
- **The command** `even-keel` (`src/cli.ts`, `bin` of `package.json`): none — run in the terminal; `install`/`uninstall` — `service/install.*`/`uninstall.*` of the package; `update [version]` — stop the service this package runs, `npm install --global --prefix <its prefix> even-keel@<version>`, start it, with no wait for the chains (the page's button waits).
  - With no version, `update` reads `npm view even-keel dist-tags --json` and takes `latest`, or for an installed prerelease the newer of `latest` and `next` (`updateTargetOf`, `src/cli-args.ts`): a release candidate from `npx even-keel@next` would otherwise go back to an older `latest` (BTN-746). When neither is newer than the installed version it says so and leaves the service alone.
  - Run from the npx cache (`_npx` in its path), with no command or `install`, it first installs its own version globally and runs `install` from there: the service and the plugins' paths need a folder npx will not clear.
- **The scripts** tell a package by the missing `src/main.ts`: no `npm install` or build; the log in `<data>/logs`; on Windows the host compiled into `<data>\service` (the package's folder is replaced on update) and registered with the data folder as its third argument; the unit and the agent run `node dist/src/main.js` with `EVEN_KEEL_DATA`. `install.ps1 -Data <dir>` and `EVEN_KEEL_DATA` choose another data folder; the service must run as the user whose data folder it is.

## A machine of a hub (BTN-1243)

The same installers put a machine of a hub (`docs/machines.md`) on a computer: `even-keel install --machine <string> [--root <folder>] [--service]`, the command the hub's `machines/invite` answers with as `command` (`npx even-keel@<hub's version> install --machine <string>`, `installCommandOf`, `src/cli-install.ts`). No OS is chosen: on Windows the start at sign-in by default, `--service` the service `EvenKeel` (refused elsewhere); on Linux and macOS `install.sh`. From the npx cache the options pass to the global copy (`installArgsOf`, `src/cli-args.ts`).

- **Refusals first**, before anything is installed (`prerequisiteRefusal`): Node older than 24 for any install, no git on `PATH` for a machine. `install.ps1` and `install.sh` check the same on their own, for a run from a checkout.
- **Join before the service.** The join is `even-keel join <string> [--root <folder>]` in a child process (it reads the data folder's `.env`, which must not reach the host's or the unit's environment): in `src/cli.ts` for the start at sign-in, in `install.sh --machine/--root` and `install.ps1 -Machine/-Projects` otherwise. In `install.ps1` the option `--root` is called `-Projects`: `-Root` would clash with the script's own `$root`. A refused join stops the install and leaves an installed service as it was (`install.ps1` starts a stopped one again). A second run with the same string finds it joined and installs the service again.
- **No page.** A checkout builds with `npm run build:machine` (the server's code and assets, no `web/`); a package carries `dist/web` anyway and the machine's process does not serve it.
- **Readiness.** `install-check.js … --machine` waits not for `/` but for the process to keep running 10 s in a row within the 60 s (a process without a kept token exits at once and the manager restarts it). Then the CLI waits up to 30 s for a `contactAt` in `state/machine-link.json` newer than the install's start (`waitForContact`) and says whether the hub was reached and where the log is.
- **The tray** of a machine reads `contactAt` from `machine-link.json` of the state folder (`EVEN_KEEL_STATE_DIR` over `.env`, else `state/` of the data folder) instead of `/api/tray`: green while the last contact is under 3 min old (the machine writes it at most once a minute), grey in the start's grace, red after; no "Open page" item.

Never checked live on another computer: [unverified](../unverified/machines.md#the-machine-installer-on-windows-linux-and-macos-btn-1243).
