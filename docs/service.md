# Service

Reference for sessions: installing and running the service on different systems. Without the service, on any system: `npm install`, `npm run build`, `npm start` in the repository root.

The Tally stats collector runs inside the service (every 5 minutes, in its own thread), so no separate scheduler or cron task is needed.

## Windows

- The service host is `service/EvenKeelService.cs`, compiled during installation by the stock `csc.exe` from .NET Framework; there are no third-party wrappers. It keeps `node --import tsx src/main.ts` running in the repository root, restarts it on a crash and writes the output to `logs/even-keel.log`. To debug without the service: `EvenKeelService.exe <root> <node.exe> --console`.
- `service/install.ps1` and `service/uninstall.ps1` — from PowerShell 7 as administrator. The script does not ask for the account password: the user enters it on the "Log On" tab in services.msc, which also grants the "Log on as a service" right.
- The service reads `.env` and `even-keel.config.json` from the repository root; the port must not be occupied by a manual run.
- The service serves the built `dist/web`: `install.ps1` runs `npm run build`. After a code update, run `install.ps1` again (or `npm run build` and restart the service), otherwise the page is stale or returns 503.
- Stopping the service does not kill background sessions — they are children of the `claude daemon run` daemon.

## Linux and macOS

- `service/install.sh` as your own user (not via `sudo`): `npm install`, `npm run build`, then on Linux the unit `~/.config/systemd/user/even-keel.service` (`systemctl --user`, log — `journalctl --user -u even-keel`), on macOS the agent `~/Library/LaunchAgents/local.even-keel.plist` (`launchctl`, log — `logs/even-keel.log`, no rotation). Running it again rebuilds and restarts. `service/uninstall.sh` removes it.
- `PATH` and the path to `node` are taken from the installer's shell: if `node` changed (nvm and the like), run `install.sh` again.
- Stopping the service does not kill background sessions: `KillMode=process` in the unit, `AbandonProcessGroup` in the agent. A `--user` unit lives while the user is logged in; to keep it running without a login, use `loginctl enable-linger <user>` (the installer reminds you). The macOS agent works only while logged in.
- Linux was verified live in WSL (Ubuntu 26.04, 2026-10-04): tests and type check, `install.sh` and `uninstall.sh`, signing in to `claude` from the page, `/usage` limits, starting a session in a task worktree, and after Done — stopping the session, cleaning up the worktree and branch, its own `main` sync with a push to origin. The CLI must know a new repository as trusted: otherwise the launch pauses and asks you to open `claude` in it once. macOS was not verified.
