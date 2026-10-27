# What has not been verified

Even Keel is checked live on the author's machine with the author's accounts. Some behaviour could not be checked there: the situation never came up, or there was no way to create it. This page lists it, so you know where Even Keel works on an assumption. Each entry says what is assumed, what happens if the assumption is wrong and what to do about it.

If you run into one of these, please open an issue with what you saw: it is the only way the entry gets checked. What has been checked is in [verified.md](verified.md).

## What to check first

Every entry, ordered by how many people it reaches and how badly it hurts them if the assumption is wrong: the lower the number, the sooner it should be checked and the more a run into it costs. Each row links to the entry.

| # | Entry | Who it hits | If the assumption is wrong |
| ---: | --- | --- | --- |
| 0 | [Protection across agent transports and remote servers](#protection-across-agent-transports-and-remote-servers) | chain sessions using Protection | a native pattern may not be enforced, or a server's rules interpreted incompletely |
| 1 | [Temporary model errors](#temporary-model-errors-btn-498) | chains on an overloaded model | an unknown refusal can still hold an unattended chain; a false match could resume unnecessarily |
| 1 | [An early reset of a limit](#an-early-reset-of-a-limit) | everyone on a subscription | the chain waits hours for a reset that already came |
| 2 | [Staying signed in after a reboot](#staying-signed-in-after-a-reboot-ekr-15) | everyone on a subscription | accounts ask to sign in again after a reboot |
| 3 | [Installing and updating with npm](#installing-and-updating-with-npm-btn-265) | npm installs on Linux and macOS; the first publish | the service of a package does not start; install from a clone |
| 3a | [The start at sign-in on Windows](#the-start-at-sign-in-on-windows-btn-372) | every Windows install | no icon, no start after a sign-in, or an update that leaves Even Keel stopped |
| 4 | [macOS](#macos) | macOS | the service or the CLI lookup may not work at all |
| 7 | [Plugin hooks that block](#plugin-hooks-that-block-btn-180) | Codex with the Huly plugin | a bad description reaches Huly |
| 8 | [Claude daemon replacement from the service](#claude-daemon-replacement-from-the-service-btn-250) | Claude accounts on a Windows service | sessions run on an unchecked CLI version |
| 9 | [The wizard's trust check](#the-wizards-trust-check) | new users | a pause at the first launch |
| 10 | [A Codex chain session reaching its own compaction](#a-codex-chain-session-reaching-its-own-compaction) | Codex users | a session that skips the first nudge compacts before the hard one |
| 10a | [A task label selecting compaction](#a-task-label-selecting-compaction) | tasks using the compaction label | the session may still receive a handoff nudge |
| 11 | [Chat mail in a real session](#chat-mail-in-a-real-session-btn-181) | everyone writing to a session about to hand off | the handoff waits a turn longer |
| 11a | [Mail resumed while a chain stops](#mail-resumed-while-a-chain-stops-btn-427) | chat users with a stop pending or a failed delivery | a message may need sending again; a delivery failure may pause the chain |
| 12 | [Background commands of a stopped session on Linux and macOS](#background-commands-of-a-stopped-session-on-linux-and-macos-btn-202) | Linux, macOS | a worktree is left behind after Done |
| 13 | [Packages on Linux and macOS](#packages-on-linux-and-macos) | Linux, macOS with packages | the chain waits on a package that does not start |
| 14 | [The update button on the page](#the-update-button-on-the-page-btn-163) | macOS updating from the page | the service stays stopped after an update; start it by hand |
| 15 | [Stopping a turn on macOS and Linux](#stopping-a-turn-on-macos-and-linux) | Codex, Copilot, OpenCode on Linux, macOS | a stopped turn goes on, or a reused pid is killed |
| 16 | [Forgejo token rights for pull requests](#forgejo-token-rights-for-pull-requests-ekr-9) | PR mode on Forgejo with a token made by the guide | the comments of the conversation are not read, or the open is refused |
| 16a | [Retrying a pull request after fixing access](#retrying-a-pull-request-after-fixing-access-btn-407) | PR mode paused after a refused open | the pull request stays unopened after Resume |
| 16b | [A session's own comment on its pull request](#a-sessions-own-comment-on-its-pull-request-btn-442) | PR mode with sessions that comment on their pull request | the session gets its own comment back as a remark once |
| 16c | [A resolved GitLab conflict while mergeability is checked](#a-resolved-gitlab-conflict-while-mergeability-is-checked-btn-441) | PR mode on GitLab after resolving a conflict | the session gets the resolved conflict once more |
| 17 | [A task back from Backlog after a question in a comment](#a-task-back-from-backlog-after-a-question-in-a-comment-btn-245) | unattended mode | the answered task waits instead of going on |
| 18 | [A resume that starts a copy](#a-resume-that-starts-a-copy) | everyone, rarely | "Session booting" for 5 minutes after an answer |
| 20 | [Sessions through the Agent SDK](#sessions-through-the-agent-sdk-btn-239) | Claude API keys, subscriptions that turn it on | over a long run a session hangs where `--bg` would not, or a resume loses its Remote Control chat |
| 20a | [API spending cap recovery](#api-spending-cap-recovery) | Anthropic keys with organization or workspace spending caps | a cap may need an account switch or manual session restart |
| 21 | [An API key out of credit](#an-api-key-out-of-credit-btn-165) | Claude API keys | the chain stops instead of waiting for a top-up, or waits forever |
| 22 | [Codex on an OpenAI API key](#codex-on-an-openai-api-key-btn-177) | Codex API keys | a session stops on an empty key, or the chain waits forever |
| 23 | [A key refused after it was added](#a-key-refused-after-it-was-added) | Claude API keys of a disabled organization | the key looks fine until a session fails |
| 23a | [An API key's organization header](#an-api-keys-organization-header) | replacing an API key | a key of another organization replaces the old one, or a key of the same one is refused |
| 24 | [A command after a green main that restarts Even Keel on Linux and macOS](#a-command-after-a-green-main-that-restarts-even-keel-on-linux-and-macos) | a restart in `commands.afterGreen` on Linux, macOS | the service stays stopped |
| 25 | [When a CI run counts as stuck](#when-a-ci-run-counts-as-stuck) | CI with a slow runner queue | a run is called stuck too early |
| 26 | [Chains of several projects on one remote](#chains-of-several-projects-on-one-remote-btn-210) | several projects on one remote | a project waits on another's fix that is over |
| 27 | [A package server and a Codex server of the same name](#a-package-server-and-a-codex-server-of-the-same-name) | Codex with packages | a session gets the wrong server of a name |
| 28 | [Sign-in from the page](#sign-in-from-the-page) | Codex accounts added from the page | the one-time code shows only in the unfolded CLI output |
| 29 | [A crashed turn and a service restart mid-turn](#a-crashed-turn-and-a-service-restart-mid-turn) | Codex | a dead session looks busy |
| 30 | [Chain sessions in the Codex app and on the phone](#chain-sessions-in-the-codex-app-and-on-the-phone-btn-178) | Codex | two turns on one thread if you answer on the phone |
| 32 | [A patched handoff note seen by the Codex Stop hook](#a-patched-handoff-note-seen-by-the-codex-stop-hook) | Codex using apply_patch | a note without the `CHECKPOINT:` line waits for a reply |
| 33 | [The chat's turn line on Codex and after the chain stopped](#the-chats-turn-line-while-an-answer-is-delivered-to-codex-or-after-the-chain-stopped-btn-188) | Codex, a stopped chain | the chat says "delivering" for up to three minutes |
| 34 | [Plugins from a git URL marketplace](#plugins-from-a-git-url-marketplace) | a marketplace added by URL | sessions keep an old plugin |
| 36 | ["Add to Claude Code" on /tools](#add-to-claude-code-on-tools-btn-226) | new users running the service | the banner stays; run its command by hand |
| 37 | [Two profiles of one tracker](#two-profiles-of-one-tracker-btn-200) | two GitHub profiles | a project's CI reads with another profile's token |
| 37f2 | [MCP through OAuth on a tracker profile](#mcp-through-oauth-on-a-tracker-profile-btn-475) | Jira, Linear and GitHub profiles connected through OAuth | the connection does not complete, or sessions lose tracker tools; use the MCP token |
| 37g | [Tracker call diagnostics](#tracker-call-diagnostics) | projects with slow tracker calls | the log may not explain a timeout; inspect the tracker and network directly |
| 39a | [A conflict resolved by an agent](#a-conflict-resolved-by-an-agent-btn-369) | release projects with a conflict | the carry row stays open after the merge; skip it |
| 39b | [A conflict given to the agent by itself](#a-conflict-given-to-the-agent-by-itself-btn-370) | release projects with the switch on or unattended | a conflict gets no session, or several; press the button instead |
| 41 | [Task feeds from another tracker](#task-feeds-from-another-tracker-btn-66) | task feeds from a second Huly workspace or in PR mode | a feed's session cannot read its task, or its pull request is not closed in the feed's tracker |
| 44 | [The context window a chain session gets](#the-context-window-a-chain-session-gets-btn-187) | everyone | the context meter and the handoff cap read a wrong window |
| 45 | [A task closed by `NO CHANGES:`](#a-task-closed-by-no-changes-ekr-10) | GitHub-tracker projects outside PR mode | the task is closed with no comment saying why |
| 45a | [Project standards on each agent](#project-standards-on-each-agent-btn-359) | projects with standards on Codex, Copilot, OpenCode | a guarded file is edited before its document; the merge still waits for its check |
| 46 | [A session waiting on you behind a monitor](#a-session-waiting-on-you-behind-a-monitor) | everyone, rarely | a session waiting for its own build shows "waiting"; a reply or unattended mode cuts the build short |
| 52 | [GitHub attachments of a private repository](#github-attachments-of-a-private-repository) | private GitHub repositories | the page cannot open an attached file |
| 53 | [A removed key and the global folder's daemon](#a-removed-key-and-the-global-folders-daemon) | anyone removing a key | the removed key stays with the folder's sessions until its daemon exits |
| 55 | [OpenCode chain sessions under the service](#opencode-chain-sessions-under-the-service-btn-214) | OpenCode on Linux, macOS or a ChatGPT, Copilot, API-key account | sessions do not start, or a whole task runs on a wrong assumption |
| 56 | [A spent limit on OpenCode](#a-spent-limit-on-opencode) | OpenCode | the session stops on the error instead of waiting for the reset; on Zen, retries too early or too late |
| 57 | [A hung OpenCode turn](#a-hung-opencode-turn) | OpenCode | a hang the watchdog misses stays busy, or a long build is taken for hung |
| 57a | [OpenCode stream errors in the account log](#opencode-stream-errors-in-the-account-log-btn-497) | OpenCode with a silent failed request | a changed log format could leave the turn busy until the hang check |
| 58 | [OpenCode sign-in from the page](#opencode-sign-in-from-the-page) | OpenCode with Copilot | the sign-in waits for good; sign in in a terminal |
| 59 | [Plugins in a Codex folder on Linux and macOS](#plugins-in-a-codex-folder-on-linux-and-macos) | Codex on Linux, macOS | a few seconds per first turn |
| 60 | [Edit sizes of a FileChange](#edit-sizes-of-a-filechange-btn-185) | Codex | the chat shows an edit without its size |
| 61 | [Codex stats](#codex-stats-btn-170) | Codex | a response counted twice in `/stats` |
| 63 | [Fast mode in statistics](#fast-mode-in-statistics) | fast mode | `/stats` understates its cost |
| 67 | [The OpenCode database read while a turn writes](#the-opencode-database-read-while-a-turn-writes) | OpenCode | the feed or a stats run skips one poll |
| 69 | [Copilot chain sessions under the service](#copilot-chain-sessions-under-the-service-btn-215) | Copilot with a token, or on Linux and macOS | sessions do not start under the service |
| 70 | [Hooks and plugins in Copilot sessions](#hooks-and-plugins-in-copilot-sessions) | Copilot | a chat message sent mid-turn is lost, no handoff on a full context; resend it between turns |
| 71 | [MCP servers in Copilot sessions](#mcp-servers-in-copilot-sessions) | Copilot in a repository with its own MCP servers | the project's server starts beside the gateway's |
| 72 | [A spent Copilot budget](#a-spent-copilot-budget) | Copilot | the session stops on the error, or waits for good on the machine's sign-in; press "New session" |
| 73 | [A Copilot turn killed mid-turn](#a-copilot-turn-killed-mid-turn) | Copilot | the resume fails; press "New session" |
| 74 | [Copilot installed with npm](#copilot-installed-with-npm) | Copilot from npm | the first turn fails; set `EVEN_KEEL_COPILOT_BIN` |
| 75 | [Copilot models in the stats](#copilot-models-in-the-stats) | Copilot on Claude models | `/stats` shows no cost for them |
| 76 | [GitHub issues taken into the tracker](#github-issues-taken-into-the-tracker-btn-262) | projects with `intakeLabel` | an issue is not taken in, or stays open after its release; close it by hand |
| 77 | [A tool approval in an SDK session](#a-tool-approval-in-an-sdk-session-btn-303) | Agent SDK sessions out of unattended mode | an allowed call fails, or the chain waits on an approval after unattended mode goes on |
| 78 | [A permission dialog answered from the page](#a-permission-dialog-answered-from-the-page-btn-269) | Claude `--bg` sessions that stop on a permission dialog | the session keeps waiting after the answer; answer through Remote Control |
| 78a | [Keeping a waiting session warm](#keeping-a-waiting-session-warm-btn-437) | Claude chain sessions with the setting on (off by default) | the pings miss the cache and spend limits for nothing, or touch the waiting session; set it to 0 |
| 78b | [Handoffs by context size turned off](#handoffs-by-context-size-turned-off-btn-255) | those who turn the switch off (on by default) | a session still gets a handoff nudge, or compacts where it used to hand off |
| 79 | [Your own skills as a package](#your-own-skills-as-a-package-btn-339) | Codex, OpenCode, Copilot with "My skills" | a session lacks your skills, or a Codex session fails on the plugin's install |
| 79 | [The OpenCode model check](#the-opencode-model-check-btn-336) | OpenCode on Copilot or an API key | a model that works is refused at launch; leave the model field empty |
| 80 | [OpenCode's Copilot limits](#opencodes-copilot-limits-btn-341) | OpenCode on Copilot | the card has no bars and a limit waits with no reset time, as before |
| 81 | [A Copilot token's monthly allowance](#a-copilot-tokens-monthly-allowance-btn-341) | Copilot with a token | the card counts nothing, or only what was spent |
| 82 | [A lone AGENTS.md in a resumed or SDK Claude session](#a-lone-agentsmd-in-a-resumed-or-sdk-claude-session-btn-340) | Claude on a project with an `AGENTS.md` and no `CLAUDE.md` | the session works without the project's rules; add a `CLAUDE.md` with `@AGENTS.md` |
| 83 | [A Claude plan change](#a-claude-plan-change-btn-393) | Claude subscriptions moved between Pro and Max | the card keeps the old plan or no bars, or the account asks to sign in |
| 84 | [The instruction size ceiling in a Claude session](#the-instruction-size-ceiling-in-a-claude-session-btn-468) | Claude sessions editing instruction files | a CLI response change could omit the size warning; the repository test still holds Even Keel's files |

### The instruction size ceiling in a Claude session (BTN-468)

The hook executable has been checked with supplied PostToolUse and Stop payloads, including persisted state, but not called by a live Claude session for this ceiling. Check in a scratch project with the existing global hook: grow a `CLAUDE.md` or nested `AGENTS.md` beyond 13,000 bytes with Edit and Write, log the session's reason, then end the turn. The edit should succeed, the model should receive the guidance, and Stop should block once despite the journal row. Reduce an already oversized file and confirm no size reminder or size block. If a future CLI omits `tool_response.originalFile`, the size check stays silent; the Vitest ceiling test still covers Even Keel's two instruction files.

### Tracker call diagnostics

Timeout and slow-call diagnostics are covered by tests but have not been observed in a running service against a slow tracker. If the log does not identify the operation or request count, inspect the tracker and network directly and report the missing details.

### Protection across agent transports and remote servers

What Codex's rules hold and miss, Copilot's rules as Even Keel writes them (they missed the very command they name,
BTN-463) and from a chain launch of the service (a project's rule saved on the running service, the real remote's
rules, the Huly deletion rule through the gateway), the remote audit's verdicts for tokens without access, the page's
warnings, and Claude's deny rules from a `--bg` chain session's `--settings` (a shared rule and a project's rule saved
on the running service, both refused by the harness) are in [`verified.md`](verified.md). Not checked live: Claude
deny rules in an SDK session (the same `--settings` through the Agent SDK), Huly deletion rules on Claude and on
Copilot's standalone `huly` server, Copilot's `rm -rf` rules on a real call (held only in their shape with `echo`: the
model refused to run `rm -rf` itself), Codex under Windows session 0 and slot reuse, classic GitHub protection, a
server actually rejecting a destructive push, the page's band for a remote after a real launch, and a project's own
Protection rules over the shared ones reaching a new session of an agent other than Claude Code and Copilot without a restart. The adapter
arguments, settings inheritance and API verdicts are covered by tests.
If an agent ignores a native rule, equivalent destructive actions can still run. Inspect server rules directly,
enforce protection there, and use a sandbox when available. A rule is not a security boundary. Check denial with
harmless commands against a local bare remote; do not test destructive pushes or deletions on a real repository.

### API spending cap recovery

The organization's actual refusal was seen on Claude CLI 2.1.310 on 2026-10-25: HTTP 400, `error: unknown`, "reached your specified API usage limits", and an explicit UTC date of renewed access. Parsing that refusal, waiting until its date, and early recovery on a successful key check are covered by tests; the panel and account card were checked on fake states. A real chain has not yet been left through the reset or a raised cap. The phrase "specified workspace API usage limits" is accepted defensively but has not been seen in a live refusal. If its actual wording differs or recovery fails, switch to an available account, or raise the cap and start a new session. Check both automatic recovery paths on a test project before relying on them unattended.

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

### A Claude plan change (BTN-393)

A ChatGPT plan change revokes the sign-in's access token at once: on 25.10.2026, right after free → Plus, a Codex folder's token with ten days left got 401 from ChatGPT's usage answer until Codex renewed it, and the card had no bars until then. Whether moving a Claude subscription between Pro and Max does the same to the CLI's OAuth token has never been seen. Even Keel assumes the sign-in keeps working and the card takes the new plan and windows at the next `auth status` and `/usage`. If the token is revoked, the card may keep the old plan or show no bars until the CLI renews the token at its next call, or the account may ask to sign in. **Workaround:** start a session on the account, or sign it in again from the accounts drawer.

## Claude limits

### An early reset of a limit

Anthropic sometimes resets a five-hour window or all limits of an account ahead of time. When a session hits a limit, the chain remembers the reset time from the error or from `/usage` and waits for it; what `/usage` shows right after an early reset has never been seen. If it shows a new window or no window, the remembered time is not updated and the chain keeps waiting until the original reset. **Workaround:** press "New session" on the task — it drops the remembered wait and starts a session at once; or switch the account.

### Fast mode in statistics

Responses in fast mode are recorded (`speed = fast`), but none have appeared in the data, so `/stats` prices them as normal responses and their cost is understated (`docs/tally.md`).

## Sessions

### Temporary model errors (BTN-498)

Only Codex's `Selected model is at capacity. Please try a different model.` was reported from a real refusal (2026-10-27). Unit tests cover all four transcript formats, the `overloaded_error` and `server_is_overloaded` codes, 503/529 with an overload/unavailability message, a 15-minute retry doubling up to four hours, reset on success, cancellation by a human answer or a replacement, and keep-warm after an overloaded ping. The fake page checks the waiting lamp, next-attempt time, chat and replacement controls. Not run through a real provider outage: Claude, OpenCode and Copilot variants, Codex's code-only overload, a scheduled resume under the service, and a Claude keep-warm fork refused by the overload and later recovering. A refusal with an unknown spelling remains a permanent error and waits for a person; a misclassified refusal could resume unnecessarily. **Workaround:** answer from the chat, choose another model and use "New session", or pause the chain to stop automatic retries. No overload is manufactured against a live provider.

### A task closed by `NO CHANGES:` (EKR-10)

A task with nothing to merge is closed by its session's last line `NO CHANGES: <why>` out of PR mode (`docs/chain.md`, "Nothing to merge"). Seen live on Huly (2026-10-22, Windows Sandbox): a Codex session on a task it could not do (it asks for `AskUserQuestion`, which Codex lacks) left the branch on `main` and ended its turn with the mark on its own, and the service checked the worktree and moved the task to Done. On Linear (2026-10-25, the Windows service, an OpenCode session on a free model) a task already done in `main` got the mark on its own, went to Done and got the mark's line as a comment. Not seen: the comment on GitHub. If a session ends such a task without the mark, the chain waits on it as before. **Workaround:** move the task to Done in the tracker yourself, or answer the session in the chat to end its turn with the mark.

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

### Keeping a waiting session warm (BTN-437)

With `keepWarm` above 0 a fork of a waiting Claude chain session asks for one word shortly before its cache goes cold (`docs/chain.md`, "A keep-warm ping"; `docs/sessions.md`, "Keep-warm"). Seen live only on probes (CLI 2.1.310, Haiku, 2026-10-26): forks of short `-p` and `--bg` sessions read 88–100% of their prompt from the cache and wrote no transcript. Not run: the whole path through the service on a real chain session — a long Opus `--bg` session with its packages through the local MCP gateway and the `checkpoint` hooks off for the fork only; a fork of an SDK session (`forkSession`, `persistSession: false`, the preset system prompt with the project's appended rules); a fork of a session waiting on an `AskUserQuestion`, whose pending call is the last thing in its transcript; a ping kept up for hours and the answer that follows it reading the cache. Assumed: that the fork's system prompt, tools and model match the session's closely enough for the 90% hit share — a mismatch shows as a `keepwarm: … missed the cache` line in the service log and turns the pings off for that session, at the price of one cache write; that a fork leaves the waiting session and its question untouched. If the fork does change the session, its question or the next answer looks different on the page. **Workaround:** set "Keep the cache of a waiting session warm, hours" to 0 in Settings → Sessions; it applies at the next check.

### Handoffs by context size turned off (BTN-255)

With `contextHandoffs` off the checkpoint endpoint answers `source: "off"` and the hook asks for no handoff at any context size (`docs/sessions.md`, "Checkpoint threshold"). Checked by tests of the hook's plan and the settings levels, and on 2026-10-26 by the real `context-checkpoint.mjs` process against a fake endpoint: at 500k tokens it stayed silent on `source: "off"` and nudged on `calibration`. Not run: the service's own answer for a live session, and a real chain session past its threshold with the switch off, and its own compaction afterwards. Assumed: that the session's `checkpoint` package is 0.13.0 or later — an older one does not know `source: "off"` and keeps nudging at the threshold; that the agent's compaction then keeps the session going without a handoff. **Workaround:** if a session still gets the nudge, update the `checkpoint` package on `/tools` and press "New session"; to stop the nudges at once, set the threshold to its highest value as before.

### A task label selecting compaction

The label `Разрыв | компакция` pins a task's checkpoint threshold to 999999; the handoff label or no label inherits the project's threshold. The settings resolver is tested, but the path from a live tracker task through the service's checkpoint endpoint and the plugin has not been checked. If the label is not read, the task may receive handoff nudges. **Workaround:** pin the project's threshold in Settings and inspect the session's checkpoint endpoint.

### A key refused after it was added

The check of a key was seen live answering 200 for a working key and 401 for a made-up one, and on 2026-10-25 401 `authentication_error` "invalid x-api-key" for a key disabled in the Console after it was added and again once it was deleted: the check at the service's start made the account `needsLogin`. A 403 (a disabled organization or a key without the permission) was never seen. If such an organization answers anything but 401 or 403 on the models list, the check learns nothing, the account looks fine and its first session fails and stops like any error (`docs/accounts.md`). **Workaround:** replace the key with a working one ("Replace key" in the card's ⋯ menu).

### An API key's organization header

Replacing an API account's key (BTN-418, `docs/accounts.md`, "The key's organization") refuses a key of another organization by the header a working key's answer to the models list carries: Anthropic's `anthropic-organization-id`, OpenAI's `openai-organization`. Both are taken from the providers' documentation; the parsing is tested on a stubbed `fetch`, no live answer was looked at. Assumed: the header comes on `GET /v1/models` (not only on generation calls), it names the organization the same way for every key of it, and an OpenAI project key (`sk-proj-`) gets the organization there too, not only `openai-project`. If no header comes, nothing is refused and a key of another organization replaces the old one, its spend counted under the old account. If the value differs between keys of one organization (per workspace or per project), a working key of the same account is refused as of another organization. **Workaround:** for the first, remove the account and add the other organization's key as its own; for the second, add the new key as a new account.

### An API key out of credit (BTN-165)

Read from CLI 2.1.302, never seen with a key at zero: the API answers 400 "Your credit balance is too low…", and the CLI writes an error message with `error: "billing_error"` and the text "Credit balance is too low", which Even Keel takes as `credit` and waits out like a limit (`docs/chain.md`, exception 1). The check that the credit is back — one output token through `/v1/messages`, an answer of 2xx — was never run against a topped-up key either. If the CLI words it differently, the session stops like any error; if the check never says 2xx, the chain keeps waiting. **Workaround:** press "New session" on the task after the top-up, or switch the account.

### The chat's turn line while an answer is delivered to Codex or after the chain stopped (BTN-188)

Seen live on a Claude chain session (BTN-189, CLI 2.1.302): a text answer and an `AskUserQuestion` answer were each in the transcript 8 s after the send, and the line went from "Delivering the answer" to "Thinking" then (`docs/web.md`). Not run on a Codex session nor on an answer to a session whose chain stopped (`deliverLoose`). It assumes the respawned session writes its prompt (or the answer's result) with a time after the moment the service began the delivery. If it does not, the line keeps saying the answer is on its way for up to three minutes while the session works; nothing else is affected.

### Mail resumed while a chain stops (BTN-427)

After BTN-499, a refused user-answer delivery on an active chain also clears its delivery marks without pausing or automatically replaying the answer; tests cover a failed session-state write followed by an explicit retry. Not checked with a live CLI: the error reaching chat while the chain keeps running, and the retry reaching the same session.

Regression tests cover a message left in the mailbox when the turn ends and `stopAfter` drops the chain before its queued answer runs, and an answer to a question in the same race. They use the real dispatcher, chat routing and mailbox with a fake session transport. Delivery goes to the same session through `deliverLoose`; transport failures and session replacements return mail to the chat, and hooks cannot take mail claimed for a queued resume. This timing has not been checked against a live CLI after the fix. If the CLI refuses the resume, mail should return instead of appearing delivered. **Workaround:** check the session transcript and resend a returned message from chat.

### Chat mail in a real session (BTN-181)

Seen live on 22.10.2026 on Haiku `--bg` sessions (TSK-24, TSK-27): a message waited for the hook through a 90-second Bash call and went in at its `PostToolUse`; one sent while the closing text streamed went in at `Stop`, and one sent before a question went in at that `AskUserQuestion`'s `PreToolUse`, the question not going out. Each time the model acted on the message at once and the feed showed it as the user's bubble (the shapes are in `docs/sessions.md`, "Chat mailbox"). After a Codex session lost `NO CHANGES:` on Stop mail, the Stop prompt was made explicit about repeating a still-valid final mark (BTN-406). Checked live on 25.10.2026 with a local mailbox listener, the real mailbox hook, Codex 0.164.0 and Claude Code 2.1.310: each answered `PONG`, repeated the same final `NO CHANGES:`, `CHECKPOINT:` or `PULL REQUEST:` line, and its transcript fold showed one mail bubble and the final mark. Codex also passed with the Russian Stop prompt. Not seen: the mailbox's `Stop` block and `checkpoint-mark`'s block in one turn, when the first response omitted the handoff mark. If the two reminders still end without the mark, the handoff waits for it. **Workaround:** ask the session in chat to end with `CHECKPOINT: .temp/handoff.md`.

**Workaround:** if the handoff does not come, the session writes the mark again at the end of its next turn; or press "New session".

### Retrying a pull request after fixing access (BTN-407)

Covered by dispatcher tests: Start or Resume on `review.notOpened` forgets only the current task's refused mark and retries it without touching its session; another refusal pauses with its new cause and is not retried on each tick. Not checked live: changing the project's remote profile or renewing its token after a real forge refusal, then pressing Resume on the running service. If the new credentials are not picked up, the chain pauses again. **Workaround:** check the profile's access and answer the task's session in the chat to have it mark again, or restart the service to forget the refused mark.

### A session's own comment on its pull request (BTN-442)

Covered by tests: a remark whose text holds `<!-- even-keel:session -->` is not feedback and not in the note of a pull request closed unmerged, a marked line comment is dropped alone. Seen live before the fix (BTN-415, a self-managed GitLab): a session's note on its merge request, posted through the `gitlab` MCP plugin with the same token as Even Keel, came back to it by `--resume`. Not checked live: that a session told by the PR-mode prompt puts the mark into a comment it posts through a forge's MCP server, and that each forge keeps an HTML comment in the body its API returns. If a session leaves the mark out, its comment comes back to it once as a remark, as before the fix, and a closed pull request's note for the next launch counts it. **Workaround:** none needed for one wasted turn; if a session keeps answering itself, stop the chain and tell it in the chat not to comment on its pull request.

### A resolved GitLab conflict while mergeability is checked (BTN-441)

Covered by adapter tests: `unchecked`, `checking` and `preparing` give unknown mergeability even with `has_conflicts: true`, for both `detailed_merge_status` and the older `merge_status`; a later checked result is read normally. The review event tests cover unknown mergeability producing no conflict feedback. Seen before the fix on GitLab CE 19.5 (BTN-415): after a session pushed a conflict resolution, the old conflict flag caused another session on that same commit. Not checked live after the fix: pushing a resolution and polling through GitLab's recheck without another conflict handoff. **Workaround:** inspect the merge request's current conflict status before making further changes.

### Forgejo token rights for pull requests (EKR-9)

PR mode ran whole on both forges. On GitHub: against a real repository from the Windows service (BTN-161, 18.10.2026) the open, a pull request closed unmerged and one merged; and on a GitHub-tracker project in Windows Sandbox (BTN-278, 2026-10-24, a Claude session) the owner's comment in the conversation, the failed runs of the head commit, a collaborator's comments and a collaborator's request for changes with a line comment each reaching the session by `--resume` once the chain was started again, each fix pushed to the same pull request, the `Closes owner/repo#N` line (BTN-295) linking the issue, and the merge moving the task to Done with the worktree, the branch and the branch on GitHub removed. On a real Forgejo (2026-10-25, a Linear project on the Windows service, OpenCode sessions, pull requests opened by a bot user's profile, a Forgejo Actions runner): the push and the open; the repository owner's comment in the conversation and their request for changes with a line comment and no text each waking the ended chain and reaching a new session by a handoff, and so did a failed run of the head commit and a conflict with `main` (the session merged `origin/main` and resolved it), each fix pushed to the same pull request; two merges moving their tasks to Done with the worktree, the branch and the branch on the remote removed; a pull request closed unmerged cleaned up the same way, its task skipped and left in Todo; a task with nothing ahead of `main` and a clean worktree going to Done with no pull request (BTN-222); a token without pull request rights halting the chain with `review.notOpened` and the poll logging `review: … was not polled` each minute. What stays unchecked: the Forgejo token rights the guide and the profile dialog name for pull requests (`write:repository` to open one and read its reviews, `read:issue` for the conversation's comments, `read:user`) follow from the scope of each API path, and the bot's token of that run had `write:issue` in place of `read:issue`; that Forgejo refuses its author a request for changes on their own pull request is taken from its source, not tried; GitHub's `user.type` of a bot never came up live. If a pull request does not open, the chain halts with `review.notOpened` and its cause; if the count of a branch's commits beyond `<remote>/<branch>` misreads a branch with commits as one with none and the worktree is clean, the task goes to Done without a pull request and the cleanup keeps the unmerged branch with a `cleanup.branchKept` warning (`git branch -d` refuses it), so the work stays; if the poll misreads an answer, the log says `review: … was not polled` each minute and the task waits out of the chain. **Workaround:** turn `pullRequests` off for the project so that no new task goes out for review, merge the waiting pull requests by hand and move their tasks to Done in the tracker: the usual cleanup takes them and drops their records.

### A session waiting on you behind a monitor

A turn that ends with a background command or a `Monitor` still running leaves the session in `shell`, which the chain takes for work for up to an hour; since 2026-10-22 a job the CLI's turn summary marked `state: blocked` is taken for waiting instead (`docs/chain.md`, "Background command"). Covered by tests only, from one case seen that day: a session that ended on "waiting for you to press Start" with a monitor on the service log, marked `blocked` with that detail. Not seen: the fixed build showing "waiting" at once, and whether the CLI ever marks `blocked` a turn that waits for its own build or test run. If it does, such a session shows "waiting" while it works: a chat reply goes by `--resume`, which stops the session and its command, and unattended mode stops waiting for it after 10 minutes. **Workaround:** do not reply until the build is done; for a long run, leave unattended mode off.

### Background commands of a stopped session on Linux and macOS (BTN-202)

On Windows `claude stop` was seen to leave the `bash.exe` of a `run_in_background` command alive, and Even Keel now kills the session's saved descendants after the stop; that was checked there. Creation-time checks for Claude session records, the root before stopping, and saved children before termination were also checked with owned Windows parent/child processes on 2026-10-26. On Linux and macOS it takes the tree from `ps`, reads creation times through `/proc` or `ps -o lstart=`, and sends each saved process `SIGTERM`; none of this ran there, and whether the CLI already ends those commands itself was not seen. Unknown creation times retain the old pid-only behaviour; a wrong time can leave a session or its command running. If a stopped session's command lives on, it holds the worktree and the cleanup leaves it in `leftovers`. **Workaround:** verify the command's pid and creation time, kill it by hand and press "Done" on the warning; the next cleanup removes the folder.

### A task back from Backlog after a question in a comment (BTN-245)

Covered by tests only: a session that asks in a tracker comment, moves its task to Backlog and ends its turn; the user answers and moves the task to Todo; the chain stops the old session and starts a new one with a handoff (`relay` in the launch log) whose prompt sends it to the comments (`docs/chain.md`, exception 9). Assumed: the live view gives the old session as not mid-turn with no `AskUserQuestion` (the BTN-243 case showed `waiting` with `ask: null`), and its feed gets no prompt line after the task left. If the CLI keeps a status the chain reads as mid-turn, or writes a prompt line of its own, the old session is adopted and the chain waits as before. **Workaround:** "New session" on the task's card, with the answer in the description.

### Claude daemon replacement from the service (BTN-250)

Downloads are checked on Windows x64 and arm64, macOS Intel and arm64, and Linux x64 (glibc and Alpine musl) and native arm64; the SDK module loads too (`npm run cli-fetch`, 2026-10-26, `docs/releases.md`, "Checking a CLI version"). Linux arm64 musl was checked under qemu on 2026-10-25. A copy outside the installer's `versions/` starts its own daemon and sessions from a terminal (BTN-248); the CLI check runs a launch, resume and stop through the adapters, and stops its daemon afterwards (BTN-253). From a Windows service (2026-10-25), with `cli.claude` set to `checked`, the 2.1.310 copy downloaded in 17 s and the chain's sessions launched from it.

Still not run from the service: `claude daemon stop --any` of a newer daemon followed by that launch (the next daemon assumed to come from the copy, as from a terminal), and whether a terminal's newer `claude --bg` replaces the service's daemon in Windows session 0. If the daemon comes back on the newer version, the banner keeps naming the account and the sessions run on that version, as before the pin. **Workaround:** Settings → Models, "CLI version", `Installed`.

### A Codex chain session reaching its own compaction

Claude Code's compaction in chain sessions was seen live in the week of BTN-254: it comes about 32k short of the window and the session goes on to the task's end (`docs/sessions.md`, "Checkpoint threshold"; the late and hard shares fixed by BTN-377). Codex's was seen once, in Windows Sandbox on 25.10.2026 (codex-cli 0.164.0, gpt-6.1-sol on Plus), with `model_context_window = 100000`, which Codex gives as a 95k window: the first nudge reached the session at 77.7k (the 72 % share was crossed inside one large read), the session read on, and Codex compacted at 87.8k, 92 % of the window, before the 95 % hard share. After the compaction the next nudge came, the session wrote `.temp/handoff.md` and ended with `CHECKPOINT:`, and Even Keel handed the task over. Still unknown is where Codex compacts in the full 258,400 window: at the same 92 % (~238k) it falls between the late share (219k) and the hard one (245k), so a session that ignores the first two nudges compacts without a handoff note and goes on from the agent's own summary. **Workaround:** if a Codex session loses track after a compaction, press "New session" on the task, or lower the project's shares (`stats.checkpointShares`).

### The context window a chain session gets (BTN-187)

Even Keel takes the window Claude's `/context` answers as the one a chain session gets. The probe runs with the account's environment and the `--settings` of the task's project, and is asked about the `--model` of the session's job file. Assumed: nothing else of a `--bg` launch (the plugins, `--strict-mcp-config`) changes the window, and the job's `respawnFlags` keep the model of the last launch after a `--resume` on another model. If not, the meter and the cap read a wrong window. **Workaround:** set `context.window` and pin `stats.checkpointTokens` for the project.

## Codex

Checked live on codex-cli 0.162.1 (BTN-168): a detached turn outlives its parent killed hard, `exec resume <id>` goes on with the history, a resume of an unknown id fails instead of starting a new thread, `CODEX_HOME`, `rate_limits` and the context fill in the rollout. The rest:

### Chain sessions in the Codex app and on the phone (BTN-178)

That the Codex desktop app and the ChatGPT app on the phone do not list the chain's threads is read from the app-server protocol (`thread/list` without `sourceKinds` leaves `exec` threads out). Seen in the Windows desktop app (2026-10-23): `~/.codex/state_5.sqlite` holds 36 `exec` threads, the chain's TSK-20 among them, and the app lists none; the Coldbloom chain tasks it does list are its imports of Claude Code transcripts from `~/.claude/projects`, copies that never write back. Not seen on the phone. If an app lists them after all and the user writes there, that turn runs in the app's own app-server and appends to the same rollout: the page shows it in the feed, but Even Keel may `resume` the thread at the same time, and two turns on one thread is untested. **Workaround:** answer Codex sessions only from the page's chat or the tracker (`docs/sessions.md`).

### A package server and a Codex server of the same name

A Codex chain session called the Linear server of its package through the gateway (`-c mcp_servers.<name>.url=<gateway address>`) on a fresh install from the Windows service (BTN-161, 18.10.2026). If Codex also has a server of the same name in its own `config.toml`, which one wins is unknown. **Workaround:** remove that server from Codex's config or give the tools through the package alone (`docs/packages.md`).

### Sign-in from the page

`codex login --device-auth` runs through the panel's sign-in flow, whose reading of the link was written for Claude's output. Checked live from the Windows service (BTN-284, 2026-10-22, Windows Sandbox): signing the built-in `codex` account in from the page showed the link, the link worked and the account signed in. The one-time code is parsed out of the output (`loginCode`, BTN-313) and shown large with a "Copy" button; that parsing was written from the codex-cli 0.162.1 and opencode 1.18 binaries' format strings, not from a live sign-in. If a later CLI words it otherwise, the window shows no code box and keeps the CLI output unfolded, the code in it, as before. If a later Codex words its output otherwise and the window shows no link, sign in with `codex login` in a terminal with the same `CODEX_HOME` (`docs/accounts.md`). Adding an account into a new folder under `~/.codex-accounts` (BTN-176) was checked live on 2026-10-25 (codex-cli 0.164.0, Windows Sandbox): `codex login --device-auth` signed in the folder Even Keel made empty, and a second free sign-in was refused at once by the plan in its `id_token`, the folder removed.

### Codex on an OpenAI API key (BTN-177)

Checked with a fake key only: `codex login --with-api-key` writes the `auth.json` Even Keel writes, `codex login status` reads it, a turn on it goes to the API and fails with 401, and OpenAI's models list answers 401 to a fake key. Never seen with a real key: that a turn runs on it, whether its rollout has `rate_limits` (the card shows the spend instead either way), the price of the model it runs on in Tally, and Codex's message when the key's money runs out (BTN-195). That message is read from the codex-cli 0.162.1 binary ("Quota exceeded. Check your plan and billing details.", its `QuotaExceeded` for OpenAI's 429 `insufficient_quota`), and the money check — `/v1/responses` on a `nano`/`mini` model with `max_output_tokens: 16`, waiting for 2xx or a 429 `insufficient_quota` — was never run against a real key, empty or topped up. If Codex words it otherwise, the session stops like on any error, or, if the text has `quota` in it, its lamp says "limit" while the chain does not hold it (on a key only `credit` is held); if the check never says 2xx (the key lists no such model, the request shape is refused), the chain keeps waiting and the log has the check's reason. **Workaround:** top the key up and press "New session" on the task.

### A crashed turn and a service restart mid-turn

Liveness is the pid of the last turn: a pid reused by another process after a crash would keep the session busy.

A service restart mid-turn was checked live with the real service on Windows (BTN-284, 2026-10-22, Windows Sandbox, the service `EvenKeel` under a local user that is not an administrator): an update restarted the service while a chain session's Codex turn ran. `codex.exe` outlived its dead parent, the new service showed the session working, and once the turn ended it showed it waiting; an answer from the page's chat resumed the thread in about a second, the session merged its branch and Even Keel closed the task.

### Stopping a turn on macOS and Linux

For Codex, Copilot and OpenCode, the turn's process group is killed with `process.kill(-pid)`; it was run only on Windows (`taskkill /T`). During polling and before a stop, the process creation time is read from `/proc/<pid>/stat` plus boot time and `getconf CLK_TCK` on Linux, or `ps -o lstart=` on macOS, to leave a newer process that reused the pid alive. Neither platform's creation-time lookup has been checked live. If it fails, polling and stopping keep their previous behaviour and can mistake a reused pid for the turn; a wrong creation time can also leave the turn running. The equivalent Windows checks were verified with owned parent/child processes for all three adapters: a reused pid was shown resting and preserved even with a stale live result at stop, the current resumed turn was busy and its tree was killed, and trailing stderr did not hide a terminal event. **Workaround:** if an agent process has crashed, verify its pid and creation time in the operating system before stopping the session or cleaning up its task.

### Edit sizes of a FileChange (BTN-185)

Seen in rollouts: an `add` with the file's `content` (2026-10-18), and 146 `update`s of 13 chain sessions with a `unified_diff` that starts at its first `@@` hunk, with no `---`/`+++` header (codex-cli 0.164.0, 2026-10-25), whose `+`/`-` lines are counted (`src/codex/rollout.ts`). A `delete` was never seen; it is assumed to carry `content` too. If it does not, the chat shows the edit with no `+N −M` and leaves it out of the session's edit total; nothing else changes.

### Codex stats (BTN-170)

Checked on the rollouts on disk: 0.148 desktop sessions and 0.162 exec ones; on 0.164.0 (2026-10-25), the 12 finished chain sessions of a day had in Tally exactly their `token_usage_record` responses and token sums, and the turn refused at a limit, which writes one record and two equal `token_count` lines, was counted once. Never seen: a non-zero `cache_write_input_tokens` — it is assumed to be inside `input_tokens` and is subtracted from it; a rollout in `archived_sessions/`; a 0.162 rollout that has `token_count` lines without a matching `token_usage_record` (the fallback was run only on 0.148 files). If one of these differs, a Codex response is counted twice or its input is off. **Workaround:** none needed for the chain; compare `/stats` with the `usage` in the rollout and fix `src/rollout.ts` (`docs/tally.md`).

### Plugin hooks that block (BTN-180)

All five hook events of a plugin were seen running in Codex, and `additionalContext` reaching the model. Checked live on Windows with Codex 0.164.0 on 2026-10-25: a nested code-mode shell call ignored a `PreToolUse` exit code 2, while `permissionDecision: deny` blocked it before execution; `Stop` with `decision: block` continued the turn. The checkpoint plugin now uses explicit denial: a failed project check held the merge, a passing check allowed it, and the Stop guard saw a shell-written note in the rollout and made the session add `CHECKPOINT:` (`docs/sessions.md`). The Huly plugin's `show-calibration` denial was seen on a real MCP call from a chain session (BTN-387, 2026-10-25): the estimate was refused once with the calibration and the retry went through. `check-marks` now returns the same explicit denial (EKR-32); still unverified: its refusal on a real Codex MCP call. If ignored there, a malformed description reaches Huly. **Workaround:** check the description in Huly.

### Project standards on each agent (BTN-359)

The hooks of a project's standards (`docs/sessions.md`, "Project standards") were run by their tests with the inputs Claude Code documents, and live on Codex (0.164.0, 2026-10-25): four chain sessions had their first edit of a screen file refused with `docs/design.md` ("Not yet: … falls under the project's standard"). Assumed, per agent: Codex's compaction fires `SessionStart` with `compact`. Copilot runs the plugin's Claude-format hooks with its own tool names (`view`, `edit`, `create`, `str_replace`) and the path in `path`. OpenCode fires `session.compacted` after a compaction; its PR mode mark is not held, as its turn's end cannot be blocked. If a name or a field differs, that agent's session edits a guarded file without the document, or gets it only once per session; if a compaction is missed, the document is not given again after it. The merge's check is plain files and git and does not depend on the agent. **Workaround:** name the document in the task's text; the merge still waits for the shots and the answers.

### A patched handoff note seen by the Codex Stop hook

Checked live with Codex 0.164.0 on Windows on 2026-10-25: a shell write of the note was already in the rollout when the Stop hook asked `/api/sessions/<id>/note`, and the hook made the session add the mark. The timing of a last `FileChange` from `apply_patch` is still unverified. If that event has not reached disk, the hook lets the turn end. **Workaround:** end with `CHECKPOINT: .temp/handoff.md` explicitly, or press "New session".

### Plugins in a Codex folder on Linux and macOS

The install and the check that a plugin is already in a folder (`<CODEX_HOME>/plugins/cache/<marketplace>/<plugin>`) were run only on Windows. If the path differs, every first turn of a service run installs the plugin again, which costs a few seconds and changes nothing else.

## OpenCode stream errors in the account log (BTN-497)

After 30 seconds without an event or changed session row, the adapter reads newly appended account-log bytes for an `ERROR` / `stream error` belonging to that session and newer than its activity. A limit uses the existing limit recovery; another failure exposes a translated notice while preserving the live process for stop/resume. Parser and adapter tests cover attribution, incremental reads, persistence and classification. An isolated Windows process/SQLite check and fake-page screenshots cover the local path; a fresh real OpenCode provider refusal under the service has not been reproduced with this implementation. To verify, exhaust a free model in a test chain, confirm the limit lamp and retry plan, then confirm the old process is gone when the retry or account switch starts. Check an ordinary stream failure too. **Workaround:** answer from the chat or choose "New session" once the turn is idle; otherwise use the existing hang check.

## OpenCode

### OpenCode chain sessions under the service (BTN-214)

Checked on OpenCode 1.18.25 on Windows, the free `opencode/big-pickle`, by a script that drove the adapter from a terminal: a launch, a reply that starts with `-`, the transcript and the Tally rows; the session read the project's `CLAUDE.md`. The `checkpoint` package's OpenCode plugin and `Agent.write` (BTN-274) were checked the same way, against a stand-in for the service: the nudge and a chat message after a shell call, the message acted on and shown in the feed, a changelog-style turn with its session deleted after it — never a real handoff. Messages from the page, text and a picture, reached chain sessions of the service on 2026-10-27 ([verified log](verified.md#opencode)). The plugin's merge check and `CHECKPOINT` line (BTN-288) were checked the same way: a merge of the task branch into a main checkout outside the folder refused by a failing check of a few seconds, and the line added to the last text of a turn that wrote the note. Never a check that passes and lets the merge run, and never one that runs for minutes: if OpenCode gives up on a plugin hook it awaits that long, the merge either runs unchecked or fails with OpenCode's error instead of the check's. On 2026-10-25 two tasks of a Linear project ran whole as chain sessions of the Windows service (session 0) on the free `opencode/deepseek-v4.1-flash-free`: each read its issue through the Linear package's MCP server on the gateway, committed, merged into the main checkout and posted its closing comment, and Even Keel closed it; the second turn went on through a restart of the service and its gateway five seconds into it, and the milestone's changelog draft ran as a one-off turn on the same model. Never on Linux and macOS, never on a ChatGPT, Copilot or API-key account, never with plugin skills in `skills.paths`. **Workaround:** run the task on another provider (a run label) and open an issue with the output.

### A spent limit on OpenCode

An OpenCode account signed in to ChatGPT or Copilot has its windows read from the provider (BTN-341, the entry below), so a limit waits for their reset; one on OpenCode Zen has none and no reset time, so the chain tries it again after 15 minutes, doubling the wait up to 4 hours while it keeps hitting the limit (BTN-342, `docs/chain.md`, exception 1). The fold recognizes limit text, a 429 `statusCode` or `FreeUsageLimitError`. On 2026-10-27 a real free-model refusal appeared only in the account log as `AI_APICallError: Free usage limit reached`, with no turn event or database error and a process that stayed alive. The log fallback above (BTN-497) covers that path locally; recovery from a fresh real refusal under the service and a limit stored in the database remain unverified. Zen's free limits are published nowhere, so the waits are a guess: a limit that resets in minutes waits up to the next retry, a daily one is tried a few times in vain. **Workaround:** wait for the reset and press "New session".

### OpenCode's Copilot limits (BTN-341)

An OpenCode folder signed in to Copilot is asked `api.github.com/copilot_internal/user` with the `github-copilot` token of its `auth.json`, the one GitHub's editors read (`docs/sessions.md`, "Limits of OpenCode and Copilot"), an internal endpoint whose shape is taken from what others have published. If its answer has no `quota_snapshots` or free-plan counts, the card says the answer was not read, and the chain waits on a limit as before, with no reset time. **Workaround:** none needed for the chain; the card's numbers are on GitHub's site.

The ChatGPT side was checked in Windows Sandbox on 25.10.2026 (OpenCode 1.18.25, a Plus account): the folder's `openai` token got the five-hour and weekly windows from `wham/usage` (`source: "api"`), and the card's pool was the same `chatgpt:<account id>` as the Codex card of that account.

Copilot Free's chat allowance (`limited_user_quotas`, `monthly_quotas`) and the switch of paid plans to AI credits in June 2026 were not seen in an answer: a plan whose allowance moved elsewhere shows "no data".

### The OpenCode model check (BTN-336)

A launch or a resume on an OpenCode model that `opencode models` of the account does not list is refused: the chain pauses with `chain.unknownModel` (`docs/sessions.md`, "Model lists"). Checked from a terminal on OpenCode 1.18.25 on Windows with a free OpenCode Zen account (nine models listed, a made-up one refused), and on ChatGPT Plus in Windows Sandbox on 25.10.2026: the chain launched a task on `openai/gpt-6.1-sol`, one of the 17 `openai/*` models listed; the list omits `gpt-6-sol`, `gpt-6-astra` and `gpt-6-luna`, which Codex's own model list offers the same plan, but `opencode run -m openai/gpt-6-sol` fails there with an `UnknownError`, so refusing them is right. Never on a Copilot or API-key account: if `opencode models` there omits a model the account can run (one set by `opencode.json`, a provider that lists lazily), the task is refused although its session would work. **Workaround:** leave the model field empty so the session runs on OpenCode's default, and open an issue with the output of `opencode models`.

### A hung OpenCode turn

A live turn that has changed no row of its session and written no event for 30 minutes is taken for hung: the session shows as idle with a note, and writing to it or "New session" kills the turn first (`docs/sessions.md`). Built from the database's shape and never seen with a real hang: whether OpenCode retrying a refused request touches the rows meanwhile (then the watchdog never fires), and whether a tool that runs longer than 30 minutes, a long build or test run, really writes nothing (then a working turn is taken for hung, and in unattended mode the chain stops waiting for it 10 minutes later). **Workaround:** for a hang the watchdog misses, kill the turn's `opencode` process and press "New session"; a long build that is not hung goes on regardless — nothing stops it, unless someone writes to the session or presses "New session".

### OpenCode sign-in from the page

ChatGPT's headless method was checked from the page in Windows Sandbox on 25.10.2026 (OpenCode 1.18.25): the window got the device link and its code, and the sign-in landed in the account's folder. Copilot's `opencode providers login` was run only in a terminal, not through the page: the window shows the CLI output unfolded and looks for a link in it, as for Codex. Copilot first asks between GitHub.com and Enterprise, and Even Keel answers with Enter after 3 seconds; if the question comes later or changes, the sign-in waits for good. **Workaround:** cancel it and sign in in a terminal with the folder's four `XDG_*_HOME` variables pointing into it (`docs/accounts.md`).

### The OpenCode database read while a turn writes

Even Keel and Tally open `opencode.db` read-only while OpenCode writes it in WAL mode. A read during a checkpoint of the WAL may fail with "database is locked"; the feed then keeps its last state until the next poll, and a stats run logs the file as failed and reads it next time. Never seen in the checks.

## Copilot

### Copilot chain sessions under the service (BTN-215)

Whole tasks ran as chain sessions of the Windows service on the machine's own sign-in, which reached session 0 ([`verified.md`](verified.md), "Copilot"). Never run on a folder with a token, never resumed inside the chain (a resume was checked from a terminal only), never on Linux or macOS, where the sign-in sits in another store and may not reach a service. **Workaround:** add the Copilot account with a fine-grained token, or run the task on another provider (a run label).

### Hooks and plugins in Copilot sessions

The checkpoint package's hooks from `--plugin-dir` run at every step of a chain session, and plugin skills load ([`verified.md`](verified.md), "Copilot"). Copilot drops `hookSpecificOutput.additionalContext` on `PostToolUse` and takes a top-level `additionalContext` on every event (a probe plugin, `verified.md`), so since BTN-467 Even Keel starts Copilot with `EVEN_KEEL_AGENT=copilot` and the hooks answer in the top-level shape there (`contextOutput`, covered by tests). Not yet seen: the package's own mail, context nudge and standard reaching a Copilot model that way, a `Stop` block's reason becoming the next prompt, repository hooks from `.claude/settings.json`, an actual threshold crossing. Check from a terminal: the plugin with `--plugin-dir`, `EVEN_KEEL_AGENT=copilot` and `EVEN_KEEL_URL` on a stub whose `/mail` answers one message on the first `PostToolUse` and one on the first `Stop`; ask for a file's contents and look for both messages in the answer. If either is missing, the mail is marked delivered and lost. **Workaround:** keep Copilot for short tasks; send messages between turns, and resend one sent mid-turn.

### MCP servers in Copilot sessions

The packages' servers reach a Copilot chain session through `--additional-mcp-config` and their tools are called ([`verified.md`](verified.md), "Copilot"). The project's own servers are turned off one by one with `--disable-mcp-server`, since Copilot has no strict mode; this was read from `--help`, not run: the repository of the check had no `.mcp.json`. If the flag is taken otherwise, a session starts the project's own server beside the gateway's. **Workaround:** take the project's `.mcp.json` servers out while it runs on Copilot.

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

### MCP through OAuth on a tracker profile (BTN-475)

The flow, the refresh and the gateway's Bearer header are checked by tests against fake providers (`src/profiles/oauth.test.ts`, `oauth-protocol.test.ts`, `src/packages/gateway.test.ts`), and the dialog on `dev:fake`. Rovo's v2 flow through protected-resource metadata, consent, token exchange, refresh rotation and MCP access was checked by probes on 2026-10-27 (BTN-416, [verified log](verified.md#trackers)). BTN-485 applies that discovery in the service; its implementation's discovery and public-client registration with the advertised scopes passed against live Jira and Linear on the same date. BTN-490 additionally checked the running service's starts and guard refusals from localhost and an HTTPS proxy, site access with the saved v2 profile through its gateway, and two consecutive live refresh rotations through isolated instances of the actual profile service and gateway. Assumed:

- Jira v2 requires the same organization-admin domain allowlist as the older authorization server for an HTTPS callback other than localhost. Profile-dialog consent and saving passed on localhost and external HTTPS in BTN-490, confirmed by the user; the external callback domain was already allowed in the organization, so the need for that allowlist remains unchecked (BTN-495);
- Linear accepts consent and returns a code for its registered public client with an `http://localhost:4747/…` or an HTTPS Tailscale callback (discovery, S256, issuer requirement and localhost registration are checked);
- Linear's token endpoint accepts `resource` (RFC 8707) and answers `token_type: Bearer`, with a refresh token;
- GitHub's MCP server (`api.githubcopilot.com/mcp/`) accepts the OAuth App's `gho_` token with the scopes `repo read:org`, and GitHub's `access_token` answer in JSON is enough (no refresh token, no expiry);
- Linear and GitHub complete a fresh browser callback through the HTTPS proxy. Jira's proxy callback and matching `Host`/`Origin` passed in BTN-490, but loopback proxy requests need no cookie. Direct network access is a known failure, not an assumption: the guard issues `SameSite=Strict`, Chromium omits it on the provider's cross-site redirect and the callback receives 401 (BTN-494; [verified log](verified.md#trackers));
- a refused refresh or a second 401 marks the grant for reconnecting, and a session's tool call meanwhile fails with an MCP error rather than hangs.
- The profile dialog's Check and Save verify the selected MCP OAuth grant against the live providers, including an expired unsaved grant refreshed before its original ten-minute deadline (BTN-491). Refresh, refusal, Jira site access and JSON/SSE probe errors have regression coverage; dialog grouping, status, saving and close confirmation passed on `dev:fake`, but this new Check path has not been exercised against a live provider. If it refuses working access, reconnect in the dialog or disconnect OAuth and use the fallback token.

If one is wrong, the button ends in "MCP OAuth did not complete" or the profile's row says "MCP access lost" soon after; sessions get no tracker tools while REST keeps working. **Workaround:** disconnect OAuth in the profile and use the MCP token (Jira: Atlassian MCP V2 token; GitHub, Linear: the profile's token).

### Two profiles of one tracker (BTN-200)

Two projects on two Huly profiles (two workspaces) were run in Windows Sandbox (2026-10-25): each its own connection, and each project's gateway server listing its own workspace's projects. Not run: two GitHub profiles, where each project's GitHub Actions runs should be read with its own profile's token — covered by tests. If a project's CI reads with another profile's token (a private repository's runs do not show), **workaround:** keep one GitHub profile.

### Task feeds from another tracker (BTN-66)

A GitHub feed of a Huly project ran as a live chain (BTN-326, 2026-10-23): the feed was read on its own profile, that profile's required and excluded labels sorted its issues while the Huly tasks kept the project's rules, its task and a Huly one ran in one chain by priority, its session got the brief with the `Tracker: GitHub, project <owner>/<repo>` line, it was closed in GitHub after the merge, `fillMilestone` filled a feed issue's milestone from another feed issue, the `/status` page showed three connections with the feed under its tracker, and Tally named it by its own id with its title and link (its status and "done" stay empty: Tally reads them from Huly only).

Not seen live: a feed on a second Huly workspace (whether a session reads it through the brief when no server signed in as its profile is brought), PR mode and a question in a tracker comment for a feed's task (both go to the feed's tracker by code), run labels on a feed's task, and the Tally check's "failed" and "halted". If a feed's session cannot read its task, **workaround:** set the project's `brief` to `true`; if its pull request or question lands in the wrong tracker, close the task in its tracker by hand.

### A removed key and the global folder's daemon

A removed key also stops the global folder's daemon (`claude daemon stop --any` with the global `CLAUDE_CONFIG_DIR`, from the service); that stop was never run from the service — if it fails, the log has the error and the removed key stays with sessions of that folder until its daemon exits (`docs/accounts.md`). **Workaround:** stop the daemon by hand once no session of the folder is live.

### GitHub attachments of a private repository

Downloading a file attached to an issue comment through the page's file route with the token ran live on a public repository (BTN-278, 2026-10-24): an image came back whole, `inline`. GitHub serves such a file of a public repository without a token too, so that the token gets a private repository's file has not been tried; if it does not, the page cannot open that file (`docs/trackers.md`).

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
