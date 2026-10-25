# What has not been verified

Even Keel is checked live on the author's machine with the author's accounts. Some behaviour could not be checked there: the situation never came up, or there was no way to create it. This page lists it, so you know where Even Keel works on an assumption. Each entry says what is assumed, what happens if the assumption is wrong and what to do about it.

If you run into one of these, please open an issue with what you saw: it is the only way the entry gets checked.

## What to check first

Every entry, ordered by how many people it reaches and how badly it hurts them if the assumption is wrong: the lower the number, the sooner it should be checked and the more a run into it costs. Each row links to the entry.

| # | Entry | Who it hits | If the assumption is wrong |
| ---: | --- | --- | --- |
| 1 | [An early reset of a limit](#an-early-reset-of-a-limit) | everyone on a subscription | the chain waits hours for a reset that already came |
| 2 | [Staying signed in after a reboot](#staying-signed-in-after-a-reboot-ekr-15) | everyone on a subscription | accounts ask to sign in again after a reboot |
| 3 | [Installing and updating with npm](#installing-and-updating-with-npm-btn-265) | npm installs on Linux and macOS; the first publish | the service of a package does not start; install from a clone |
| 3a | [The start at sign-in on Windows](#the-start-at-sign-in-on-windows-btn-372) | every Windows install | no icon, no start after a sign-in, or an update that leaves Even Keel stopped |
| 4 | [macOS](#macos) | macOS | the service or the CLI lookup may not work at all |
| 5 | [Codex chains beyond short tasks](#codex-chains-beyond-short-tasks) | Codex | sessions cannot run commands, or run with no sandbox |
| 6 | [Errors and limits in the rollout](#errors-and-limits-in-the-rollout) | Codex | a limit looks like a finished turn, the task waits for you |
| 7 | [Plugin hooks that block](#plugin-hooks-that-block-btn-180) | Codex | a merge goes in before the project's check |
| 8 | [Chain sessions on the checked CLI](#chain-sessions-on-the-checked-cli-btn-250) | everyone | sessions run on an unchecked CLI version |
| 9 | [The wizard's trust check](#the-wizards-trust-check) | new users | a pause at the first launch |
| 10 | [A Codex chain session reaching its own compaction](#a-codex-chain-session-reaching-its-own-compaction) | Codex users | a session compacts before the hook asks for a handoff |
| 11 | [Chat mail in a real session](#chat-mail-in-a-real-session-btn-181) | everyone writing to a session about to hand off | the handoff waits a turn longer |
| 12 | [Background commands of a stopped session on Linux and macOS](#background-commands-of-a-stopped-session-on-linux-and-macos-btn-202) | Linux, macOS | a worktree is left behind after Done |
| 13 | [Packages on Linux and macOS](#packages-on-linux-and-macos) | Linux, macOS with packages | the chain waits on a package that does not start |
| 14 | [The update button on the page](#the-update-button-on-the-page-btn-163) | macOS updating from the page | the service stays stopped after an update; start it by hand |
| 15 | [Stopping a turn on macOS and Linux](#stopping-a-turn-on-macos-and-linux) | Codex on Linux, macOS | a stopped Codex turn goes on |
| 16 | [PR mode on Forgejo](#pr-mode-on-forgejo-btn-205) | PR mode on Forgejo | feedback does not reach the session; a task waits out of the chain |
| 17 | [A task back from Backlog after a question in a comment](#a-task-back-from-backlog-after-a-question-in-a-comment-btn-245) | unattended mode | the answered task waits instead of going on |
| 18 | [A resume that starts a copy](#a-resume-that-starts-a-copy) | everyone, rarely | "Session booting" for 5 minutes after an answer |
| 20 | [Sessions through the Agent SDK](#sessions-through-the-agent-sdk-btn-239) | Claude API keys, subscriptions that turn it on | over a long run a session hangs where `--bg` would not, or a resume loses its Remote Control chat |
| 21 | [An API key out of credit](#an-api-key-out-of-credit-btn-165) | Claude API keys | the chain stops instead of waiting for a top-up, or waits forever |
| 22 | [Codex on an OpenAI API key](#codex-on-an-openai-api-key-btn-177) | Codex API keys | a session stops on an empty key, or the chain waits forever |
| 23 | [A key refused after it was added](#a-key-refused-after-it-was-added) | Claude API keys of a disabled organization | the key looks fine until a session fails |
| 24 | [A command after a green main that restarts Even Keel on Linux and macOS](#a-command-after-a-green-main-that-restarts-even-keel-on-linux-and-macos) | a restart in `commands.afterGreen` on Linux, macOS | the service stays stopped |
| 25 | [When a CI run counts as stuck](#when-a-ci-run-counts-as-stuck) | CI with a slow runner queue | a run is called stuck too early |
| 26 | [Chains of several projects on one remote](#chains-of-several-projects-on-one-remote-btn-210) | several projects on one remote | a project waits on another's fix that is over |
| 27 | [A package server and a Codex server of the same name](#a-package-server-and-a-codex-server-of-the-same-name) | Codex with packages | a session gets the wrong server of a name |
| 28 | [Sign-in from the page](#sign-in-from-the-page) | Codex accounts added from the page | a second free account is added and only held afterwards |
| 29 | [A crashed turn and a service restart mid-turn](#a-crashed-turn-and-a-service-restart-mid-turn) | Codex | a dead session looks busy |
| 30 | [Chain sessions in the Codex app and on the phone](#chain-sessions-in-the-codex-app-and-on-the-phone-btn-178) | Codex | two turns on one thread if you answer on the phone |
| 31 | [Chat mail at a Codex Stop](#chat-mail-at-a-codex-stop-btn-181) | Codex | a message sent at the end of a turn is lost |
| 32 | [The handoff note of a Codex turn seen by the Stop hook](#the-handoff-note-of-a-codex-turn-seen-by-the-stop-hook) | Codex | a note without the `CHECKPOINT:` line waits for a reply |
| 33 | [The chat's turn line on Codex and after the chain stopped](#the-chats-turn-line-while-an-answer-is-delivered-to-codex-or-after-the-chain-stopped-btn-188) | Codex, a stopped chain | the chat says "delivering" for up to three minutes |
| 34 | [Plugins from a git URL marketplace](#plugins-from-a-git-url-marketplace) | a marketplace added by URL | sessions keep an old plugin |
| 36 | ["Add to Claude Code" on /tools](#add-to-claude-code-on-tools-btn-226) | new users running the service | the banner stays; run its command by hand |
| 37 | [Two profiles of one tracker](#two-profiles-of-one-tracker-btn-200) | two GitHub profiles | a project's CI reads with another profile's token |
| 38 | [A project's own CI profile](#a-projects-own-ci-profile-btn-231) | two forge profiles | a pull request uses the old profile |
| 39a | [A conflict resolved by an agent](#a-conflict-resolved-by-an-agent-btn-369) | release projects with a conflict | the carry row stays open after the merge; skip it |
| 39b | [A conflict given to the agent by itself](#a-conflict-given-to-the-agent-by-itself-btn-370) | release projects with the switch on or unattended | a conflict gets no session, or several; press the button instead |
| 40 | [Several projects on one tracker project](#several-projects-on-one-tracker-project-btn-172-btn-73) | two projects on one Huly project or Linear team | a task in both chains, or in neither |
| 41 | [Task feeds from another tracker](#task-feeds-from-another-tracker-btn-66) | task feeds from a second Huly workspace or in PR mode | a feed's session cannot read its task, or its pull request is not closed in the feed's tracker |
| 44 | [The context window a chain session gets](#the-context-window-a-chain-session-gets-btn-187) | everyone | the context meter and the handoff cap read a wrong window |
| 45 | [A task closed by `NO CHANGES:`](#a-task-closed-by-no-changes-ekr-10) | everyone outside PR mode | a task with nothing to merge waits for you, as before the mark |
| 45a | [Project standards on each agent](#project-standards-on-each-agent-btn-359) | projects with standards on Codex, Copilot, OpenCode | a guarded file is edited before its document; the merge still waits for its check |
| 46 | [A session waiting on you behind a monitor](#a-session-waiting-on-you-behind-a-monitor) | everyone, rarely | a session waiting for its own build shows "waiting"; a reply or unattended mode cuts the build short |
| 49 | [Milestones on Linear](#milestones-on-linear) | Linear | a task's milestone is not filled |
| 50 | [Changing a milestone from the task card on Linear](#changing-a-milestone-from-the-task-card-on-linear) | Linear | the card puts the old milestone back |
| 51 | [The tasks of a milestone on Linear](#the-tasks-of-a-milestone-on-linear-btn-142) | changelog drafts on Linear | the draft takes an older comment |
| 52 | [GitHub attachments of a private repository](#github-attachments-of-a-private-repository) | private GitHub repositories | the page cannot open an attached file |
| 53 | [A removed key and the global folder's daemon](#a-removed-key-and-the-global-folders-daemon) | anyone removing a key | the removed key stays with the folder's sessions until its daemon exits |
| 54 | [The Codex changelog turn with JSON output](#the-codex-changelog-turn-with-json-output) | changelog drafts on Codex | the draft fails, or shows 0 tokens |
| 55 | [OpenCode chain sessions under the service](#opencode-chain-sessions-under-the-service-btn-214) | OpenCode | sessions do not start, or a whole task runs on a wrong assumption |
| 56 | [A spent limit on OpenCode](#a-spent-limit-on-opencode) | OpenCode | the session stops on the error instead of waiting for the reset; on Zen, retries too early or too late |
| 57 | [A hung OpenCode turn](#a-hung-opencode-turn) | OpenCode | a hang the watchdog misses stays busy, or a long build is taken for hung |
| 58 | [OpenCode sign-in from the page](#opencode-sign-in-from-the-page) | OpenCode with ChatGPT or Copilot | no link in the window; sign in in a terminal |
| 59 | [Plugins in a Codex folder on Linux and macOS](#plugins-in-a-codex-folder-on-linux-and-macos) | Codex on Linux, macOS | a few seconds per first turn |
| 60 | [Edit sizes of a FileChange](#edit-sizes-of-a-filechange-btn-185) | Codex | the chat shows an edit without its size |
| 61 | [Codex stats](#codex-stats-btn-170) | Codex | a response counted twice in `/stats` |
| 62 | [Codex compactions on the chain's row](#codex-compactions-on-the-chains-row-btn-299) | Codex | the row's resets counter misses a compaction or counts it twice |
| 63 | [Fast mode in statistics](#fast-mode-in-statistics) | fast mode | `/stats` understates its cost |
| 66 | [The PR mode switch of the settings panel](#the-pr-mode-switch-of-the-settings-panel-ekr-7) | PR mode | the page refuses the switch; turn it on in the config |
| 66a | [A chain that ended starting again on feedback](#a-chain-that-ended-starting-again-on-feedback-btn-375) | PR mode | feedback waits for **Start**, as before |
| 67 | [The OpenCode database read while a turn writes](#the-opencode-database-read-while-a-turn-writes) | OpenCode | the feed or a stats run skips one poll |
| 69 | [Copilot chain sessions under the service](#copilot-chain-sessions-under-the-service-btn-215) | Copilot | sessions do not start without a token |
| 70 | [Hooks and plugins in Copilot sessions](#hooks-and-plugins-in-copilot-sessions) | Copilot | no handoff on a full context, chat messages only between turns |
| 71 | [MCP servers in Copilot sessions](#mcp-servers-in-copilot-sessions) | Copilot with packages | a session lacks the tracker's tools |
| 72 | [A spent Copilot budget](#a-spent-copilot-budget) | Copilot | the session stops on the error, or waits for good on the machine's sign-in; press "New session" |
| 73 | [A Copilot turn killed mid-turn](#a-copilot-turn-killed-mid-turn) | Copilot | the resume fails; press "New session" |
| 74 | [Copilot installed with npm](#copilot-installed-with-npm) | Copilot from npm | the first turn fails; set `EVEN_KEEL_COPILOT_BIN` |
| 75 | [Copilot models in the stats](#copilot-models-in-the-stats) | Copilot on Claude models | `/stats` shows no cost for them |
| 76 | [GitHub issues taken into the tracker](#github-issues-taken-into-the-tracker-btn-262) | projects with `intakeLabel` | an issue is not taken in, or stays open after its release; close it by hand |
| 77 | [A tool approval in an SDK session](#a-tool-approval-in-an-sdk-session-btn-303) | Agent SDK sessions out of unattended mode | an allowed call fails, or the chain waits on an approval after unattended mode goes on |
| 78 | [A permission dialog answered from the page](#a-permission-dialog-answered-from-the-page-btn-269) | Claude `--bg` sessions that stop on a permission dialog | the session keeps waiting after the answer; answer through Remote Control |
| 79 | [Your own skills as a package](#your-own-skills-as-a-package-btn-339) | Codex, OpenCode, Copilot with "My skills" | a session lacks your skills, or a Codex session fails on the plugin's install |
| 79 | [The OpenCode model check](#the-opencode-model-check-btn-336) | OpenCode on ChatGPT, Copilot or an API key | a model that works is refused at launch; leave the model field empty |
| 80 | [OpenCode's ChatGPT and Copilot limits](#opencodes-chatgpt-and-copilot-limits-btn-341) | OpenCode on ChatGPT or Copilot | the card has no bars and a limit waits with no reset time, as before |
| 81 | [A Copilot token's monthly allowance](#a-copilot-tokens-monthly-allowance-btn-341) | Copilot with a token | the card counts nothing, or only what was spent |
| 82 | [A lone AGENTS.md in a resumed or SDK Claude session](#a-lone-agentsmd-in-a-resumed-or-sdk-claude-session-btn-340) | Claude on a project with an `AGENTS.md` and no `CLAUDE.md` | the session works without the project's rules; add a `CLAUDE.md` with `@AGENTS.md` |

## Platforms

### macOS

`service/install.sh` installs a launchd agent there, but Even Keel has never run on a Mac: neither the agent nor finding the CLI and its folders.

### The start at sign-in on Windows (BTN-372)

Checked live on Windows (2026-10-24) with a stand-in for Even Keel (a `dist/src/main.js` answering `/api/state` on another port), the host started from a process in session 0, as a session of the service is: `EvenKeel.exe --start` with no host started one and returned at once; `--stop` stopped node and the host kept it stopped, `--start` brought it back; a killed node came back after 5 s; `--quit` ended the host and node; `--stop` and `--quit` with no host are no error. Node inside the host found its launcher (`serviceControl` gave the `autostart` control with the host's exe and arguments). `installAutostart` wrote the `Run` value and `registeredAutostart` read it back, a second install over a running host ended it, compiled and started again, and `uninstallAutostart` removed the value, the exe and its empty folder.

Not checked: the tray on a desktop — the icon, its dot and tooltip, the menu, a double click — since the check ran in session 0; Windows starting the `Run` value at a sign-in, and signing out stopping it; `npx even-keel` from a package (verdaccio, as for npm above) and the page's **Update** and **Revert** under the host; `rebuild.ps1` over SSH reaching the host through the `Global\EvenKeel.*` events from another Windows session; Windows finishing an update with "Use my sign-in info to automatically finish setting up after an update" and Even Keel starting after it.

If it is wrong: there is no icon or no start at sign-in — run `even-keel` in a terminal, or `EvenKeel.exe <root> <node.exe> [<data folder>] --start` from the data folder's `service` (the `Run` value in `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` has the whole line); an update left Even Keel stopped — `EvenKeel.exe … --start` or **Restart** in the tray, and `logs/update.log` says which step failed. The log of the host and node is `logs/even-keel.log`.

## Updating

### The update button on the page (BTN-163)

Checked live on Linux (BTN-272, 2026-10-22): a real Even Keel under its systemd user unit (`install.sh`, Ubuntu 26.04 in WSL), the button pressed through the page's API, updating to the latest GitHub release with the tag served by a local origin. An update whose build failed and one whose service never answered were both rolled back to the commit they started from, an update that went through offered "Revert", and the revert went through; the process outlived the stop of the unit each time, and the page showed every outcome (`docs/service.md`, "Updating from the page"). On Windows the CI's rebuilds by `service/rebuild.ps1` (2026-10-22, three times) stopped and started the real service `EvenKeel` from the update process and waited for the chains, without new dependencies.

Checked live on Windows (BTN-287, 2026-10-22): the same targets in Windows Sandbox, the service `EvenKeel` installed by `install.ps1` under a local user that is not an administrator, the button pressed through the page's API. The update process the service started outlived `Stop-Service` every time, the service's own account stopped and started it (the right `install.ps1` grants), and `npm ci` ran with the service stopped without EPERM. A failed build and a service that never answered (120 s) were rolled back, an update that went through offered "Revert" and the revert went through, an update to a release with a new dependency installed it, and `rebuild.ps1` on a commit with one more dependency ran `npm install` with the service stopped and brought it back. "Update" pressed while a chain launched a Codex task (a 90 s `beforeStart`) waited 84 s in "waiting for" the project until the session had its id, and only then stopped the service; the session's first turn ended while the service was down, and the new service read it and closed the task.

Not checked: a launchd agent — the stop is `launchctl bootout`, which may also end processes of the agent's group despite `AbandonProcessGroup`, and then the update stops halfway with the service down; a revert release (`### Reverted` in its notes) shown on the page, since GitHub has none yet.

If it is wrong: the page stays on "updating…" and the service does not come back. Start it by hand (`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.even-keel.plist`), see `logs/update.log`, and if the checkout is on the new tag but the build failed, finish by hand: `npm ci`, `npm run build`, start.

### Installing and updating with npm (BTN-265)

Checked live on Windows (2026-10-22), before the first publish: `npm pack` of the package (about 1 MB, `dist/src`, `dist/tally`, `dist/web`, the service scripts), its global install into a separate prefix, `even-keel --help` with the data folder, Even Keel run in the foreground from `dist` with its state in the data folder (the page's API answered, the Tally worker from `dist/tally/src` collected), and `even-keel update` to a missing version: npm failed and the service of a clone stayed untouched.

Checked live on Windows (2026-10-23) in Windows Sandbox, with a local registry (verdaccio) standing in for npmjs and the packages built from `dev`: `npx --yes even-keel` installed its version globally and ran `install.ps1` from there — the host in `<data folder>\service`, the data folder as its third argument — and, once the Log On password was set, the service started in session 0 with its state and logs in `%LOCALAPPDATA%\even-keel`. The update button ran `npm install --global` with the service stopped (about a minute) and the service answered with the new version; a version whose service threw at start was rolled back by `npm install --global` of the old one; "Revert" went through. `even-keel update` with the service installed went to the latest version, and to a missing one npm failed (`ETARGET`) and the service started again on the version it had. `tally/bin/sql.mjs` of the global package, run from another folder, found the service's database. `even-keel uninstall` removed the service and its host and left the package and the data folder. npm 11 warns that two dependencies' install scripts (`msgpackr-extract`, `core-js`) are not allowed and skips them; Even Keel runs without them.

Not checked: `npx even-keel` from npmjs itself (the package was not published yet); `install.sh` run from a package — the systemd unit and the launchd agent with `EVEN_KEEL_DATA`; `.github/workflows/publish.yml` with trusted publishing.

If it is wrong: `npx even-keel` fails or the service does not start. Install from a clone (the README's quick start, the second way), or install the package by hand — `npm install --global even-keel@<version>`, then `even-keel` in a terminal; a failed update is put back by `npm install --global even-keel@<old version>`. The service's log is in `logs/` of the data folder (`even-keel --help` names it).

### Plugins from a git URL marketplace

A marketplace added from a local path is read from its folder, so an update of the code reaches the plugins by itself; that was checked. One added from a git URL (`owner/repo`, `https://…`) keeps a copy by version, and README tells you to run `claude plugin marketplace update even-keel` and `claude plugin update <plugin>@even-keel` in each project. The commands were run, but a copy that is actually behind was never brought up to date with them. If sessions still run the old plugin, `claude plugin uninstall … --scope project` and `claude plugin install … --scope project` in the project install the current one.

## The page

### The wizard's trust check

It counts a folder trusted when the global `~/.claude.json` or the `.claude.json` of the shared Claude account's folder trusts it: `claude` started with an account folder's `CLAUDE_CONFIG_DIR` records the accepted dialog in that folder's file only (seen live on 22.10.2026, BTN-300). It does not check Codex's trust at all. The warning does not hold the add: if you trusted the folder under the account the chain runs on, add it anyway. Not seen: a folder that passes the check but is not trusted for the chain's account, pausing the chain at its first launch. The second command, for a terminal of another user than the service's (BTN-310: `runas /user:<user> "cmd /k cd /d <folder> && claude"` on Windows, `sudo -u <user> -H claude` elsewhere), was never run: assumed, `runas` asks for that user's password and opens a console in its profile, so the trust lands in that user's `~/.claude.json`; a service on a built-in account (LocalSystem, a user without a password) cannot be reached this way, and a folder path with `&` or `%` breaks the `cmd` line. **Workaround:** if it does, sign in to the machine as the service's user, or open `claude` in the folder from any shell of that user, and accept the dialog.

## Accounts

### Staying signed in after a reboot (EKR-15)

On 21.10.2026 a reboot signed two of three subscription accounts out: the service started before the network, every account's `claude auth status` timed out at once, and a minute later two `.credentials.json` held neither an access nor a refresh token. The CLI renews with a single-use refresh token, so Even Keel assumes the sign-in was lost to a renewal cut off half-way or run twice at once, and guards against both: it asks no account and no `/usage` until the provider's API answers, runs its short calls of one folder one at a time and does not kill one on a timeout (`docs/accounts.md`). Neither the cause nor the guard has been seen live: a reboot with expired tokens and no network at the start was not repeated. If an account still asks to sign in after a reboot, the cause is elsewhere. **Workaround:** sign the account in again from the accounts drawer.

## Claude limits

### An early reset of a limit

Anthropic sometimes resets a five-hour window or all limits of an account ahead of time. When a session hits a limit, the chain remembers the reset time from the error or from `/usage` and waits for it; what `/usage` shows right after an early reset has never been seen. If it shows a new window or no window, the remembered time is not updated and the chain keeps waiting until the original reset. **Workaround:** press "New session" on the task — it drops the remembered wait and starts a session at once; or switch the account.

### Fast mode in statistics

Responses in fast mode are recorded (`speed = fast`), but none have appeared in the data, so `/stats` prices them as normal responses and their cost is understated (`tally/CLAUDE.md`).

## Sessions

### A task closed by `NO CHANGES:` (EKR-10)

A task with nothing to merge is closed by its session's last line `NO CHANGES: <why>` out of PR mode (`docs/chain.md`, "Nothing to merge"). Seen live on Huly (2026-10-22, Windows Sandbox): a Codex session on a task it could not do (it asks for `AskUserQuestion`, which Codex lacks) left the branch on `main` and ended its turn with the mark on its own, and the service checked the worktree and moved the task to Done. Not seen: a session writing the mark when the task turns out done already, and the comment on GitHub and Linear. If a session ends such a task without the mark, the chain waits on it as before. **Workaround:** move the task to Done in the tracker yourself, or answer the session in the chat to end its turn with the mark.

### A resume that starts a copy

A resumed session in place was seen to show a fresh session id for under a second before it takes its old one, and the chain now waits for the old id (`docs/sessions.md`). When the CLI starts a copy instead (a new job), the chain takes the first session of that new job; whether a copy also passes through a throwaway id first was not seen. If it does, the chain follows an id with no transcript: the chat says the transcript is not found and the card shows "Session booting" for 5 minutes. The workaround is "New session".

### Sessions through the Agent SDK (BTN-239)

Run live from the service on Windows (CLI 2.1.308, SDK 0.3.308, Haiku, 2026-10-22): a session outlived `Restart-Service EvenKeel` while it waited on its question and the answer from the page went into it without a resume; another outlived three restarts mid-turn, one of them a 28 s stop over the end of a long command, and finished the turn (`docs/sessions.md`). Not run: a night of the chain on the SDK against `--bg`; the service down long enough for the CLI's output to pass 1 MB and go to the spill file; an answer through Remote Control from the phone and the reattach to the same chat after a resume; the Unix socket on Linux and macOS; a chat message from the page straight into a working session (BTN-291 — the same push was seen taken mid-turn only from a terminal); the account's limits from a session's `rate_limit_event` on the page (BTN-290 — the event and its undocumented `unifiedWindows` seen live only from a script; without that field only the window the event names updates, the other stays from `/usage`). If that message is dropped, the chat keeps it as sent and the session never answers it: send it again once the turn ends. If a long run fails where `--bg` would not, the card shows the session busy and replies do not reach it; if the reattach fails, a resumed session opens a new Remote Control chat. **Workaround:** "New session" on the task; set Claude Code's Execution to `CLI --bg` in Settings → Providers and models, which new sessions follow.

### A tool approval in an SDK session (BTN-303)

Out of unattended mode, a tool call the CLI puts to `canUseTool` waits as a question with "Allow" and "Deny", and an answer allows it with its own input or refuses it (`docs/sessions.md`). Covered by tests only: no live session has asked for an approval yet. Assumed: that the CLI in `auto` mode asks for one at all and only for calls its classifier leaves to a human; that `allow` with the unchanged input runs the call; that an approval already waiting is refused within a poll once unattended mode goes on. If the CLI never asks, nothing changes against before; if an allowed call does not run, the session gets an error for it and goes on without it; if a waiting one is not refused, the chain stands on it. **Workaround:** answer "Deny" from the page, or "New session" on the task.

### A lone AGENTS.md in a resumed or SDK Claude session (BTN-340)

Claude Code does not read an `AGENTS.md` by itself, so in a project with no `CLAUDE.md` Even Keel appends the file to a Claude session's system prompt (`docs/sessions.md`, "Project rules for every agent"). Seen live only for a fresh `claude -p` and `claude --bg` launch (CLI 2.1.309). Assumed: that a reply or a limit resume of a saved `--bg` job, which passes no flags and keeps the job's own options, keeps `--append-system-prompt-file` among them; and that an Agent SDK session takes the file from the preset's `systemPrompt.append` (covered by a test only). If either is wrong, that session works without the project's rules. **Workaround:** write a `CLAUDE.md` with the one line `@AGENTS.md`, which Claude Code reads by itself.

### A permission dialog answered from the page (BTN-269)

A `--bg` session waiting on a permission dialog has the call as its question while the `checkpoint` plugin's `PermissionRequest` hook holds it, and the answer goes to the hook, not by a resume (`docs/sessions.md`, "Permission dialogs"). Seen live on CLI 2.1.308 with a hook of the same protocol written by hand: the hook runs beside the open dialog, its `allow` and `deny` are taken there without a stop, and a decision from elsewhere leaves it running. Not run: the whole path through the service — a chain session, its question on the page, the answer from the chat or a tracker comment; an answer through Remote Control while the hook waits (assumed to leave the hook running too, so the service closes the call once the session stops waiting); a hook held for the full 29 minutes against its 1800 s `timeout`; a dialog the `auto` classifier opens rather than an `ask` rule; Codex taking the hook for its own approvals (it skips them by `turn_id`). If the answer does not reach the dialog, the session keeps waiting and the page shows the question as answered; if a closed call lingers, the page shows a question the session no longer has. **Workaround:** answer the dialog through Remote Control; "New session" on the task.

### A key refused after it was added

The check of a key was seen live answering 200 for a working key and 401 for a made-up one, and on 2026-10-25 401 `authentication_error` "invalid x-api-key" for a key disabled in the Console after it was added and again once it was deleted: the check at the service's start made the account `needsLogin`. A 403 (a disabled organization or a key without the permission) was never seen. If such an organization answers anything but 401 or 403 on the models list, the check learns nothing, the account looks fine and its first session fails and stops like any error (`docs/accounts.md`). **Workaround:** remove the account and add a working key.

### An API key out of credit (BTN-165)

Read from CLI 2.1.302, never seen with a key at zero: the API answers 400 "Your credit balance is too low…", and the CLI writes an error message with `error: "billing_error"` and the text "Credit balance is too low", which Even Keel takes as `credit` and waits out like a limit (`docs/chain.md`, exception 1). The check that the credit is back — one output token through `/v1/messages`, an answer of 2xx — was never run against a topped-up key either. If the CLI words it differently, the session stops like any error; if the check never says 2xx, the chain keeps waiting. **Workaround:** press "New session" on the task after the top-up, or switch the account.

### The chat's turn line while an answer is delivered to Codex or after the chain stopped (BTN-188)

Seen live on a Claude chain session (BTN-189, CLI 2.1.302): a text answer and an `AskUserQuestion` answer were each in the transcript 8 s after the send, and the line went from "Delivering the answer" to "Thinking" then (`docs/web.md`). Not run on a Codex session nor on an answer to a session whose chain stopped (`deliverLoose`). It assumes the respawned session writes its prompt (or the answer's result) with a time after the moment the service began the delivery. If it does not, the line keeps saying the answer is on its way for up to three minutes while the session works; nothing else is affected.

### Chat mail in a real session (BTN-181)

Seen live on 22.10.2026 on Haiku `--bg` sessions (TSK-24, TSK-27): a message waited for the hook through a 90-second Bash call and went in at its `PostToolUse`; one sent while the closing text streamed went in at `Stop`, and one sent before a question went in at that `AskUserQuestion`'s `PreToolUse`, the question not going out. Each time the model acted on the message at once and the feed showed it as the user's bubble (the shapes are in `docs/sessions.md`, "Chat mailbox"). Not seen: the mailbox's `Stop` block and `checkpoint-mark`'s in one turn. A turn that ends on `CHECKPOINT:` with mail waiting goes on, and its last line may no longer be the mark, so the handoff waits for the next turn's mark.

**Workaround:** if the handoff does not come, the session writes the mark again at the end of its next turn; or press "New session".

### PR mode on Forgejo (BTN-205)

On GitHub PR mode ran whole: against a real repository from the Windows service (BTN-161, 18.10.2026) the open, a pull request closed unmerged and one merged; and on a GitHub-tracker project in Windows Sandbox (BTN-278, 2026-10-24, a Claude session) the owner's comment in the conversation, the failed runs of the head commit, a collaborator's comments and a collaborator's request for changes with a line comment each reaching the session by `--resume` once the chain was started again, each fix pushed to the same pull request, the `Closes owner/repo#N` line (BTN-295) linking the issue, and the merge moving the task to Done with the worktree, the branch and the branch on GitHub removed. The whole way on Forgejo's API ran once against a fake Forgejo in Windows Sandbox (2026-10-23, a Codex session, the answers shaped as the client expects them, so the shapes themselves stay unchecked): the push and the open, a request for changes reaching the session by `--resume` once the chain was started again, its fix pushed to the same pull request, and the merge moving the task to Done, with the worktree, the branch and the branch on the remote removed — the cleanup waited until two broken projects on the same Huly profile were removed (BTN-317). The rest of Forgejo was written from the API documentation and tested on recorded answer shapes only: the Forgejo client (`src/review/`) as a whole, its comments of the conversation (BTN-223: the issue comments endpoint with `since`) and failed runs of the head commit; that Forgejo refuses its author a request for changes on their own pull request is taken from its source, not tried; GitHub's `user.type` of a bot never came up live. The Forgejo token rights the guide and the profile dialog name for pull requests (EKR-9: `write:repository` to open one and read its reviews, `read:issue` for the conversation's comments, `read:user`) follow from the scope of each API path, not from a token tried with exactly them; if one is missing, the open fails with `review.denied` (the profile's row says **PR refused**) or the poll logs `review: … was not polled`. If a pull request does not open, the chain halts with `review.notOpened` and its cause; the count of a branch's commits beyond `<remote>/<branch>` that keeps an empty pull request from opening (BTN-222) was tested on a fake git only: if it misreads a branch with commits as one with none and the worktree is clean, the task goes to Done without a pull request and the cleanup keeps the unmerged branch with a `cleanup.branchKept` warning (`git branch -d` refuses it), so the work stays; if it cannot count, the forge's own refusal halts the chain as before; if the poll misreads an answer, the log says `review: … was not polled` each minute and the task waits out of the chain. **Workaround:** turn `pullRequests` off for the project so that no new task goes out for review, merge the waiting pull requests by hand and move their tasks to Done in the tracker: the usual cleanup takes them and drops their records.

### The PR mode switch of the settings panel (EKR-7)

PR mode without a remote ran through the service's API in Windows Sandbox (EKR-12, 2026-10-23 and 2026-10-24): the save of `pullRequests` refused with `review.cannotEnable` (`review.noRemote`), PR mode turned on through `config-import`, Start pausing the chain on `review.notReady`, and a `git remote add` of a GitHub address lifting the pause by itself within a minute, the task started at once. The switch and **Add profile** of the settings panel that go with it were seen on the fake state only. If the page refuses the switch wrongly, **workaround:** turn PR mode on by hand in the config (`npm run storage -- config-export`/`config-import`).

### A chain that ended starting again on feedback (BTN-375)

A chain that ran out of tasks with pull requests open starts again by itself when feedback comes on one of them, and one the user stopped does not; this is tested on the dispatcher only, not yet run against a real pull request. If the mark is lost, the feedback waits for **Start** as it did before. **Workaround:** press **Start**.

### A session waiting on you behind a monitor

A turn that ends with a background command or a `Monitor` still running leaves the session in `shell`, which the chain takes for work for up to an hour; since 2026-10-22 a job the CLI's turn summary marked `state: blocked` is taken for waiting instead (`docs/chain.md`, "Background command"). Covered by tests only, from one case seen that day: a session that ended on "waiting for you to press Start" with a monitor on the service log, marked `blocked` with that detail. Not seen: the fixed build showing "waiting" at once, and whether the CLI ever marks `blocked` a turn that waits for its own build or test run. If it does, such a session shows "waiting" while it works: a chat reply goes by `--resume`, which stops the session and its command, and unattended mode stops waiting for it after 10 minutes. **Workaround:** do not reply until the build is done; for a long run, leave unattended mode off.

### Background commands of a stopped session on Linux and macOS (BTN-202)

On Windows `claude stop` was seen to leave the `bash.exe` of a `run_in_background` command alive, and Even Keel now kills the session's process tree after the stop; that was checked there. On Linux and macOS it takes the tree from `ps` the same way and sends each process `SIGTERM`, but it never ran there, and whether the CLI already ends those commands itself was not seen. If a stopped session's command lives on, it holds the worktree and the cleanup leaves it in `leftovers`. **Workaround:** kill the command by hand and press "Done" on the warning; the next cleanup removes the folder.

### The Codex changelog turn with JSON output

`codex exec` for a changelog draft was checked live only without `--json`; with it, a successful turn on 0.162.1 was not seen (only failed ones, on a model the plan refuses). Assumed: the answer is the `text` of the last `item.completed` of type `agent_message`, and `turn.completed` carries `usage` with `input_tokens` (the cached ones in it), `cached_input_tokens` and `output_tokens`. If the item type differs, the draft fails with "the turn ended with no message" (`changelog.failed`); if `usage` differs, the dialog shows 0 tokens. **Workaround:** the Claude provider for the project while it is checked.

### A task back from Backlog after a question in a comment (BTN-245)

Covered by tests only: a session that asks in a tracker comment, moves its task to Backlog and ends its turn; the user answers and moves the task to Todo; the chain stops the old session and starts a new one with a handoff (`relay` in the launch log) whose prompt sends it to the comments (`docs/chain.md`, exception 9). Assumed: the live view gives the old session as not mid-turn with no `AskUserQuestion` (the BTN-243 case showed `waiting` with `ask: null`), and its feed gets no prompt line after the task left. If the CLI keeps a status the chain reads as mid-turn, or writes a prompt line of its own, the old session is adopted and the chain waits as before. **Workaround:** "New session" on the task's card, with the answer in the description.

### Chain sessions on the checked CLI (BTN-250)

Checked live: both downloads on Windows x64 (`claude.exe` 2.1.301 by the manifest's sha256, the Codex npm package 0.162.1 by its sha512, ~25 s together) and each copy answering `--version` with its version; that a copy outside the installer's `versions/` starts its daemon and sessions on itself was seen in BTN-248, in a scratch folder; the CLI check (BTN-253, `docs/releases.md`) runs a launch, a resume and a stop on a copy through the adapters, and stops its daemon after them, from a terminal; the OpenCode 1.18.25 and Copilot 1.0.98 copies (BTN-347) passed it the same way on Windows x64. From the author's Windows service (2026-10-25): with `cli.claude` set to `checked`, the 2.1.310 copy downloaded in 17 s and the chain's sessions launched from it. Not run from the service: `claude daemon stop --any` of a newer daemon followed by that launch (the next daemon assumed to come from the copy, as from a terminal), whether a terminal's newer `claude --bg` replaces the service's daemon in Windows session 0, and the downloads on Linux, macOS and Windows on ARM (a Linux without glibc is told by Node's report and takes OpenCode's `-musl` and Copilot's `linuxmusl` package; GNU or BSD `tar` unpacks the npm packages). If the daemon comes back on the newer version, the banner keeps naming the account and the sessions run on that version, as before the pin; if a download fails, the log says why and the sessions run on the installed CLI. **Workaround:** Settings → Models, "CLI version", `Installed`.

### A Codex chain session reaching its own compaction

Claude Code's compaction in chain sessions was seen live in the week of BTN-254: it comes about 32k short of the window and the session goes on to the task's end (`docs/sessions.md`, "Checkpoint threshold"; the late and hard shares fixed by BTN-377). Codex's never came up: its window is 258,400, its rollouts on disk never went past 139k nor had a `context_compacted`. The thresholds come down to the shares of that window as for Claude — 72, 85 and 95 % (186k, 219k and 245k) unless set in `stats.checkpointShares` — on the assumption that Codex compacts only past them; if it compacts as Claude does, ~32k short of the window (~226k), the hard nudge never comes, and if earlier, the first may not either. A session that compacts goes on with the agent's own summary instead of the handoff note. **Workaround:** if a Codex session loses track after a compaction, press "New session" on the task, or lower the project's shares.

### The context window a chain session gets (BTN-187)

Even Keel takes the window Claude's `/context` answers as the one a chain session gets. The probe runs with the account's environment and the `--settings` of the task's project, and is asked about the `--model` of the session's job file. Assumed: nothing else of a `--bg` launch (the plugins, `--strict-mcp-config`) changes the window, and the job's `respawnFlags` keep the model of the last launch after a `--resume` on another model. If not, the meter and the cap read a wrong window. **Workaround:** set `context.window` and pin `stats.checkpointTokens` for the project.

## Codex

Checked live on codex-cli 0.162.1 (BTN-168): a detached turn outlives its parent killed hard, `exec resume <id>` goes on with the history, a resume of an unknown id fails instead of starting a new thread, `CODEX_HOME`, `rate_limits` and the context fill in the rollout. The rest:

### Codex chains beyond short tasks

From the service's Windows session 0 the Codex sandbox does not start, so a chain session runs commands there reliably only when `execution.codex` is `bypass` (`docs/sessions.md`, BTN-171, BTN-173, BTN-233). Checked live from the service: bypassed chain sessions of the sandbox project ran commands, committed and merged their branch (TSK-19 on 17.10.2026, TSK-20 on 18.10.2026), and on a fresh install (BTN-161, 18.10.2026) a Codex chain of a Linear project with the `linear@even-keel` package read its tasks through the plugin, committed, merged, and both tasks were closed one after the other. One of those sessions wrote that the workspace had a "read-only filesystem policy", yet its commit and its merge into the main checkout went through; which `execution.codex` that install ran with was not looked at. Only short test tasks ran: a long Codex task, its handoffs and its limits are covered by tests and by the entries below. **Workaround:** if a session cannot run commands, set `execution.codex` to `bypass`, or run Codex tasks by hand in a terminal.

### Chain sessions in the Codex app and on the phone (BTN-178)

That the Codex desktop app and the ChatGPT app on the phone do not list the chain's threads is read from the app-server protocol (`thread/list` without `sourceKinds` leaves `exec` threads out). Seen in the Windows desktop app (2026-10-23): `~/.codex/state_5.sqlite` holds 36 `exec` threads, the chain's TSK-20 among them, and the app lists none; the Coldbloom chain tasks it does list are its imports of Claude Code transcripts from `~/.claude/projects`, copies that never write back. Not seen on the phone. If an app lists them after all and the user writes there, that turn runs in the app's own app-server and appends to the same rollout: the page shows it in the feed, but Even Keel may `resume` the thread at the same time, and two turns on one thread is untested. **Workaround:** answer Codex sessions only from the page's chat or the tracker (`docs/sessions.md`).

### Errors and limits in the rollout

An API error is taken from an `event_msg` of type `error`, and a limit by its text (`usage limit`, `rate limit`, `quota`); neither was ever seen. If the shape differs, a session that hit a limit looks finished without Done and waits for the user. **Workaround:** press "New session" on the task after the reset.

### A package server and a Codex server of the same name

A Codex chain session called the Linear server of its package through the gateway (`-c mcp_servers.<name>.url=<gateway address>`) on a fresh install from the Windows service (BTN-161, 18.10.2026). If Codex also has a server of the same name in its own `config.toml`, which one wins is unknown. **Workaround:** remove that server from Codex's config or give the tools through the package alone (`docs/packages.md`).

### Sign-in from the page

`codex login --device-auth` runs through the panel's sign-in flow, whose reading of the link was written for Claude's output. Checked live from the Windows service (BTN-284, 2026-10-22, Windows Sandbox): signing the built-in `codex` account in from the page showed the link, the link worked and the account signed in. The one-time code is parsed out of the output (`loginCode`, BTN-313) and shown large with a "Copy" button; that parsing was written from the codex-cli 0.162.1 and opencode 1.18 binaries' format strings, not from a live sign-in. If a later CLI words it otherwise, the window shows no code box and keeps the CLI output unfolded, the code in it, as before. If a later Codex words its output otherwise and the window shows no link, sign in with `codex login` in a terminal with the same `CODEX_HOME` (`docs/accounts.md`). Adding an account into a new folder under `~/.codex-accounts` (BTN-176) was checked only in the fake mode and in tests: that `codex login --device-auth` signs in a folder Even Keel made empty, and that the plan of a fresh sign-in is already in its `id_token` when the second free account is judged. If the plan is missing then, a second free account is added and only held afterwards, with the warning on its card.

### Codex on an OpenAI API key (BTN-177)

Checked with a fake key only: `codex login --with-api-key` writes the `auth.json` Even Keel writes, `codex login status` reads it, a turn on it goes to the API and fails with 401, and OpenAI's models list answers 401 to a fake key. Never seen with a real key: that a turn runs on it, whether its rollout has `rate_limits` (the card shows the spend instead either way), the price of the model it runs on in Tally, and Codex's message when the key's money runs out (BTN-195). That message is read from the codex-cli 0.162.1 binary ("Quota exceeded. Check your plan and billing details.", its `QuotaExceeded` for OpenAI's 429 `insufficient_quota`), and the money check — `/v1/responses` on a `nano`/`mini` model with `max_output_tokens: 16`, waiting for 2xx or a 429 `insufficient_quota` — was never run against a real key, empty or topped up. If Codex words it otherwise, the session stops like on any error, or, if the text has `quota` in it, its lamp says "limit" while the chain does not hold it (on a key only `credit` is held); if the check never says 2xx (the key lists no such model, the request shape is refused), the chain keeps waiting and the log has the check's reason. **Workaround:** top the key up and press "New session" on the task.

### A crashed turn and a service restart mid-turn

Liveness is the pid of the last turn: a pid reused by another process after a crash would keep the session busy.

A service restart mid-turn was checked live with the real service on Windows (BTN-284, 2026-10-22, Windows Sandbox, the service `EvenKeel` under a local user that is not an administrator): an update restarted the service while a chain session's Codex turn ran. `codex.exe` outlived its dead parent, the new service showed the session working, and once the turn ended it showed it waiting; an answer from the page's chat resumed the thread in about a second, the session merged its branch and Even Keel closed the task.

### Stopping a turn on macOS and Linux

The turn's process group is killed with `process.kill(-pid)`; it was run only on Windows (`taskkill /T`).

### Edit sizes of a FileChange (BTN-185)

Only an `add` with the file's `content` was seen in a rollout (2026-10-18). A `delete` is assumed to carry `content` too, and an `update` a `unified_diff` whose `+`/`-` lines are counted (`src/codex/rollout.ts`). If the shape differs, the chat shows the edit with no `+N −M` and leaves it out of the session's edit total; nothing else changes.

### Codex stats (BTN-170)

Checked on the rollouts on disk: 0.148 desktop sessions and 0.162 exec ones. Never seen: a non-zero `cache_write_input_tokens` — it is assumed to be inside `input_tokens` and is subtracted from it; a rollout in `archived_sessions/`; a 0.162 rollout that has `token_count` lines without a matching `token_usage_record` (the fallback was run only on 0.148 files). If one of these differs, a Codex response is counted twice or its input is off. **Workaround:** none needed for the chain; compare `/stats` with the `usage` in the rollout and fix `src/rollout.ts` (`tally/CLAUDE.md`).

### Codex compactions on the chain's row (BTN-299)

The resets counter of a chain row counts a Codex compaction by the rollout's own `compacted` line (`RolloutFold`), the summary Codex keeps to resume from; the `context_compacted` event that may come with it is not counted. No rollout on disk had a compaction (checked on 2026-10-23), so neither line was ever seen. If 0.162 writes only the event, or a `compacted` line per part of one compaction, the counter misses Codex compactions or counts one more than once. **Workaround:** none needed: the counter is only shown; Tally's stats do not read it.

### Plugin hooks that block (BTN-180)

All five hook events of a plugin were seen running in Codex, and `additionalContext` reaching the model, but never a hook stopping anything: a `PreToolUse` exit code 2 refusing the call (`merge-check` holding a merge until the project's check, `check-marks` refusing a Huly description with bad marks), `permissionDecision: deny` (`show-calibration`), `decision: block` of a `Stop` hook (`checkpoint-mark`). If Codex ignores one, the call goes through: a merge before the check is green, a description with bad marks, a turn that wrote the handoff note without the `CHECKPOINT:` line waits for a reply. **Workaround:** for the last one, reply `CHECKPOINT: .temp/handoff.md` in the chat window or press "New session"; the others show in the tracker and on the CI.

### Project standards on each agent (BTN-359)

The hooks of a project's standards (`docs/sessions.md`, "Project standards") were run only by their tests, with the inputs Claude Code documents; no chain session has met a standard yet. Assumed, per agent: Codex sends its edit as `apply_patch` with the patch text in `tool_input` and honours a `PreToolUse` deny (see the entry above), and its compaction fires `SessionStart` with `compact`; Codex reads files by shell commands, so its session gets the document only from the refused edit, never from a read. Copilot runs the plugin's Claude-format hooks with its own tool names (`view`, `edit`, `create`, `str_replace`) and the path in `path`. OpenCode fires `session.compacted` after a compaction; its PR mode mark is not held, as its turn's end cannot be blocked. If a name or a field differs, that agent's session edits a guarded file without the document, or gets it only once per session; if a compaction is missed, the document is not given again after it. The merge's check is plain files and git and does not depend on the agent. **Workaround:** name the document in the task's text; the merge still waits for the shots and the answers.

### Chat mail at a Codex Stop (BTN-181)

Seen live on 18.10.2026: messages sent during a command reach a Codex session through `PostToolUse`, and the chat shows them from the developer message the hook leaves in the rollout. Not seen: whether a `Stop` `decision: block` keeps the turn going (else the message is counted delivered at `Stop` while the turn ends without it; send it again from the chat), and where the rollout puts its text — the feed looks for the mark in a `UserMessage` too; if it lands elsewhere, the message works but has no bubble in the chat.

### The handoff note of a Codex turn seen by the Stop hook

`/api/sessions/<id>/note` reads the rollout when the hook asks; that Codex has written the turn's last `FileChange` by then was not seen. If it has not, the hook lets the turn end, as in the previous item.

### Plugins in a Codex folder on Linux and macOS

The install and the check that a plugin is already in a folder (`<CODEX_HOME>/plugins/cache/<marketplace>/<plugin>`) were run only on Windows. If the path differs, every first turn of a service run installs the plugin again, which costs a few seconds and changes nothing else.

## OpenCode

### OpenCode chain sessions under the service (BTN-214)

Checked on OpenCode 1.18.25 on Windows, the free `opencode/big-pickle`, by a script that drove the adapter from a terminal: a launch, a reply that starts with `-`, the transcript and the Tally rows; the session read the project's `CLAUDE.md`. The `checkpoint` package's OpenCode plugin and `Agent.write` (BTN-274) were checked the same way, against a stand-in for the service: the nudge and a chat message after a shell call, the message acted on and shown in the feed, a changelog-style turn with its session deleted after it — never a real handoff, a message from the page or a changelog draft. The plugin's merge check and `CHECKPOINT` line (BTN-288) were checked the same way: a merge of the task branch into a main checkout outside the folder refused by a failing check of a few seconds, and the line added to the last text of a turn that wrote the note. Never a check that passes and lets the merge run, and never one that runs for minutes: if OpenCode gives up on a plugin hook it awaits that long, the merge either runs unchecked or fails with OpenCode's error instead of the check's. Never run as a chain session of the Windows service (session 0) or on Linux and macOS, never on a ChatGPT, Copilot or API-key account, never through a whole task — commits, a merge into the main checkout (`external_directory` is allowed for it), packages' MCP servers through the gateway, plugin skills in `skills.paths`. If OpenCode needs something session 0 lacks, as Codex's sandbox does, the session fails on its first turn with OpenCode's output in the error. **Workaround:** run the task on another provider (a run label) and open an issue with the output.

### A spent limit on OpenCode

An OpenCode account signed in to ChatGPT or Copilot has its windows read from the provider (BTN-341, the entry below), so a limit waits for their reset; one on OpenCode Zen has none and no reset time, so the chain tries it again after 15 minutes, doubling the wait up to 4 hours while it keeps hitting the limit (BTN-342, `docs/chain.md`, exception 1). What a spent limit looks like in OpenCode's database was never seen: the fold takes a message's `error` as the API error, a text with `usage limit`, `rate limit`, `quota` or `too many requests`, a 429 `statusCode` or `FreeUsageLimitError` anywhere in it as a limit (`LIMIT_TEXT`, `limitError` in `src/opencode/transcript.ts`). Zen's spent free allowance is said to be a 429 `FreeUsageLimitError` by others' reports only. If it comes otherwise, the session stops like on any error; if OpenCode retries by itself, it hangs (below); how the chain holds a limit on OpenCode was not tried. Zen's free limits are published nowhere, so the waits are a guess: a limit that resets in minutes waits up to the next retry, a daily one is tried a few times in vain. **Workaround:** wait for the reset and press "New session".

### OpenCode's ChatGPT and Copilot limits (BTN-341)

An OpenCode folder signed in to ChatGPT is asked `chatgpt.com/backend-api/wham/usage` with the `openai` token of its `auth.json`, the endpoint Codex's own `/status` reads; one signed in to Copilot is asked `api.github.com/copilot_internal/user` with the `github-copilot` token, the one GitHub's editors read (`docs/sessions.md`, "Limits of OpenCode and Copilot"). Both are internal endpoints and their shapes are taken from what others have published: the live check could not read a folder's tokens, and the only OpenCode folder on the machine was on Zen. If the ChatGPT answer has no windows or names them otherwise, the card says the answer was not read; if Copilot's has no `quota_snapshots` or free-plan counts, it says the same, and the chain waits on a limit as before, with no reset time. Two cards on one ChatGPT account are told apart by its account id from the token; if OpenCode stores none and the token carries no claim, no "one limit with…" line shows. **Workaround:** none needed for the chain; the card's numbers are on the provider's site.

Copilot Free's chat allowance (`limited_user_quotas`, `monthly_quotas`) and the switch of paid plans to AI credits in June 2026 were not seen in an answer: a plan whose allowance moved elsewhere shows "no data".

### The OpenCode model check (BTN-336)

A launch or a resume on an OpenCode model that `opencode models` of the account does not list is refused: the chain pauses with `chain.unknownModel` (`docs/sessions.md`, "Model lists"). Checked from a terminal on OpenCode 1.18.25 on Windows with a free OpenCode Zen account (nine models listed, a made-up one refused), never by the chain of the service and never on a ChatGPT, Copilot or API-key account: if `opencode models` there omits a model the account can run (one set by `opencode.json`, a provider that lists lazily), the task is refused although its session would work. **Workaround:** leave the model field empty so the session runs on OpenCode's default, and open an issue with the output of `opencode models`.

### A hung OpenCode turn

A live turn that has changed no row of its session and written no event for 30 minutes is taken for hung: the session shows as idle with a note, and writing to it or "New session" kills the turn first (`docs/sessions.md`). Built from the database's shape and never seen with a real hang: whether OpenCode retrying a refused request touches the rows meanwhile (then the watchdog never fires), and whether a tool that runs longer than 30 minutes, a long build or test run, really writes nothing (then a working turn is taken for hung, and in unattended mode the chain stops waiting for it 10 minutes later). **Workaround:** for a hang the watchdog misses, kill the turn's `opencode` process and press "New session"; a long build that is not hung goes on regardless — nothing stops it, unless someone writes to the session or presses "New session".

### OpenCode sign-in from the page

`opencode providers login` with ChatGPT's headless method and with Copilot was run in a terminal, not through the page: the window shows the CLI output unfolded and looks for a link in it, as for Codex. Copilot first asks between GitHub.com and Enterprise, and Even Keel answers with Enter after 3 seconds; if the question comes later or changes, the sign-in waits for good. **Workaround:** cancel it and sign in in a terminal with the folder's four `XDG_*_HOME` variables pointing into it (`docs/accounts.md`).

### The OpenCode database read while a turn writes

Even Keel and Tally open `opencode.db` read-only while OpenCode writes it in WAL mode. A read during a checkpoint of the WAL may fail with "database is locked"; the feed then keeps its last state until the next poll, and a stats run logs the file as failed and reads it next time. Never seen in the checks.

## Copilot

### Copilot chain sessions under the service (BTN-215)

Checked on Copilot CLI 1.0.98 on Windows from a terminal, on the machine's own sign-in: a launch with `--session-id`, a resume, the transcript and the Tally rows. Never run as a chain session of the Windows service, never on a folder with a token, never through a whole task (commits, a merge into the main checkout through `--add-dir`), never on Linux or macOS. The service runs in session 0, and whether your `copilot login`, kept in the Windows credential store, reaches a process there was not tried: if it does not, a folder without a token has no sign-in under the service, and its first turn fails with Copilot's error. **Workaround:** add the Copilot account with a fine-grained token instead, or run the task on another provider (a run label).

### Hooks and plugins in Copilot sessions

GitHub's docs say Copilot runs the hooks of the repository's `.claude/settings.json` and loads a Claude Code plugin from `--plugin-dir` with its skills and hooks; neither was seen. The checkpoint threshold, the chat mailbox and a plugin's hooks rest on it. If Copilot does not run them, a Copilot session never hands over on a full context and gets chat messages only after its turn, and a plugin's hooks do nothing. **Workaround:** keep Copilot for short tasks; send messages between turns.

### MCP servers in Copilot sessions

The packages' servers reach Copilot through `--additional-mcp-config`, and the project's own servers are turned off one by one with `--disable-mcp-server`, since Copilot has no strict mode; this was read from `--help`, not run. If a flag is taken otherwise, a session either lacks the tracker's tools or starts the project's own server beside the gateway's. **Workaround:** take the project's `.mcp.json` servers out while it runs on Copilot.

### A spent Copilot budget

What a Copilot session writes when the AI credits or premium requests run out was never seen. The fold takes a `session.error` about billing or AI credits as spent credit and a rate limit or quota as a limit (`src/copilot/transcript.ts`). A folder with a token has its monthly allowance read (BTN-341, below), and either kind waits for its reset on the 1st; a folder on the machine's sign-in has nothing read, and its session waits for good. Any other wording stops it like an error. **Workaround:** after the budget is back, press "New session".

### A Copilot token's monthly allowance (BTN-341)

A Copilot folder with a token is asked `copilot_internal/user` first, then the billing API's `premium_request/usage` of the token's user, which needs the token's "Plan" read permission (`docs/sessions.md`, "Limits of OpenCode and Copilot"). Checked live only on the machine's sign-in, which has nothing read by design; never with a fine-grained token, nor with the AI credits of June 2026. If `copilot_internal/user` refuses a fine-grained token, the billing API is the only source, and it tells what was spent, not what is left: the card counts the requests used and the chain only learns the reset date. If the billing API answers in AI credits under another product name, the card shows 0 used. **Workaround:** none needed for the chain; the allowance is on GitHub's billing page.

### A Copilot turn killed mid-turn

A turn's process killed by "New session", a stop or a crash leaves `events.jsonl` without its `assistant.turn_end`; whether `--resume` then goes on cleanly was not tried. **Workaround:** "New session", which starts a new session with a handoff.

### Copilot installed with npm

Even Keel looks for the `copilot.exe` winget installs, then `copilot` on the PATH. The npm package `@github/copilot` puts a `copilot.cmd` wrapper there, which a detached spawn without a shell may not start. **Workaround:** point `EVEN_KEEL_COPILOT_BIN` at the CLI's real executable.

### Copilot models in the stats

Copilot names Claude models with dots (`claude-sonnet-4.6`), which no price key of `tally.config.json` matches, so such calls show no cost in `/stats` and the collector logs them as unpriced; the GPT names seen were the API's own. **Workaround:** add a price key with the dotted name.

## Packages

Checked live on 17.10.2026 (BTN-174) from a second instance in a terminal: plugins installed into Even Keel's state, a Claude chain session with `--strict-mcp-config` and `--plugin-dir` called the Huly server through the gateway, a plugin's hook ran. On 18.10.2026 (BTN-161) the gateway's server (`npx @firfi/huly-mcp`) also started and answered from the Windows service's session 0 of a fresh install, and its chain sessions called the remote GitHub server (a Claude session) and the Linear one (a Codex session) through the gateway, with the headers filled from the tracker profile. The rest:

### "Add to Claude Code" on /tools (BTN-226)

The button runs `claude plugin marketplace add <checkout>` from the service in the default config. Checked on 22.10.2026 on a second instance started from a terminal with an empty default config: the command added the checkout as a `directory` marketplace to that config's `known_marketplaces.json` and the offer went away. On 23.10.2026 the same from the Windows service (session 0) of an npm install in Windows Sandbox, its account's default config knowing no marketplace: the package's global folder was added as a `directory` marketplace and the offer went away. Not from systemd or launchd. If the CLI fails from the service, the banner shows `packages.marketplaceAdd`; if it adds the marketplace to another folder than the one your terminal uses, the banner stays. **Workaround:** run the command the banner shows in your own terminal; chain sessions do not need it either way.

### Packages on Linux and macOS

Installing a package and the gateway's server processes were run only on Windows. If `npm` or a server does not start there, the cell shows "install failed" or "no response" and the chain waits.

## Trackers

### Two profiles of one tracker (BTN-200)

Two projects on two Huly profiles (two workspaces) were run in Windows Sandbox (2026-10-25): each its own connection, and each project's gateway server listing its own workspace's projects. Not run: two GitHub profiles, where each project's GitHub Actions runs should be read with its own profile's token — covered by tests. If a project's CI reads with another profile's token (a private repository's runs do not show), **workaround:** keep one GitHub profile.

### Several projects on one tracker project (BTN-172, BTN-73)

Two Even Keel projects on one Huly project (`huly` naming it), split by milestone (`requiredMilestones` on one, `excludedMilestones` on the other), were read in Windows Sandbox (2026-10-25): each order held only its own tasks. Not run as live chains: a task closed by one not taken by the other; nor a Linear team (`linear: TEAM/Project`), where a `TEAM/` value is assumed to read the whole team — covered by tests. If a task shows up in both chains, or in neither, **workaround:** keep one Even Keel project per tracker project and leave the release's tasks `Manual`.

### Task feeds from another tracker (BTN-66)

A GitHub feed of a Huly project ran as a live chain (BTN-326, 2026-10-23): the feed was read on its own profile, that profile's required and excluded labels sorted its issues while the Huly tasks kept the project's rules, its task and a Huly one ran in one chain by priority, its session got the brief with the `Tracker: GitHub, project <owner>/<repo>` line, it was closed in GitHub after the merge, `fillMilestone` filled a feed issue's milestone from another feed issue, the `/status` page showed three connections with the feed under its tracker, and Tally named it by its own id with its title and link (its status and "done" stay empty: Tally reads them from Huly only).

Not seen live: a feed on a second Huly workspace (whether a session reads it through the brief when no server signed in as its profile is brought), PR mode and a question in a tracker comment for a feed's task (both go to the feed's tracker by code), run labels on a feed's task, and the Tally check's "failed" and "halted". If a feed's session cannot read its task, **workaround:** set the project's `brief` to `true`; if its pull request or question lands in the wrong tracker, close the task in its tracker by hand.

### A project's own CI profile (BTN-231)

A project's chosen GitHub profile reading its CI ran live (BTN-278, 2026-10-24): with a second GitHub profile chosen in `remoteProfiles`, the project's CI moved to it at once and the first profile's list of CIs emptied. That the chosen profile also opens the project's pull requests, and the same for Forgejo, is covered by tests only: the two profiles of that run shared one token, so the pull request's author could not tell them apart. If a pull request keeps the old profile after the choice, **workaround:** set the wanted profile as the default of its kind on Trackers and CI.

### A removed key and the global folder's daemon

A removed key also stops the global folder's daemon (`claude daemon stop --any` with the global `CLAUDE_CONFIG_DIR`, from the service); that stop was never run from the service — if it fails, the log has the error and the removed key stays with sessions of that folder until its daemon exits (`docs/accounts.md`). **Workaround:** stop the daemon by hand once no session of the folder is live.

### GitHub attachments of a private repository

Downloading a file attached to an issue comment through the page's file route with the token ran live on a public repository (BTN-278, 2026-10-24): an image came back whole, `inline`. GitHub serves such a file of a public repository without a token too, so that the token gets a private repository's file has not been tried; if it does not, the page cannot open that file (`docs/trackers.md`).

### Milestones on Linear

Filling the milestone of a task that entered the chain without one (`fillMilestone`) was checked on Huly and, in a task feed, on GitHub (BTN-326, 2026-10-23); never on Linear, where an issue without a project is assumed to get the project together with the milestone (`docs/trackers.md`).

### Changing a milestone from the task card on Linear

Checked on Huly and on GitHub (BTN-278, 2026-10-24: another milestone, none — `milestoneId: null` — and back). On Linear the choices are the project milestones of the issue's project and `projectMilestoneId: null` is assumed to clear it. If the tracker refuses, the card puts the old milestone back and shows the error; nothing else changes. **Workaround:** change the milestone in the tracker and press the refresh button in the project head (`docs/trackers.md`).

### The tasks of a milestone on Linear (BTN-142)

`milestoneTasks` was checked live on Huly and on GitHub (BTN-278, 2026-10-24: `milestones(query:)` found the milestone by its title and the draft got its done task). On Linear the default order of `comments` is unknown, so both ends are read and the newer one is kept; if a page of comments holds neither end's newest, the draft gets an older comment for that task. **Workaround:** none needed for the release itself — the draft is a draft; edit it by hand.

## CI

### When a CI run counts as stuck

A queued run, or a push without a run, is called stuck after 2 minutes (`STUCK_MS`). The figure was chosen without live runs and may be too short for a slow runner queue (`docs/ci.md`).

### A command after a green main that restarts Even Keel on Linux and macOS

`commands.afterGreen` run as children of the service's node process. The service stops only that process, not its tree — the Windows wrapper (`service/EvenKeelService.cs`, `OnStop`), `KillMode=process` under systemd, `AbandonProcessGroup` under launchd — so a restart command is expected to outlive the stop and start the service again. Checked live on the author's Windows service (2026-10-25): a chain task's push green by the project's check ran `pwsh -NoProfile -Command "Restart-Service EvenKeel; …"`, the service stopped and was up again within 2 s, the rest of that `pwsh` line ran after the start, the command after it never ran, and the commands were not run again after the restart. On Windows the `cmd.exe` running a line dies with node (node's children are in its job object) while the processes it started live on, so the restart has to be one process — `net stop EvenKeel && net start EvenKeel` loses its second half. Not run under systemd or launchd. If the command dies with the service there, the service stays stopped. **Workaround:** make the restart the last command and one process, hand it to something outside the service's process tree (`systemd-run`, a scheduled task), or restart by hand (`docs/ci.md`).

### Chains of several projects on one remote (BTN-210)

The git side is checked on real clones of one remote (`docs/chain.md`, "Projects of one remote"): the fast-forward of `main` before a launch and the second try of a rejected sync. Run in Windows Sandbox (2026-10-25) as two live chains on one remote with a CI: their pushes raced, one broke `main`, its project started the fix session, the other's red push logged that the fix was already under way and started none, and its next task launched only once the fix was green. Not seen: a fix that ends in a way the code does not see (stopped, skipped, its task closed by hand) and leaves the others waiting, and a project with no remote read yet, which is in no group and may still start a second fix. **Workaround:** a project waiting on another's fix that is over — "Skip" on that fix session, or close its fix task; to stop sharing at all, put `ci.guard: false` on all projects of the remote but one: only that one judges and fixes `main`.

### A conflict resolved by an agent (BTN-369)

The carry session (`docs/chain.md`, "The carry session") is covered by tests of the forward tick, the dispatcher's order, the skip and the page's rows; the page was checked on fake data only. Never run live: a session `<KEY>-CARRY` started on a real conflict, its merge into the main branch, the check `merge-base --is-ancestor` closing it, the cleanup of its worktree, the forward tick lifting the hold after it, and the record surviving a restart of the service. Assumed: that the session merges the commit the prompt names (the ref `refs/even-keel/forward/<KEY>` lives in the main checkout, which the task worktree shares) and that a red main of the main project meanwhile waits behind the carry rather than stopping it. If wrong, the carry row stays open after the merge, or the hold stays on the release project's page. **Workaround:** "Skip" on the carry row and merge by hand, as above; the hold clears by itself once the branch has the commits.

### A conflict given to the agent by itself (BTN-370)

The carry session asked for at the conflict itself (`carryAgent` or unattended mode, `docs/chain.md`, "The carry session") is covered by tests of the forward tick with git's answers only, never run live. Assumed: that the session asked for from the forward tick, outside a press of the page, lands in the main project's chain as the button's does, and that unattended mode letting an idle carry session go leaves no second one for the same release commit. If wrong, a conflict waits on the page with no session, or sessions pile up on one conflict. **Workaround:** turn the switch off and press "Resolve with the agent", or merge by hand.

### GitHub issues taken into the tracker (BTN-262)

The intake (`docs/trackers.md`, "Taking GitHub issues in") is covered by tests with a fake repository only, never run against GitHub. Assumed from GitHub's documentation: the REST answers of the labelled issues, their comments with `author_association`, the matching tag refs and the releases by tag; that a fine-grained token with Issues: Read and write may comment and close; that comment ids grow with time, so the last one looked at marks where the next look starts. Assumed of the trackers: that a task created by `create` is found by `tasks` at once, and that a Huly comment written by Even Keel reads back with its first line as written, which keeps a copy from answering a session's question. If they are wrong, an issue is not taken in (a line `intake: …` in the service log says why), a comment is copied twice or not at all, or an issue stays open after its release. **Workaround:** take the issue into the tracker by hand and close it on GitHub by hand; clearing the project's label stops the intake without losing what it follows.

### Your own skills as a package (BTN-339)

The wrap (`src/packages/skills.ts`, `docs/packages.md`, "The user's own skills") is covered by tests on temporary folders: the listing, the hash version, the copy again after an edit, the plugin found and installed through Even Keel's own folders. Seen on the PC (2026-10-24): the skills of `~/.claude/skills`, linked into the shared store (BTN-256), are copied with their files, and `claude plugin validate` (2.1.309) passes the marketplace and the plugin. Not run as a chain session on Codex, OpenCode or Copilot: that each of them takes the plugin `my-skills` as it takes another plugin's skills (seen for other plugins in BTN-340), and that Codex's `plugin/install` accepts the version `1.0.0+<hash>`. If wrong, a session of those agents lacks the skills, or a Codex launch fails with `codex.pluginsFailed`. **Workaround:** turn the package off for the project in `/tools` and keep the skills in the repository's `.agents/skills`.
