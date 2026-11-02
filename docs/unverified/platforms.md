# What has not been verified: Platforms

One area of [What has not been verified](../unverified.md), which says what an entry is, how to report a run into one and where a new one goes. What has been checked in this area is in [What has been verified: Platforms](../verified/platforms.md).

## macOS

`service/install.sh` installs a launchd agent there, but Even Keel has never run on a Mac: neither the agent nor finding the CLI and its folders.

## Huly on Node.js 25 and newer

Node 25 and newer have the browser's `sessionStorage` and `localStorage`, and the Huly client takes them for a browser: its connect reached for `window`, failed, and a timer it left threw outside any promise, ending the whole process — a tester on Node 26.13 lost Even Keel on the Huly profile's check (2026-11-01). `hideWebStorage` (`src/huly/client.ts`) hides both before the client loads. Checked on Node 24.14 only: with a stand-in `sessionStorage` the profile's check against a real Huly reproduced that crash before the fix and passed after it, and so did `--experimental-webstorage` with a storage file. Not checked: Node 25 or 26 itself — the profile's check, a chain on Huly and Tally's Huly step there.

If it is wrong: Even Keel ends with `Cannot access 'clientConnection' before initialization` in the log on the first Huly call. Install Node.js 24 LTS, then `npm install` and `npm run build` again.

## The start at sign-in on Windows (BTN-372)

Checked live on Windows (2026-10-24) with a stand-in for Even Keel (a `dist/src/main.js` answering `/api/state` on another port), the host started from a process in session 0, as a session of the service is: `EvenKeel.exe --start` with no host started one and returned at once; `--stop` stopped node and the host kept it stopped, `--start` brought it back; a killed node came back after 5 s; `--quit` ended the host and node; `--stop` and `--quit` with no host are no error. Node inside the host found its launcher (`serviceControl` gave the `autostart` control with the host's exe and arguments). `installAutostart` wrote the `Run` value and `registeredAutostart` read it back, a second install over a running host ended it, compiled and started again, and `uninstallAutostart` removed the value, the exe and its empty folder.

Not checked: the tray on a desktop — the icon, its dot and tooltip, the menu, a double click — since the check ran in session 0; Windows starting the `Run` value at a sign-in, and signing out stopping it; `npx even-keel` from a package (verdaccio, as for npm above) and the page's **Update** and **Revert** under the host; `rebuild.ps1` over SSH reaching the host through the `Global\EvenKeel.*` events from another Windows session; Windows finishing an update with "Use my sign-in info to automatically finish setting up after an update" and Even Keel starting after it.

If it is wrong: there is no icon or no start at sign-in — run `even-keel` in a terminal, or `EvenKeel.exe <root> <node.exe> [<data folder>] --start` from the data folder's `service` (the `Run` value in `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` has the whole line); an update left Even Keel stopped — `EvenKeel.exe … --start` or **Restart** in the tray, and `logs/update.log` says which step failed. The log of the host and node is `logs/even-keel.log`.
