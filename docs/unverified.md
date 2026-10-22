# What has not been verified

Even Keel is checked live on the author's machine with the author's accounts. Some behaviour could not be checked there: the situation never came up, or there was no way to create it. This page lists it, so you know where Even Keel works on an assumption. Each entry says what is assumed, what happens if the assumption is wrong and what to do about it.

If you run into one of these, please open an issue with what you saw: it is the only way the entry gets checked.

## What to check first

Every entry, ordered by how many people it reaches and how badly it hurts them if the assumption is wrong: the lower the number, the sooner it should be checked and the more a run into it costs. Each row links to the entry.

| # | Entry | Who it hits | If the assumption is wrong |
| ---: | --- | --- | --- |
| 1 | [An early reset of a limit](#an-early-reset-of-a-limit) | everyone on a subscription | the chain waits hours for a reset that already came |
| 2 | [Staying signed in after a reboot](#staying-signed-in-after-a-reboot-ekr-15) | everyone on a subscription | accounts ask to sign in again after a reboot |
| 3 | [macOS](#macos) | macOS | the service or the CLI lookup may not work at all |
| 4 | [Codex chains beyond short tasks](#codex-chains-beyond-short-tasks) | Codex | sessions cannot run commands, or run with no sandbox |
| 5 | [Errors and limits in the rollout](#errors-and-limits-in-the-rollout) | Codex | a limit looks like a finished turn, the task waits for you |
| 6 | [Plugin hooks that block](#plugin-hooks-that-block-btn-180) | Codex | a merge goes in before the project's check |
| 7 | [Chain sessions on the checked CLI](#chain-sessions-on-the-checked-cli-btn-250) | everyone | sessions run on an unchecked CLI version |
| 8 | [The update button on the page](#the-update-button-on-the-page-btn-163) | Windows and macOS updating from the page | the service stays stopped after an update; start it by hand |
| 9 | [The wizard's trust check](#the-wizards-trust-check) | new users | a pause at the first launch |
| 10 | [A chain session reaching the agent's own compaction](#a-chain-session-reaching-the-agents-own-compaction) | everyone | a session loses the task's decisions after a compaction |
| 11 | [Chat mail in a real session](#chat-mail-in-a-real-session-btn-181) | everyone writing to a session about to hand off | the handoff waits a turn longer |
| 12 | [Background commands of a stopped session on Linux and macOS](#background-commands-of-a-stopped-session-on-linux-and-macos-btn-202) | Linux, macOS | a worktree is left behind after Done |
| 13 | [Packages on Linux and macOS](#packages-on-linux-and-macos) | Linux, macOS with packages | the chain waits on a package that does not start |
| 14 | [Stopping a turn on macOS and Linux](#stopping-a-turn-on-macos-and-linux) | Codex on Linux, macOS | a stopped Codex turn goes on |
| 15 | [PR mode beyond GitHub's open, close and merge](#pr-mode-beyond-githubs-open-close-and-merge-btn-205) | PR mode | feedback does not reach the session; a task waits out of the chain |
| 16 | [A task back from Backlog after a question in a comment](#a-task-back-from-backlog-after-a-question-in-a-comment-btn-245) | unattended mode | the answered task waits instead of going on |
| 17 | [A resume that starts a copy](#a-resume-that-starts-a-copy) | everyone, rarely | "Session booting" for 5 minutes after an answer |
| 18 | [A chain session on an API account](#a-chain-session-on-an-api-account) | Claude API keys | every session fails on authentication |
| 19 | [Sessions through the Agent SDK](#sessions-through-the-agent-sdk-btn-239) | Claude API keys, subscriptions that turn it on | over a long run a session hangs where `--bg` would not, or a resume loses its Remote Control chat |
| 20 | [An API key out of credit](#an-api-key-out-of-credit-btn-165) | Claude API keys | the chain stops instead of waiting for a top-up, or waits forever |
| 21 | [Codex on an OpenAI API key](#codex-on-an-openai-api-key-btn-177) | Codex API keys | a session stops on an empty key, or the chain waits forever |
| 22 | [A key refused after it was added](#a-key-refused-after-it-was-added) | Claude API keys | a revoked key looks fine until a session fails |
| 23 | [A command after a green main that restarts Even Keel](#a-command-after-a-green-main-that-restarts-even-keel) | a restart in `commands.afterGreen` | the service stays stopped |
| 24 | [When a CI run counts as stuck](#when-a-ci-run-counts-as-stuck) | CI with a slow runner queue | a run is called stuck too early |
| 25 | [Chains of several projects on one remote](#chains-of-several-projects-on-one-remote-btn-210) | several projects on one remote | a project waits on another's fix, or two fixes of the same red `main` |
| 26 | [A package server and a Codex server of the same name](#a-package-server-and-a-codex-server-of-the-same-name) | Codex with packages | a session gets the wrong server of a name |
| 27 | [Sign-in from the page](#sign-in-from-the-page) | Codex | no sign-in link in the window |
| 28 | [A crashed turn and a service restart mid-turn](#a-crashed-turn-and-a-service-restart-mid-turn) | Codex | a dead session looks busy |
| 29 | [Chain sessions in the Codex app and on the phone](#chain-sessions-in-the-codex-app-and-on-the-phone-btn-178) | Codex | two turns on one thread if you answer in the app |
| 30 | [Chat mail at a Codex Stop](#chat-mail-at-a-codex-stop-btn-181) | Codex | a message sent at the end of a turn is lost |
| 31 | [The handoff note of a Codex turn seen by the Stop hook](#the-handoff-note-of-a-codex-turn-seen-by-the-stop-hook) | Codex | a note without the `CHECKPOINT:` line waits for a reply |
| 32 | [The chat's turn line on Codex and after the chain stopped](#the-chats-turn-line-while-an-answer-is-delivered-to-codex-or-after-the-chain-stopped-btn-188) | Codex, a stopped chain | the chat says "delivering" for up to three minutes |
| 33 | [Plugins from a git URL marketplace](#plugins-from-a-git-url-marketplace) | a marketplace added by URL | sessions keep an old plugin |
| 34 | [A tracker profile changed on the Access page](#a-tracker-profile-changed-on-the-access-page-btn-200) | anyone changing a key | the tracker stays "does not answer" until a restart |
| 35 | ["Add to Claude Code" on /tools](#add-to-claude-code-on-tools-btn-226) | new users running the service | the banner stays; run its command by hand |
| 36 | [Two profiles of one tracker](#two-profiles-of-one-tracker-btn-200) | two accounts of one tracker | a project reads another profile's tasks |
| 37 | [A project's own CI profile](#a-projects-own-ci-profile-btn-231) | two forge profiles | the CI or a pull request uses the old profile |
| 38 | [Carrying a release project forward](#carrying-a-release-project-forward-btn-172) | release projects | a fix stays out of the main branch; carry it by hand |
| 39 | [Several projects on one tracker project](#several-projects-on-one-tracker-project-btn-172-btn-73) | two projects on one Huly project or Linear team | a task in both chains, or in neither |
| 40 | [Task feeds from another tracker](#task-feeds-from-another-tracker-btn-66) | projects with a task feed | a feed's task is not closed, or its session cannot read it; stats name it wrong |
| 41 | [Removing a project on the running service](#removing-a-project-on-the-running-service-btn-118) | anyone removing a project | a removal goes through while a session works |
| 42 | [A changed EVEN_KEEL_TOKEN seen from another machine](#a-changed-even_keel_token-seen-from-another-machine-btn-130) | the page from another machine | a dead connection until a reload |
| 43 | [A remote added to a checkout on the running service](#a-remote-added-to-a-checkout-on-the-running-service-btn-191) | CI | the CI does not appear until a restart |
| 44 | [The context window a chain session gets](#the-context-window-a-chain-session-gets-btn-187) | everyone | the context meter and the handoff cap read a wrong window |
| 45 | [A task closed by `NO CHANGES:`](#a-task-closed-by-no-changes-ekr-10) | everyone outside PR mode | a task with nothing to merge waits for you, as before the mark |
| 46 | [A session waiting on you behind a monitor](#a-session-waiting-on-you-behind-a-monitor) | everyone, rarely | a session waiting for its own build shows "waiting"; a reply or unattended mode cuts the build short |
| 47 | [The 1-hour cache on a key](#the-1-hour-cache-on-a-key) | Claude API keys with `cacheTtl` | more cache writes; nothing breaks |
| 48 | [Outsiders' comments on a public GitHub repository](#outsiders-comments-on-a-public-github-repository-ekr-19) | PR mode on public GitHub repositories | your own review is skipped, or an outsider's reaches a session |
| 49 | [Milestones on GitHub and Linear](#milestones-on-github-and-linear) | GitHub, Linear | a task's milestone is not filled |
| 50 | [Changing a milestone from the task card on GitHub and Linear](#changing-a-milestone-from-the-task-card-on-github-and-linear) | GitHub, Linear | the card puts the old milestone back |
| 51 | [The tasks of a milestone on GitHub and Linear](#the-tasks-of-a-milestone-on-github-and-linear-btn-142) | changelog drafts on GitHub, Linear | the draft misses tasks or takes an older comment |
| 52 | [GitHub attachments](#github-attachments) | GitHub | the page cannot open an attached file |
| 53 | [The expiry of a fine-grained GitHub token](#the-expiry-of-a-fine-grained-github-token) | GitHub fine-grained tokens | no expiry on the card |
| 54 | [The Codex changelog turn with JSON output](#the-codex-changelog-turn-with-json-output) | changelog drafts on Codex | the draft fails, or shows 0 tokens |
| 55 | [A reader opening the state database while the service starts](#a-reader-opening-the-state-database-while-the-service-starts) | `npm run storage` users | the service stays blocked until a restart; at worst two writers on one database |
| 56 | [OpenCode chain sessions under the service](#opencode-chain-sessions-under-the-service-btn-214) | OpenCode | sessions do not start, or a whole task runs on a wrong assumption |
| 57 | [A spent limit on OpenCode](#a-spent-limit-on-opencode) | OpenCode on ChatGPT or Copilot | the session stops on the error instead of waiting for the reset |
| 58 | [A hung OpenCode turn](#a-hung-opencode-turn) | OpenCode | a hang the watchdog misses stays busy, or a long build is taken for hung |
| 59 | [OpenCode sign-in from the page](#opencode-sign-in-from-the-page) | OpenCode with ChatGPT or Copilot | no link in the window; sign in in a terminal |
| 60 | [Plugins in a Codex folder on Linux and macOS](#plugins-in-a-codex-folder-on-linux-and-macos) | Codex on Linux, macOS | a few seconds per first turn |
| 61 | [Edit sizes of a FileChange](#edit-sizes-of-a-filechange-btn-185) | Codex | the chat shows an edit without its size |
| 62 | [Codex stats](#codex-stats-btn-170) | Codex | a response counted twice in `/stats` |
| 63 | [Fast mode in statistics](#fast-mode-in-statistics) | fast mode | `/stats` understates its cost |
| 64 | [The first start with the PGlite state database](#the-first-start-with-the-pglite-state-database-btn-198) | an update from a build before v0.1 | the start stops on an import error |
| 65 | [The first start with Forgejo profiles](#the-first-start-with-forgejo-profiles-btn-201) | an update from a build before v0.1 with Forgejo | the Forgejo CI disappears from the page |
| 66 | [PR mode without a remote](#pr-mode-without-a-remote-ekr-12) | PR mode | the chain stays paused after the remote is added; press Resume |
| 67 | [The OpenCode database read while a turn writes](#the-opencode-database-read-while-a-turn-writes) | OpenCode | the feed or a stats run skips one poll |
| 68 | [Shared skills in a store outside `~/.claude`](#shared-skills-in-a-store-outside-claude-btn-256) | several Claude account folders | a shared skill edit still asks; at worst the global folder's sessions miss skills |
| 69 | [Copilot chain sessions under the service](#copilot-chain-sessions-under-the-service-btn-215) | Copilot | sessions do not start without a token |
| 70 | [Hooks and plugins in Copilot sessions](#hooks-and-plugins-in-copilot-sessions) | Copilot | no handoff on a full context, chat messages only between turns |
| 71 | [MCP servers in Copilot sessions](#mcp-servers-in-copilot-sessions) | Copilot with packages | a session lacks the tracker's tools |
| 72 | [A spent Copilot budget](#a-spent-copilot-budget) | Copilot | the session waits for good; press "New session" |
| 73 | [A Copilot turn killed mid-turn](#a-copilot-turn-killed-mid-turn) | Copilot | the resume fails; press "New session" |
| 74 | [Copilot installed with npm](#copilot-installed-with-npm) | Copilot from npm | the first turn fails; set `EVEN_KEEL_COPILOT_BIN` |
| 75 | [Copilot models in the stats](#copilot-models-in-the-stats) | Copilot on Claude models | `/stats` shows no cost for them |

## Platforms

### macOS

`service/install.sh` installs a launchd agent there, but Even Keel has never run on a Mac: neither the agent nor finding the CLI and its folders.

## Updating

### The update button on the page (BTN-163)

Checked live on Linux (BTN-272, 2026-10-22): a real Even Keel under its systemd user unit (`install.sh`, Ubuntu 26.04 in WSL), the button pressed through the page's API, updating to the latest GitHub release with the tag served by a local origin. An update whose build failed and one whose service never answered were both rolled back to the commit they started from, an update that went through offered "Revert", and the revert went through; the process outlived the stop of the unit each time, and the page showed every outcome (`docs/service.md`, "Updating from the page"). On Windows the CI's rebuilds by `service/rebuild.ps1` (2026-10-22, three times) stopped and started the real service `EvenKeel` from the update process and waited for the chains, without new dependencies.

Not checked: the button on Windows, where the process is started by the service itself, runs as the service's account and must outlive the host killing node, and where `npm ci` runs with the service stopped; a rebuild with new dependencies (`npm install` with the service stopped); a launchd agent — the stop is `launchctl bootout`, which may also end processes of the agent's group despite `AbandonProcessGroup`, and then the update stops halfway with the service down; the wait for a chain in a launch before the process starts; a revert release (`### Reverted` in its notes) shown on the page, since GitHub has none yet.

If it is wrong: the page stays on "updating…" and the service does not come back. Start it by hand (`Start-Service EvenKeel`, `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.even-keel.plist`), see `logs/update.log`, and if the checkout is on the new tag but the build failed, finish by hand: `npm ci`, `npm run build`, start.

### Plugins from a git URL marketplace

A marketplace added from a local path is read from its folder, so an update of the code reaches the plugins by itself; that was checked. One added from a git URL (`owner/repo`, `https://…`) keeps a copy by version, and README tells you to run `claude plugin marketplace update even-keel` and `claude plugin update <plugin>@even-keel` in each project. The commands were run, but a copy that is actually behind was never brought up to date with them. If sessions still run the old plugin, `claude plugin uninstall … --scope project` and `claude plugin install … --scope project` in the project install the current one.

### The first start with the PGlite state database (BTN-198)

The import of `state/even-keel.db` into `state/even-keel/` was tested on the frozen samples and run on a copy of the author's live state (889 launches, 93 handoff snapshots, 10 closed tasks: every table came over whole); backup and export through a live owner, a reader in a worker thread of the owner's process (the way Tally's collector reads) and a restore of the backup were checked on that copy. Not yet by the service itself after an update, with its page and a restart in the middle (`docs/storage.md`). If the start stops on the page with an import error, the file is untouched and nothing was written. **Workaround:** if the state looks wrong after the import, stop Even Keel, delete `state/even-keel/`, rename `even-keel.db.imported` back to `even-keel.db` and start the previous version.

### A reader opening the state database while the service starts

With no service running, `npm run storage` or a collector run outside the service opens the folder itself for the seconds it reads. Checked on a second instance on 22.10.2026 with a reader holding the folder: the service started in those seconds starts nothing and writes nothing, the page shows "process … holds the database" and the API answers 503, and it stays so after the reader closes, until the service is restarted. Not seen in a real run: the reader and the service starting within the same second, before either has written `owner.json` — two readers started together both opened the folder (BTN-301); with the service as one of them, two processes would write into one database. **Workaround:** restart the service once the reader has finished; run `npm run storage` only while the service runs or well after it stopped, not while it starts.

## The page

### A changed EVEN_KEEL_TOKEN seen from another machine (BTN-130)

Checked live: the service reads the new token from `.env` and logs it. Not checked: the open event streams closed on the change, and a browser on another machine with the old token's cookie getting the token form when its page reconnects, since every request from the author's machine, to any of its addresses, passes without a token. If the page keeps showing a dead connection instead, reload it; the form comes on the next page load.

### Removing a project on the running service (BTN-118)

Adding a project was checked on a fresh install from the Windows service (BTN-161, 18.10.2026): the wizard on an empty database, and projects of Huly, GitHub and Linear each taking their first task. The removal is covered by tests and was looked at on fake data only: a removal refused by a real live session was never run. If a removal goes through while a session works there, **workaround:** `npm run storage -- config-export`, edit the file, `config-import` it — the service applies it on the fly.

### The wizard's trust check

It reads only the global `~/.claude.json`, not the account folders' copies, and it does not check Codex's trust at all. Seen live on 22.10.2026: `claude` started with an account folder's `CLAUDE_CONFIG_DIR` records the accepted trust dialog in that folder's `.claude.json` only, so a folder trusted that way shows the warning although the chain's account trusts it (BTN-300). The warning does not hold the add: if you trusted the folder under the account the chain runs on, add it anyway. Not seen: a folder that passes the check but is not trusted for the chain's account, pausing the chain at its first launch. **Workaround:** if it does, open `claude` once in the folder with that account's `CLAUDE_CONFIG_DIR`, accept the dialog and press Resume.

## Accounts

### Staying signed in after a reboot (EKR-15)

On 21.10.2026 a reboot signed two of three subscription accounts out: the service started before the network, every account's `claude auth status` timed out at once, and a minute later two `.credentials.json` held neither an access nor a refresh token. The CLI renews with a single-use refresh token, so Even Keel assumes the sign-in was lost to a renewal cut off half-way or run twice at once, and guards against both: it asks no account and no `/usage` until the provider's API answers, runs its short calls of one folder one at a time and does not kill one on a timeout (`docs/accounts.md`). Neither the cause nor the guard has been seen live: a reboot with expired tokens and no network at the start was not repeated. If an account still asks to sign in after a reboot, the cause is elsewhere. **Workaround:** sign the account in again from the accounts drawer.

### Shared skills in a store outside `~/.claude` (BTN-256)

The transfer moves every skill of `~/.claude/skills` kept as a real folder into `~/.claude-skills/<name>` and links both the global folder and the account folders to it, the way memory went to `~/.claude-memory` (`docs/accounts.md`). The move was covered by tests only: the session that wrote it was not allowed to touch the real `~/.claude/skills`. Assumed, from the memory store checked on CLI 2.1.296: a session in an account folder now edits a shared `SKILL.md` without a question, a session without `CLAUDE_CONFIG_DIR` too, and the CLI loads skills through a link in `~/.claude/skills` as it already did through one in an account folder. If the first is wrong, nothing is worse than before; if the last is, the global folder's sessions lose those skills. **Workaround:** move the folders from `~/.claude-skills` back into `~/.claude/skills` in place of the links.

## Claude limits

### An early reset of a limit

Anthropic sometimes resets a five-hour window or all limits of an account ahead of time. When a session hits a limit, the chain remembers the reset time from the error or from `/usage` and waits for it; what `/usage` shows right after an early reset has never been seen. If it shows a new window or no window, the remembered time is not updated and the chain keeps waiting until the original reset. **Workaround:** press "New session" on the task — it drops the remembered wait and starts a session at once; or switch the account.

### Fast mode in statistics

Responses in fast mode are recorded (`speed = fast`), but none have appeared in the data, so `/stats` prices them as normal responses and their cost is understated (`tally/CLAUDE.md`).

## Sessions

### A task closed by `NO CHANGES:` (EKR-10)

A task with nothing to merge is closed by its session's last line `NO CHANGES: <why>` out of PR mode (`docs/chain.md`, "Nothing to merge"). The reading of the mark, the check of the worktree and the move to Done are covered by tests, not run with a live session and tracker: whether a session writes the mark on its own when the task turns out done already, and whether the comment lands in each tracker. If a session ends such a task without the mark, the chain waits on it as before. **Workaround:** move the task to Done in the tracker yourself, or answer the session in the chat to end its turn with the mark.

### A resume that starts a copy

A resumed session in place was seen to show a fresh session id for under a second before it takes its old one, and the chain now waits for the old id (`docs/sessions.md`). When the CLI starts a copy instead (a new job), the chain takes the first session of that new job; whether a copy also passes through a throwaway id first was not seen. If it does, the chain follows an id with no transcript: the chat says the transcript is not found and the card shows "Session booting" for 5 minutes. The workaround is "New session".

### A chain session on an API account

The CLI was seen to take a key from the account folder's `settings.json` (`claude auth status` says `api_key`, BTN-99) and a `--bg` session was seen to work on a key passed in its environment (BTN-136), but a chain session started from an API account folder with a real key was not run. Every session, a respawned one too, reads the folder's `settings.json` `env` at its start (BTN-129); if the CLI still does not authenticate a chain session with the key from there, the session fails at its first request with an authentication error and stops like any error. **Workaround:** set the key in that folder with `apiKeyHelper` or run the chain on a subscription account (`docs/accounts.md`).

### Sessions through the Agent SDK (BTN-239)

Run live from the service on Windows (CLI 2.1.308, SDK 0.3.308, Haiku, 2026-10-22): a session outlived `Restart-Service EvenKeel` while it waited on its question and the answer from the page went into it without a resume; another outlived three restarts mid-turn, one of them a 28 s stop over the end of a long command, and finished the turn (`docs/sessions.md`). Not run: a night of the chain on the SDK against `--bg`; the service down long enough for the CLI's output to pass 1 MB and go to the spill file; an answer through Remote Control from the phone and the reattach to the same chat after a resume; the Unix socket on Linux and macOS; a chat message from the page straight into a working session (BTN-291 — the same push was seen taken mid-turn only from a terminal). If that message is dropped, the chat keeps it as sent and the session never answers it: send it again once the turn ends. If a long run fails where `--bg` would not, the card shows the session busy and replies do not reach it; if the reattach fails, a resumed session opens a new Remote Control chat. **Workaround:** "New session" on the task; switch the account to `CLI --bg` on the Accounts page, which new sessions follow.

### The 1-hour cache on a key

`cacheTtl: "1h"` goes to sessions as `promptCacheTtl`, which the CLI 2.1.302 binary honours whatever the sign-in; that a session on a key then really writes the 1-hour cache (`ephemeral_1h_input_tokens` in the transcript) was not checked with a real key. If it does not, sessions on a key keep the 5-minute cache and `/stats` shows more cache writes than expected; nothing breaks (`docs/sessions.md`).

### A key refused after it was added

The check of a key was seen live answering 200 for a working key and 401 for a made-up one; 403 (a disabled organization or a key without the permission) and a key revoked after it was added were never seen. If a revoked key still answers 200 on the models list, the account looks fine until its first session fails on authentication and stops like any error (`docs/accounts.md`). **Workaround:** remove the account and add a working key.

### An API key out of credit (BTN-165)

Read from CLI 2.1.302, never seen with a key at zero: the API answers 400 "Your credit balance is too low…", and the CLI writes an error message with `error: "billing_error"` and the text "Credit balance is too low", which Even Keel takes as `credit` and waits out like a limit (`docs/chain.md`, exception 1). The check that the credit is back — one output token through `/v1/messages`, an answer of 2xx — was never run against a topped-up key either. If the CLI words it differently, the session stops like any error; if the check never says 2xx, the chain keeps waiting. **Workaround:** press "New session" on the task after the top-up, or switch the account.

### The chat's turn line while an answer is delivered to Codex or after the chain stopped (BTN-188)

Seen live on a Claude chain session (BTN-189, CLI 2.1.302): a text answer and an `AskUserQuestion` answer were each in the transcript 8 s after the send, and the line went from "Delivering the answer" to "Thinking" then (`docs/web.md`). Not run on a Codex session nor on an answer to a session whose chain stopped (`deliverLoose`). It assumes the respawned session writes its prompt (or the answer's result) with a time after the moment the service began the delivery. If it does not, the line keeps saying the answer is on its way for up to three minutes while the session works; nothing else is affected.

### Chat mail in a real session (BTN-181)

Seen live on 22.10.2026 on Haiku `--bg` sessions (TSK-24, TSK-27): a message waited for the hook through a 90-second Bash call and went in at its `PostToolUse`; one sent while the closing text streamed went in at `Stop`, and one sent before a question went in at that `AskUserQuestion`'s `PreToolUse`, the question not going out. Each time the model acted on the message at once and the feed showed it as the user's bubble (the shapes are in `docs/sessions.md`, "Chat mailbox"). Not seen: the mailbox's `Stop` block and `checkpoint-mark`'s in one turn. A turn that ends on `CHECKPOINT:` with mail waiting goes on, and its last line may no longer be the mark, so the handoff waits for the next turn's mark.

**Workaround:** if the handoff does not come, the session writes the mark again at the end of its next turn; or press "New session".

### PR mode beyond GitHub's open, close and merge (BTN-205)

Run once against a real GitHub repository from the Windows service (BTN-161, 18.10.2026): Even Keel pushed the task branch, opened the pull request, saw it closed unmerged (the task skipped, the branch deleted on GitHub), opened a new one on the next run and saw it merged (the task Done). The rest was written from the API documentation and tested on recorded answer shapes only: the Forgejo client (`src/review/`) as a whole; on either forge, feedback reaching the session — reviews, comments of the conversation (BTN-223: the issue comments endpoint with `since`, GitHub's `user.type` of a bot) and failed runs of the head commit; that Forgejo refuses its author a request for changes on their own pull request is taken from its source, not tried. The Forgejo token rights the guide and the profile dialog name for pull requests (EKR-9: `write:repository` to open one and read its reviews, `read:issue` for the conversation's comments, `read:user`) follow from the scope of each API path, not from a token tried with exactly them; if one is missing, the open fails with `review.denied` (the profile's card says **PR refused**) or the poll logs `review: … was not polled`. If a pull request does not open, the chain halts with `review.notOpened` and its cause; the count of a branch's commits beyond `<remote>/<branch>` that keeps an empty pull request from opening (BTN-222) was tested on a fake git only: if it misreads a branch with commits as one with none and the worktree is clean, the task goes to Done without a pull request and the cleanup keeps the unmerged branch with a `cleanup.branchKept` warning (`git branch -d` refuses it), so the work stays; if it cannot count, the forge's own refusal halts the chain as before; if the poll misreads an answer, the log says `review: … was not polled` each minute and the task waits out of the chain. The `Closes owner/repo#N` line a GitHub issue's pull request gets (BTN-295) is taken from GitHub's documentation of closing keywords and tested on strings only: if GitHub ignores it, the issue shows no pull request and Even Keel closes it after the merge as before. **Workaround:** turn `pullRequests` off for the project so that no new task goes out for review, merge the waiting pull requests by hand and move their tasks to Done in the tracker: the usual cleanup takes them and drops their records.

### PR mode without a remote (EKR-12)

The check before a launch and on saving was tested on the dispatcher and the readiness function only, not on the running service; the switch and **Add profile** of the settings panel (EKR-7) only on the fake state. It assumes the remotes reread each minute show a remote added by hand, and that the page's save of `pullRequests` reads the checkout's remotes from git at once. If the reread misses a new remote or token, the chain stays paused with `review.notReady` after you added it, and the switch stays off with its hint; if the save misreads the remotes, PR mode does not turn on for a project that has a forge remote. **Workaround:** press Resume once the remote is in place, or restart the service; turn PR mode on by hand in the config (`npm run storage -- config-export`/`config-import`) if the page refuses it wrongly.

### A session waiting on you behind a monitor

A turn that ends with a background command or a `Monitor` still running leaves the session in `shell`, which the chain takes for work for up to an hour; since 2026-10-22 a job the CLI's turn summary marked `state: blocked` is taken for waiting instead (`docs/chain.md`, "Background command"). Covered by tests only, from one case seen that day: a session that ended on "waiting for you to press Start" with a monitor on the service log, marked `blocked` with that detail. Not seen: the fixed build showing "waiting" at once, and whether the CLI ever marks `blocked` a turn that waits for its own build or test run. If it does, such a session shows "waiting" while it works: a chat reply goes by `--resume`, which stops the session and its command, and unattended mode stops waiting for it after 10 minutes. **Workaround:** do not reply until the build is done; for a long run, leave unattended mode off.

### Background commands of a stopped session on Linux and macOS (BTN-202)

On Windows `claude stop` was seen to leave the `bash.exe` of a `run_in_background` command alive, and Even Keel now kills the session's process tree after the stop; that was checked there. On Linux and macOS it takes the tree from `ps` the same way and sends each process `SIGTERM`, but it never ran there, and whether the CLI already ends those commands itself was not seen. If a stopped session's command lives on, it holds the worktree and the cleanup leaves it in `leftovers`. **Workaround:** kill the command by hand and press "Done" on the warning; the next cleanup removes the folder.

### The Codex changelog turn with JSON output

`codex exec` for a changelog draft was checked live only without `--json`; with it, a successful turn on 0.162.1 was not seen (only failed ones, on a model the plan refuses). Assumed: the answer is the `text` of the last `item.completed` of type `agent_message`, and `turn.completed` carries `usage` with `input_tokens` (the cached ones in it), `cached_input_tokens` and `output_tokens`. If the item type differs, the draft fails with "the turn ended with no message" (`changelog.failed`); if `usage` differs, the dialog shows 0 tokens. **Workaround:** the Claude provider for the project while it is checked.

### A task back from Backlog after a question in a comment (BTN-245)

Covered by tests only: a session that asks in a tracker comment, moves its task to Backlog and ends its turn; the user answers and moves the task to Todo; the chain stops the old session and starts a new one with a handoff (`relay` in the launch log) whose prompt sends it to the comments (`docs/chain.md`, exception 9). Assumed: the live view gives the old session as not mid-turn with no `AskUserQuestion` (the BTN-243 case showed `waiting` with `ask: null`), and its feed gets no prompt line after the task left. If the CLI keeps a status the chain reads as mid-turn, or writes a prompt line of its own, the old session is adopted and the chain waits as before. **Workaround:** "New session" on the task's card, with the answer in the description.

### Chain sessions on the checked CLI (BTN-250)

Checked live: both downloads on Windows x64 (`claude.exe` 2.1.301 by the manifest's sha256, the Codex npm package 0.162.1 by its sha512, ~25 s together) and each copy answering `--version` with its version; that a copy outside the installer's `versions/` starts its daemon and sessions on itself was seen in BTN-248, in a scratch folder; the CLI check (BTN-253, `docs/releases.md`) runs a launch, a resume and a stop on a copy through the adapters, and stops its daemon after them, from a terminal. Not run from the service: the first chain launch on the copy, `claude daemon stop --any` of a newer daemon followed by that launch (the next daemon assumed to come from the copy, as from a terminal), whether a terminal's newer `claude --bg` replaces the service's daemon in Windows session 0, and the downloads on Linux, macOS and Windows on ARM (a Linux without glibc is told by Node's report; GNU or BSD `tar` unpacks the Codex package). If the daemon comes back on the newer version, the banner keeps naming the account and the sessions run on that version, as before the pin; if a download fails, the log says why and the sessions run on the installed CLI. **Workaround:** Settings → Models, "CLI version", `Installed`.

### A chain session reaching the agent's own compaction

The `checkpoint` hook asks a session for a handoff at 150–250k of context (`docs/sessions.md`), and Claude Code's auto-compact has never fired in a chain session: the only `compact_boundary` lines in the author's chain transcripts are two `/compact` runs by hand (`trigger: manual`), none `auto`. The same goes for Codex, whose context window is 258,400: with the hook's thresholds at 77–97 % of it, Codex is assumed to compact before or around the first nudge, and its rollouts on disk never went past 139k nor had a `context_compacted`. A session that compacts goes on with the agent's own summary instead of the handoff note and the last steps; nothing stops, but whether it keeps the task's decisions, and whether a handoff is cheaper than a compaction at all, was not measured (BTN-254 runs a week of the chain on auto-compact). Since BTN-187 the meter divides by the session's own window (Codex's rollout, Claude's `/context`) and a default or calibrated threshold comes down to 72 % of it (186k of Codex's 258,400, 180k of a 250k Claude window), on the assumption that the agent compacts only past that share; neither the share nor the nudge coming before the compaction was seen live. A threshold pinned by `stats.checkpointTokens` is not capped. Since BTN-259 the late and hard thresholds come down to 85 % and 95 % of the window (212k and 237k of 250k, 219k and 245k of 258,400), so a task held after its handoffs is asked at 95 % on the same assumption — that the agent has not compacted by then. Since BTN-261 the three shares are settings (`stats.checkpointShares`), shared and per project. **Workaround:** none needed for the chain; if a Codex session loses track after a compaction, press "New session" on the task, or lower the project's shares.

### The context window a chain session gets (BTN-187)

Even Keel takes the window Claude's `/context` answers as the one a chain session gets. The probe runs with the account's environment and the `--settings` of the task's project, and is asked about the `--model` of the session's job file. Assumed: nothing else of a `--bg` launch (the plugins, `--strict-mcp-config`) changes the window, and the job's `respawnFlags` keep the model of the last launch after a `--resume` on another model. If not, the meter and the cap read a wrong window. **Workaround:** set `context.window` and pin `stats.checkpointTokens` for the project.

## Codex

Checked live on codex-cli 0.162.1 (BTN-168): a detached turn outlives its parent killed hard, `exec resume <id>` goes on with the history, a resume of an unknown id fails instead of starting a new thread, `CODEX_HOME`, `rate_limits` and the context fill in the rollout. The rest:

### Codex chains beyond short tasks

From the service's Windows session 0 the Codex sandbox does not start, so a chain session runs commands there reliably only when `execution.codex` is `bypass` (`docs/sessions.md`, BTN-171, BTN-173, BTN-233). Checked live from the service: bypassed chain sessions of the sandbox project ran commands, committed and merged their branch (TSK-19 on 17.10.2026, TSK-20 on 18.10.2026), and on a fresh install (BTN-161, 18.10.2026) a Codex chain of a Linear project with the `linear@even-keel` package read its tasks through the plugin, committed, merged, and both tasks were closed one after the other. One of those sessions wrote that the workspace had a "read-only filesystem policy", yet its commit and its merge into the main checkout went through; which `execution.codex` that install ran with was not looked at. Only short test tasks ran: a long Codex task, its handoffs and its limits are covered by tests and by the entries below. **Workaround:** if a session cannot run commands, set `execution.codex` to `bypass`, or run Codex tasks by hand in a terminal.

### Chain sessions in the Codex app and on the phone (BTN-178)

That the Codex desktop app and the ChatGPT app on the phone do not list the chain's threads is read from the app-server protocol (`thread/list` without `sourceKinds` leaves `exec` threads out), not seen in either app. If an app lists them after all and the user writes there, that turn runs in the app's own app-server and appends to the same rollout: the page shows it in the feed, but Even Keel may `resume` the thread at the same time, and two turns on one thread is untested. **Workaround:** answer Codex sessions only from the page's chat or the tracker (`docs/sessions.md`).

### Errors and limits in the rollout

An API error is taken from an `event_msg` of type `error`, and a limit by its text (`usage limit`, `rate limit`, `quota`); neither was ever seen. If the shape differs, a session that hit a limit looks finished without Done and waits for the user. **Workaround:** press "New session" on the task after the reset.

### A package server and a Codex server of the same name

A Codex chain session called the Linear server of its package through the gateway (`-c mcp_servers.<name>.url=<gateway address>`) on a fresh install from the Windows service (BTN-161, 18.10.2026). If Codex also has a server of the same name in its own `config.toml`, which one wins is unknown. **Workaround:** remove that server from Codex's config or give the tools through the package alone (`docs/packages.md`).

### Sign-in from the page

`codex login --device-auth` runs through the panel's sign-in flow, whose reading of the link was written for Claude's output; the one-time code is not parsed out, the window only shows the CLI output unfolded (`deviceLogin`), and the fake mode's output is a guess at Codex's wording. If the window shows no link, sign in with `codex login` in a terminal with the same `CODEX_HOME` (`docs/accounts.md`). Adding an account into a new folder under `~/.codex-accounts` (BTN-176) was checked only in the fake mode and in tests: that `codex login --device-auth` signs in a folder Even Keel made empty, and that the plan of a fresh sign-in is already in its `id_token` when the second free account is judged. If the plan is missing then, a second free account is added and only held afterwards, with the warning on its card.

### Codex on an OpenAI API key (BTN-177)

Checked with a fake key only: `codex login --with-api-key` writes the `auth.json` Even Keel writes, `codex login status` reads it, a turn on it goes to the API and fails with 401, and OpenAI's models list answers 401 to a fake key. Never seen with a real key: that a turn runs on it, whether its rollout has `rate_limits` (the card shows the spend instead either way), the price of the model it runs on in Tally, and Codex's message when the key's money runs out (BTN-195). That message is read from the codex-cli 0.162.1 binary ("Quota exceeded. Check your plan and billing details.", its `QuotaExceeded` for OpenAI's 429 `insufficient_quota`), and the money check — `/v1/responses` on a `nano`/`mini` model with `max_output_tokens: 16`, waiting for 2xx or a 429 `insufficient_quota` — was never run against a real key, empty or topped up. If Codex words it otherwise, the session stops like on any error, or, if the text has `quota` in it, its lamp says "limit" while the chain does not hold it (on a key only `credit` is held); if the check never says 2xx (the key lists no such model, the request shape is refused), the chain keeps waiting and the log has the check's reason. **Workaround:** top the key up and press "New session" on the task.

### A crashed turn and a service restart mid-turn

Liveness is the pid of the last turn: a pid reused by another process after a crash would keep the session busy. A service restart mid-turn was checked with a parent process killed hard, not with the real service.

### Stopping a turn on macOS and Linux

The turn's process group is killed with `process.kill(-pid)`; it was run only on Windows (`taskkill /T`).

### Edit sizes of a FileChange (BTN-185)

Only an `add` with the file's `content` was seen in a rollout (2026-10-18). A `delete` is assumed to carry `content` too, and an `update` a `unified_diff` whose `+`/`-` lines are counted (`src/codex/rollout.ts`). If the shape differs, the chat shows the edit with no `+N −M` and leaves it out of the session's edit total; nothing else changes.

### Codex stats (BTN-170)

Checked on the rollouts on disk: 0.148 desktop sessions and 0.162 exec ones. Never seen: a non-zero `cache_write_input_tokens` — it is assumed to be inside `input_tokens` and is subtracted from it; a rollout in `archived_sessions/`; a 0.162 rollout that has `token_count` lines without a matching `token_usage_record` (the fallback was run only on 0.148 files). If one of these differs, a Codex response is counted twice or its input is off. **Workaround:** none needed for the chain; compare `/stats` with the `usage` in the rollout and fix `src/rollout.ts` (`tally/CLAUDE.md`).

### Plugin hooks that block (BTN-180)

All five hook events of a plugin were seen running in Codex, and `additionalContext` reaching the model, but never a hook stopping anything: a `PreToolUse` exit code 2 refusing the call (`merge-check` holding a merge until the project's check, `check-marks` refusing a Huly description with bad marks), `permissionDecision: deny` (`show-calibration`), `decision: block` of a `Stop` hook (`checkpoint-mark`). If Codex ignores one, the call goes through: a merge before the check is green, a description with bad marks, a turn that wrote the handoff note without the `CHECKPOINT:` line waits for a reply. **Workaround:** for the last one, reply `CHECKPOINT: .temp/handoff.md` in the chat window or press "New session"; the others show in the tracker and on the CI.

### Chat mail at a Codex Stop (BTN-181)

Seen live on 18.10.2026: messages sent during a command reach a Codex session through `PostToolUse`, and the chat shows them from the developer message the hook leaves in the rollout. Not seen: whether a `Stop` `decision: block` keeps the turn going (else the message is counted delivered at `Stop` while the turn ends without it; send it again from the chat), and where the rollout puts its text — the feed looks for the mark in a `UserMessage` too; if it lands elsewhere, the message works but has no bubble in the chat.

### The handoff note of a Codex turn seen by the Stop hook

`/api/sessions/<id>/note` reads the rollout when the hook asks; that Codex has written the turn's last `FileChange` by then was not seen. If it has not, the hook lets the turn end, as in the previous item.

### Plugins in a Codex folder on Linux and macOS

The install and the check that a plugin is already in a folder (`<CODEX_HOME>/plugins/cache/<marketplace>/<plugin>`) were run only on Windows. If the path differs, every first turn of a service run installs the plugin again, which costs a few seconds and changes nothing else.

## OpenCode

### OpenCode chain sessions under the service (BTN-214)

Checked on OpenCode 1.18.25 on Windows, the free `opencode/big-pickle`, by a script that drove the adapter from a terminal: a launch, a reply that starts with `-`, the transcript and the Tally rows; the session read the project's `CLAUDE.md`. The `checkpoint` package's OpenCode plugin and `Agent.write` (BTN-274) were checked the same way, against a stand-in for the service: the nudge and a chat message after a shell call, the message acted on and shown in the feed, a changelog-style turn with its session deleted after it — never a real handoff, a message from the page or a changelog draft. Never run as a chain session of the Windows service (session 0) or on Linux and macOS, never on a ChatGPT, Copilot or API-key account, never through a whole task — commits, a merge into the main checkout (`external_directory` is allowed for it), packages' MCP servers through the gateway, plugin skills in `skills.paths`. If OpenCode needs something session 0 lacks, as Codex's sandbox does, the session fails on its first turn with OpenCode's output in the error. **Workaround:** run the task on another provider (a run label) and open an issue with the output.

### A spent limit on OpenCode

OpenCode shows no usage windows for ChatGPT or Copilot, so an OpenCode account has no limit bars and no reset time to wait for. What a spent limit looks like in OpenCode's database was never seen: the fold takes a message's `error` as the API error, a text with `usage limit`, `rate limit`, `quota` or `too many requests` as a limit (`LIMIT_TEXT` in `src/opencode/transcript.ts`). If it is worded otherwise, the session stops like on any error; if OpenCode retries by itself, it hangs (below); how the chain holds a limit with no reset time on OpenCode was not tried. **Workaround:** wait for the reset and press "New session".

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

What a Copilot session writes when the AI credits or premium requests run out was never seen. The fold takes a `session.error` about billing or AI credits as spent credit and a rate limit or quota as a limit (`src/copilot/transcript.ts`). Spent credit is held as a key out of credit, but nothing can tell when a GitHub token has credit again, so the session waits for good; any other wording stops it like an error. **Workaround:** after the budget is back, press "New session".

### A Copilot turn killed mid-turn

A turn's process killed by "New session", a stop or a crash leaves `events.jsonl` without its `assistant.turn_end`; whether `--resume` then goes on cleanly was not tried. **Workaround:** "New session", which starts a new session with a handoff.

### Copilot installed with npm

Even Keel looks for the `copilot.exe` winget installs, then `copilot` on the PATH. The npm package `@github/copilot` puts a `copilot.cmd` wrapper there, which a detached spawn without a shell may not start. **Workaround:** point `EVEN_KEEL_COPILOT_BIN` at the CLI's real executable.

### Copilot models in the stats

Copilot names Claude models with dots (`claude-sonnet-4.6`), which no price key of `tally.config.json` matches, so such calls show no cost in `/stats` and the collector logs them as unpriced; the GPT names seen were the API's own. **Workaround:** add a price key with the dotted name.

## Packages

Checked live on 17.10.2026 (BTN-174) from a second instance in a terminal: plugins installed into Even Keel's state, a Claude chain session with `--strict-mcp-config` and `--plugin-dir` called the Huly server through the gateway, a plugin's hook ran. On 18.10.2026 (BTN-161) the gateway's server (`npx @firfi/huly-mcp`) also started and answered from the Windows service's session 0 of a fresh install, and its chain sessions called the remote GitHub server (a Claude session) and the Linear one (a Codex session) through the gateway, with the headers filled from the tracker profile. The rest:

### "Add to Claude Code" on /tools (BTN-226)

The button runs `claude plugin marketplace add <checkout>` from the service in the default config. Checked on 22.10.2026 on a second instance started from a terminal with an empty default config: the command added the checkout as a `directory` marketplace to that config's `known_marketplaces.json` and the offer went away. Not from an installed service (session 0 on Windows, systemd or launchd), whose default config already knew the marketplace. If the CLI fails from the service, the banner shows `packages.marketplaceAdd`; if it adds the marketplace to another folder than the one your terminal uses, the banner stays. **Workaround:** run the command the banner shows in your own terminal; chain sessions do not need it either way.

### Packages on Linux and macOS

Installing a package and the gateway's server processes were run only on Windows. If `npm` or a server does not start there, the cell shows "install failed" or "no response" and the chain waits.

## Trackers

### A tracker profile changed on the Access page (BTN-200)

A profile changed on `/settings` → **Access** is covered by tests, not run live (it would change the real keys): that the tracker of the profile's projects connects again with the new values, and that a new session finds the default profile's values in the `env` of the global `settings.json`. If the tracker does not connect again, its chips stay "does not answer". **Workaround:** restart the service.

### Two profiles of one tracker (BTN-200)

Two projects on two profiles of the same tracker — each its own connection, its own gateway keys and its own GitHub Actions token — are covered by tests; the author has one account per tracker, so it never ran live. If a project reads another profile's tasks, **workaround:** keep one profile per tracker.

### Several projects on one tracker project (BTN-172, BTN-73)

Two Even Keel projects on one Huly project (`huly` naming it) or on one Linear team (`linear: TEAM/Project`), split by milestone, are covered by tests; never run as live chains. Assumed: one shared read gives each its own tasks, a task closed by one is not taken by the other, and a Linear `TEAM/` value reads the whole team. If a task shows up in both chains, or in neither, **workaround:** keep one Even Keel project per tracker project and leave the release's tasks `Manual`.

### Task feeds from another tracker (BTN-66)

A project with a task feed — a GitHub repository or a Linear team next to a Huly project, or a second Huly workspace — is covered by tests and the page's fake data; it never ran as a live chain. Assumed: each feed is read on its own profile and its tasks join the one chain, a feed's task is moved and commented on in its own tracker and closed there after the merge, its session gets the brief when no server signed in as the feed's profile is brought, the profile's chain rules apply to it, and Tally takes its title and link from the launch log while it asks Huly only for tasks launched through a Huly profile. Also never seen live: the `/status` page with more than one connection, and the Tally check's "failed" and "halted". If a feed's task is not closed, or its session cannot read it, **workaround:** close it in its tracker by hand, or set the project's `brief` to `true`; if stats name it wrong, the launch log still has its url.

### A project's own CI profile (BTN-231)

That a project's chosen GitHub or Forgejo profile (`remoteProfiles`) reads its CI and opens its pull requests is covered by tests; it never ran live, the author has one profile of each. If the CI or a pull request keeps the old profile after the choice, **workaround:** set the wanted profile as the default of its kind on Access.

### The expiry of a fine-grained GitHub token

The `github-authentication-token-expiration` header was seen with a classic token. If a fine-grained token's answer has no such header, its card shows no expiry; nothing else changes. A removed key also stops the global folder's daemon (`claude daemon stop --any` with the global `CLAUDE_CONFIG_DIR`, from the service); that stop was never run from the service — if it fails, the log has the error and the removed key stays with sessions of that folder until its daemon exits (`docs/accounts.md`). **Workaround:** stop the daemon by hand once no session of the folder is live.

### GitHub attachments

Downloading a file attached to an issue or comment with the token has not been tried live; if it fails, the page cannot open that file (`docs/trackers.md`).

### Outsiders' comments on a public GitHub repository (EKR-19)

Only comments and pull request reviews by the repository's owner, the members of its organization, its collaborators and the token's own account reach a session, by GitHub's `authorAssociation`; the wizard warns about a public repository without required labels. Answers to a question in an issue ran live on 22.10.2026 on a public repository: an outside account's reply (`NONE`) was skipped with its line in the service log and the session kept waiting, the owner's reply reached it. PR mode was not: a review or a pull request comment by an outsider is covered by tests with GitHub's documented REST answers only. If GitHub names you otherwise than `OWNER`, `MEMBER` or `COLLABORATOR` there (a review by a token of another account, say), your feedback is skipped and the service log says `is skipped: its author is not a collaborator`. **Workaround:** answer from the page's chat, or add the account as a collaborator.

### Milestones on GitHub and Linear

Filling the milestone of a task that entered the chain without one (`fillMilestone`) was checked only on Huly (`docs/trackers.md`).

### Changing a milestone from the task card on GitHub and Linear

Checked only on Huly. On GitHub, `updateIssue` with `milestoneId: null` is assumed to clear the milestone; on Linear, the choices are the project milestones of the issue's project and `projectMilestoneId: null` is assumed to clear it. If the tracker refuses, the card puts the old milestone back and shows the error; nothing else changes. **Workaround:** change the milestone in the tracker and press the refresh button in the project head (`docs/trackers.md`).

### The tasks of a milestone on GitHub and Linear (BTN-142)

`milestoneTasks` was checked live only on Huly. On GitHub, `milestones(query:)` is assumed to search titles, so the exact title is found among its results; if it is not, the draft says the milestone has no done task (`changelog.empty`). On Linear the default order of `comments` is unknown, so both ends are read and the newer one is kept; if a page of comments holds neither end's newest, the draft gets an older comment for that task. **Workaround:** none needed for the release itself — the draft is a draft; edit it by hand.

## CI

### When a CI run counts as stuck

A queued run, or a push without a run, is called stuck after 2 minutes (`STUCK_MS`). The figure was chosen without live runs and may be too short for a slow runner queue (`docs/ci.md`).

### A command after a green main that restarts Even Keel

`commands.afterGreen` run as children of the service's node process. The service stops only that process, not its tree — the Windows wrapper (`service/EvenKeelService.cs`, `OnStop`), `KillMode=process` under systemd, `AbandonProcessGroup` under launchd — so a restart command is expected to outlive the stop and start the service again, but that was never run live. If it dies with the service, the service stays stopped, or the commands after the restart one never run. **Workaround:** make the restart the last command, hand it to something outside the service's process tree (a scheduled task, `systemd-run`), or restart by hand (`docs/ci.md`).

### The first start with Forgejo profiles (BTN-201)

Checked live, read-only: a profile built from `FORGEJO_TOKEN` the way `importForgejo` builds it, on the host of this repository's Forgejo remote, signs in through `/api/v1/user` and is the one `ciToken` gives that remote, and the runs come with it; another host gets no token. The import itself, by the service on its own database after an update, is covered only by tests. If the Forgejo CI disappears from the page after the update, the import made no profile for that host (the log says why). **Workaround:** add a Forgejo profile on `/settings` → **Access** with the server's address and the token.

### A remote added to a checkout on the running service (BTN-191)

Every minute the service rereads each project's remotes and workflow folders and adds or drops CI watches by the difference (`CiWatches.refresh`, `docs/ci.md`). The difference itself is covered by tests; the reading is the same as at the start. Not yet seen on the live service: a `git remote add` in a project's checkout giving `ci: <KEY> watches …` in the log within a minute. If the CI does not appear, **workaround:** change and restore the project's `repo` on `/settings`, or restart the service.

### Chains of several projects on one remote (BTN-210)

The git side is checked on real clones of one remote (`docs/chain.md`, "Projects of one remote"): the fast-forward of `main` before a launch and the second try of a rejected sync. Not run as live chains on the service with a CI: two projects whose pushes race, a red push of one seen by the other. The shared fix (BTN-217) is covered by tests only: while one project fixes a red `main`, the others of the same remote and branch wait at their next launch with a line naming it, and their red pushes start no second fix. What may differ live: the group read from the checkouts' remotes (a project with no remote read yet is in no group, so it may still start a second fix), or a fix that ends in a way the code does not see and leaves the others waiting. **Workaround:** a project waiting on another's fix that is over — "Skip" on that fix session, or close its fix task; to stop sharing at all, put `ci.guard: false` on all projects of the remote but one: only that one judges and fixes `main`.

### Carrying a release project forward (BTN-172)

The carry of a release branch into the main project's branch (`mergeInto`, `docs/chain.md`) is covered by tests with git's answers, never run on the service against real clones: the fetch from the release clone's folder, the merge commit made under the service's account (session 0 on Windows: it needs a git name and email, as the changelog commit does), the abort of a conflict and the push. If the merge fails for want of an identity, the carry is held like a conflict and the page shows git's message; if the push fails, the page says so. **Workaround:** carry by hand in the main checkout while its chain stands — `git sync`, `git merge --no-edit origin/<release branch>`, `git sync` — and the carry clears by itself once the branch has the commits.
