# What has not been verified: Platforms

One area of [What has not been verified](../unverified.md), which says what an entry is, how to report a run into one and where a new one goes. What has been checked in this area is in [What has been verified: Platforms](../verified/platforms.md).

## macOS

Run live on a rented Mac (BTN-312, Apple M2, macOS 27.2, 2026-11-03, [verified](../verified/platforms.md)): the launchd agent of `install.sh` and of the npm package, its start after a reboot, the CLI and its folders, whole chain tasks; and, since BTN-735, the stop with a message to sign in to the desktop when nobody is signed in there (SSH only), instead of a bare `Bootstrap failed: 125`. `.github/workflows/macos.yml` (BTN-730) runs the tests and a smoke of the agent on GitHub's `macos-latest` at every push of `dev`, `main` and `release/**` ([`ci.md`](../ci.md#macos)).

Not run: a fallback to the background domain `user/<uid>` — there is none, on the assumption that sessions there would not reach Claude Code's sign-in in the login keychain, which only a desktop sign-in unlocks (over SSH that keychain was seen locked); Intel Macs and macOS versions before 27. **Workaround:** sign in to the desktop of the user, at the screen or through Screen Sharing, before `install.sh`; a Mac without a screen keeps its session through automatic login (System Settings → Users & Groups, needs FileVault off).

## A launchd agent disappearing after installation (BTN-878)

Observed on 2026-11-08 on an Intel MacBook Air, macOS 15, npm 0.3.0-rc.1: installation said the agent started, the log reached `listening`, then HTTP stopped answering and `launchctl print gui/<uid>/local.even-keel` could no longer find the agent. There were no repeated starts despite `KeepAlive`. After a reboot and installing Git it worked; neither change is established as the fix. Intel Macs remain unverified: README's checked Mac is Apple silicon.

Unconfirmed explanations: Background Task Management on macOS 13+ unloading/disabling a new background item (possibly shown as `node`); the first `/usr/bin/git` call opening the Command Line Tools install prompt; resource pressure while the database took 16.6 s to open and Command Line Tools downloaded, followed by a machine hang. There is no evidence choosing between them.

The installer now checks launchd registration, PID and HTTP for up to 60 s, and on failure reports state, last exit code and the log tail with advice about Login Items. Linux uses `systemctl --user is-active` and the journal. Signals and fatal JavaScript errors are logged before shutdown/exit. Automated tests cover waiting, disappearance, HTTP failures, manager output and fatal Node exits on Windows. Not checked live: this installer revision on macOS or Linux, a slow Intel first start, toggling Allow in the Background, missing Command Line Tools, or a real disappearing agent. A readiness check cannot catch an agent unloaded later; a forced kill or native/machine crash can leave no stop line.

**If it is wrong:** installation may still fail or the agent may disappear after it reported success. Keep the installer's diagnostics, `logs/even-keel.log`, `launchctl print gui/$(id -u)/local.even-keel` and the Background Items setting; check System Settings → General → Login Items → Allow in the Background, sign in to the desktop, install Git/Command Line Tools if missing and retry. For Linux keep `systemctl --user status even-keel` and `journalctl --user -u even-keel`.

## npm's global folder owned by root (BTN-876)

