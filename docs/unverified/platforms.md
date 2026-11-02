# What has not been verified: Platforms

One area of [What has not been verified](../unverified.md), which says what an entry is, how to report a run into one and where a new one goes. What has been checked in this area is in [What has been verified: Platforms](../verified/platforms.md).

## macOS

`service/install.sh` installs a launchd agent there, but Even Keel has never run on a Mac: neither the agent nor finding the CLI and its folders.

Since BTN-730 `.github/workflows/macos.yml` runs the unit tests, the e2e scenarios and a smoke of the agent (install, `launchctl list`, `/api/state`, uninstall) on GitHub's `macos-latest` at every push of `dev`, `main` and `release/**` ([`ci.md`](../ci.md#macos)); its first runs are not read yet. What they confirm goes to [the verified log](../verified/platforms.md) and is struck from here; a session on a real Mac — the CLI, its folders, a chain — stays BTN-312.

## The start at sign-in on Windows (BTN-372)

Checked live on Windows (2026-10-24) with a stand-in for Even Keel (a `dist/src/main.js` answering `/api/state` on another port), the host started from a process in session 0, as a session of the service is: `EvenKeel.exe --start` with no host started one and returned at once; `--stop` stopped node and the host kept it stopped, `--start` brought it back; a killed node came back after 5 s; `--quit` ended the host and node; `--stop` and `--quit` with no host are no error. Node inside the host found its launcher (`serviceControl` gave the `autostart` control with the host's exe and arguments). `installAutostart` wrote the `Run` value and `registeredAutostart` read it back, a second install over a running host ended it, compiled and started again, and `uninstallAutostart` removed the value, the exe and its empty folder.

Not checked: the tray on a desktop — the icon, its dot and tooltip, the menu, a double click — since the check ran in session 0; Windows starting the `Run` value at a sign-in, and signing out stopping it; `npx even-keel` from a package (verdaccio, as for npm above) and the page's **Update** and **Revert** under the host; `rebuild.ps1` over SSH reaching the host through the `Global\EvenKeel.*` events from another Windows session; Windows finishing an update with "Use my sign-in info to automatically finish setting up after an update" and Even Keel starting after it.

If it is wrong: there is no icon or no start at sign-in — run `even-keel` in a terminal, or `EvenKeel.exe <root> <node.exe> [<data folder>] --start` from the data folder's `service` (the `Run` value in `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` has the whole line); an update left Even Keel stopped — `EvenKeel.exe … --start` or **Restart** in the tray, and `logs/update.log` says which step failed. The log of the host and node is `logs/even-keel.log`.