On a Mac with Node from the nodejs.org installer (2026-11-08) `npx even-keel` failed with npm's `EACCES` on `/usr/local/lib/node_modules`, and moving npm's prefix into the home ([setup](../guide/setup.md#npms-global-folder-on-macos-and-linux)) got it installed. Since then `npx even-keel` on macOS and Linux checks, before `npm install --global`, that it may write npm's global `node_modules` and the `bin` next to it (or their nearest existing parents), refuses to run as root, and prints the same commands after an `EACCES` of npm the check missed. Only the unit tests of `src/npm-access.ts` ran, on Windows.

Not run: any of this on a Mac or Linux with a root-owned prefix — the check catching the folder before npm starts, the text in zsh and bash, the refusal under `sudo`, and npm's output still shown live now that its stderr goes through Even Keel. **If it is wrong:** npm fails with `EACCES` and no advice, or the check stops a prefix npm could write; run the commands of the setup guide by hand, or `npm install --global even-keel` and `even-keel install`.

## The start at sign-in on Windows (BTN-372)

Checked live on Windows (2026-10-24) with a stand-in for Even Keel (a `dist/src/main.js` answering `/api/state` on another port), the host started from a process in session 0, as a session of the service is: `EvenKeel.exe --start` with no host started one and returned at once; `--stop` stopped node and the host kept it stopped, `--start` brought it back; a killed node came back after 5 s; `--quit` ended the host and node; `--stop` and `--quit` with no host are no error. Node inside the host found its launcher (`serviceControl` gave the `autostart` control with the host's exe and arguments). `installAutostart` wrote the `Run` value and `registeredAutostart` read it back, a second install over a running host ended it, compiled and started again, and `uninstallAutostart` removed the value, the exe and its empty folder.

Not checked: the tray on a desktop — the icon, its dot and tooltip, the menu, a double click — since the check ran in session 0; Windows starting the `Run` value at a sign-in, and signing out stopping it; `npx even-keel` from a package (verdaccio, as for npm above) and the page's **Update** and **Revert** under the host; `rebuild.ps1` over SSH reaching the host through the `Global\EvenKeel.*` events from another Windows session; Windows finishing an update with "Use my sign-in info to automatically finish setting up after an update" and Even Keel starting after it.

If it is wrong: there is no icon or no start at sign-in — run `even-keel` in a terminal, or `EvenKeel.exe <root> <node.exe> [<data folder>] --start` from the data folder's `service` (the `Run` value in `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` has the whole line); an update left Even Keel stopped — `EvenKeel.exe … --start` or **Restart** in the tray, and `logs/update.log` says which step failed; `install` or `uninstall` stops with "`EvenKeel.exe` is still in use" — quit Even Keel from its tray icon (or end `EvenKeel.exe` in Task Manager) and run the command again. The log of the host and node is `logs/even-keel.log`.

## The state database's vacuum in the running service (BTN-952)

Measured on a copy of the live database (2026-11-10, [verified](../verified/platforms.md)): `VACUUM FULL` with `ANALYZE` about a second, a plain `VACUUM` of the compacted database 42 ms; the tests cover that a rewritten table reuses its dead rows after a vacuum and shrinks after the compaction. Assumed: at the service's own start the compaction takes the same second on the live folder, and the hourly `VACUUM` between the service's writes and Tally's reads through the port stays in tens of milliseconds and keeps `chain_lists` and `session_windows` from growing over weeks.

Not checked: the start of the real service with it (the `storage: the database was compacted in N ms` line and the `start:` summary's `storage` time), the sizes of the tables after a week of chains, an hourly vacuum landing in a busy poll.

If it is wrong: the start is slower by more than a second, or the page stalls once an hour — `logs/even-keel.log` has the compaction's time and any `storage: the vacuum failed` line; a failed vacuum changes nothing else, the tables only keep growing as before BTN-952 (`docs/storage.md`, "Vacuum").

## The automatic copies of the state database (BTN-1083)

The tests write, check and rotate copies of real PGlite databases with attachments, and refuse a copy whose rows or files differ; the worker thread was run once under `tsx` on a test database and wrote a checked copy. Assumed: in the running service the thread is found in the built `dist/src/storage/`, reading the rows of the live database for the copy does not hold the page noticeably, the copy of a large `files/` and its trial restore end within minutes, and at a real update the copy before the schema steps is made on the old schema without delaying the start by more than its own time.

Not checked: the daily copy in the installed service (the `storage: the backup … is checked` line, `backups/` in the state folder, "Backups" in Shared settings), a folder on another disk or one that cannot be written (the banner, the retry an hour later), the copy before schema steps at a real update, and a restore from an automatic copy.

If it is wrong: no copy appears, the banner says the copy failed, or the start after an update is slower — `logs/even-keel.log` has the `storage: the backup` and `storage: the copy before the schema steps` lines with the failing stage; nothing else depends on the copies, so turn to `npm run storage -- backup <folder>` by hand (`docs/storage.md`, "Backup, export, rollback").
