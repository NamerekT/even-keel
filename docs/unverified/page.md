# What has not been verified: The page

One area of [What has not been verified](../unverified.md), which says what an entry is, how to report a run into one and where a new one goes. What has been checked in this area is in [What has been verified: The page](../verified/page.md).

## A built-in task's edit saved as the tab closes (BTN-1027)

Unit tests cover the drafts (key by project GUID, task and field, the leftover rule, the `keepalive` size cap); on `dev:fake` a script checked the title saved by the backdrop and dropped by Escape, the description saved by × and by a hidden tab, the note kept unsent across a close, a leftover title re-sent on the next open, and a leftover title and description refused as a conflict opening their windows with the draft kept. Not checked against the service: a real tab or browser close with the title or description editor open, where the `builtin/edit` request is sent with `keepalive` from `pagehide` and must still reach the service and land; a description over 60 000 bytes, sent without `keepalive`, which the browser may drop (its draft then comes back on the next open); a phone browser killing a backgrounded tab. **If it is wrong:** the edit is not in the task after the tab closed; open the card again — the kept draft is sent anew, or the conflict window shows it.

## Creating a project by a clone or a new repository (BTN-1048)

Tests cover the parsing of `git clone --progress` lines (stages, percent, sizes, speed, `\r` and `\n`), the reading of a remote's answer and its refusals by git's message (rights over HTTPS, a private repository's "not found" among them; an unknown SSH host key and its `ssh -T`; no SSH key; no repository; network — BTN-1091), the folder's place and suggested name, the measure of a filled folder (with real git: a `.gitignore` at the top and a nested one leave their files out of the count, BTN-1092), the plan's steps for each source, Retry from the failed step, Cancel's undo of only what the job made (with a real folder on disk), the kept project after the entry, the page's draft and the fake's answers; the wizard's card and the window were shot on `dev:fake` in each state. Seen in the sandbox under `npm start` (2026-11-13, [verified](../verified/page.md)): small and large public clones over HTTPS with the progress moving to the end, on a phone width too; the refusals of a private repository without a sign-in and of an unknown SSH host, at once, the SSH one as a short line with `ssh -T` in a block; Cancel and a network cut mid-clone, Retry after both; a new repository in an empty and in a filled folder, its first commit and Claude Code's trust; an existing folder with and without git. Seen on the host under the Windows service the same day: a private repository over HTTPS with git signed in through Git Credential Manager (silent, no prompt), the branch list of a clone, the stages and percent, real Git LFS files (the "LFS files" step with its percent, all 43 files in place after Retry), and an SSH address with a known host and no key refused at once with a short line. Later in the sandbox on `df38a346`: the network cut's one line (BTN-1100) and the count of a folder with a `.gitignore` (BTN-1092, only what the commit took). Not checked live: a failure of the project's packages after the project is saved. Since BTN-1093 there is no "Source" switch: one field "Folder or repository address" is read by the service. Its kind by text (`targetKind`) is tested for Windows, macOS and Linux on any machine, and its reading on disk and git (`readTarget`: a repository's top with and without a remote, a subfolder refused with its top, a folder without git, a path not there, a bare name numbered past a folder differing only in case, a disk and the home folder refused) with a real git; the page's line for each case was shot on `dev:fake`. Each case was typed into the wizard in the sandbox under `npm start` and gave its line (2026-11-13); under the service only clone addresses were typed. A path with `~` and a repository whose `origin` URL holds a user and a password (shown without them) were seen there too. Not checked live: a repository without a remote not yet a project, a path with `%USERPROFILE%`, and a bare name taken by a folder of another letter case on Windows and macOS. Since BTN-1094 git's missing name and e-mail is "Set them" under the field and under the creation window's error, a dialog over the wizard saved by the setup Git step's command; on `dev:fake` the wizard kept the field and checked it again after the save, and the window retried its failed step by itself. In the sandbox under `npm start`, with the global identity removed, the line showed at once, the dialog wrote the identity into the global git config and the field's line went away (2026-11-13; its stale prefill was BTN-1104). After BTN-1104 Save was on at once (the fields still show the identity the service read before, not git's empty one). Not checked live: the same under the service, and the creation window's retry after a save from its error. **If it is wrong:** set them with `git config --global user.name`/`user.email` as the service's user; clone the repository by hand into a folder and type that folder into the field; a folder Cancel left behind is safe to delete.

## The badge's warm-up after a start (BTN-973)

Unit tests cover the wait: no push until the project's trackers, the sessions, the stats (when a stats field is picked)
and the git identity are read once, the whole state in the first push, a push with what there is after 2 min, the
preview and "Check" not waiting. Not checked live: a restart of the service with a chain running and its badge
published — that the first push after it carries the agent, the queue, the milestone and the numbers, and that the
Worker's picture does not turn stale meanwhile. **If it is wrong:** after a restart the badge shows a task without its
agent and an empty chain for two minutes, as before, or keeps the old picture for two minutes with a line `badge: … is
pushed before the warm-up ended` in the log; nothing to do, the next push corrects it.

## The badge of a session on a spent limit (BTN-969)

Unit tests cover the state of a task whose session stands on a limit (the reset's time from the chain's hold, no action,
no status line, nothing of the account; plain work again once the chain went on), the drawing (the dashed bar, "resets
in …" counted at the request, a header that does not say "being built") and the Worker's parser. Not checked live: a
real session hitting its limit while its badge is published, and the deployed Worker taking that push. A Worker
deployed before this state answers 400 to a push that has such a task, and only to those. **If it is wrong:** the badge
keeps the last picture or says the project is being built while the session waits; update the Worker (`npm update
even-keel-badge`, `npx wrangler deploy`, `deploy/badge/README.md`).

## The badge's status line from the agent (BTN-932)

Unit tests cover when the service asks (no badge, a badge without the action, no push yet, a failed push, a session the
chain does not run, a badge turned off mid-task, once per two minutes), the hook's output, the transcript's fold (a
line asked for, one nobody asked for, one of an earlier turn) and the filter. Seen live on Opus and Fable (2026-11-10,
[verified](../verified/page.md)): the request reaches the transcript, each one gets a line, and Fable keeps writing
`status:` unasked after its first. Not checked live: the request's mark next to mail, and what the line costs in output
tokens over a task. BTN-919 owns
the run. **If it is wrong:** the badge shows the default action; a session distracted by the requests — turn "Tasks in
work and the current action" off in the badge's dialog, which stops them at the next tool call.

## The badge's filter of private data (BTN-931)

Unit tests cover every shape of layer 2 with its false alarms, the list of the service's own strings from a made-up
state, the dropped title and action, the same state in the push, the preview and "Check", the log line and the `NONE`
answer of the translation. Not checked live: how many descriptions of real sessions the filter drops (a dotted name
such as `state.tasks` counts as a host, so a badge may show the bare tool more often than it should) and whether
Gemini follows the prompt — replaces names and answers `NONE`. The list built from a real machine was run over the
stored English titles ([verified](../verified/page.md), BTN-974: two false alarms found and fixed); the same list
against real descriptions is still open. BTN-919 owns the run. **If it is wrong:** a badge that shows too little — the log names the field and
the layer; one that shows too much — turn "Tasks in work and the current action" or English titles off in the badge's dialog.

## The badge's English titles (BTN-918)

Unit tests cover selection of current tasks, the title-only LiteLLM request, cleanup, persistent cache and retry claims,
title changes, in-flight deduplication and idempotent import of usage into Tally's `messages`. Not checked live: the
actual free-tier Gemini response through LiteLLM (including its fallback model name and zero pricing), response time,
the key-only badge on refusal, reuse after a service restart, the retry at once after a live change of the URL, key or
model (BTN-955) and usage appearing on `/stats` after collection. BTN-919
owns the run on a bench from `stands/README.md` in `even-keel-backstage`. **If it is wrong:** turn English titles off;
the badge still shows task keys.

## Lightweight commands and tray polling (BTN-826)

HTTP tests and the built page against a real HTTP fixture populated from a read-only TSK bench snapshot cover command acknowledgements, two repeated Stop/Keep going presses, SSE-only startup, gzip JSON, flushed SSE patches/pings, disconnect cleanup and reconnect bases. The Windows tray host compiles. Not checked on a deployed service: a phone over Tailscale, a stream kept open for hours, and the actual tray's language/count/paused/question icons with its new `/api/tray` poll. Since BTN-840 every command answers only `{ok:true}`, and the server ignores the old `X-Even-Keel-Command: ack` header (an HTTP test covers a command without it); a tab opened before the update to this version must be reloaded. **If it is wrong:** reload the page, use its chain/question controls to inspect status, and open the page from the tray rather than relying on its icon. Live checks use the TSK bench and restore any changed settings.

## A chain paused for packages that are not ready (BTN-657)

An enabled package that is not installed, failed to install or lacks a key puts the chain in paused with "Open the project's packages" beside the reason, instead of a running chain waiting under the banner; once the package is ready the chain goes on by itself within a minute. Packages that only start or do not answer, the gateway, a closing task, CI, limits and a slot stay waits, named by the project's chip "waiting · <reason>" and a line on its card and page. Checked by the dispatcher's tests and on `dev:fake` (`?chain=packagesPause|packages|packagesSilent|gateway|closing`). An end-to-end scenario covers the service: a remote MCP package whose header needs an unset key, Start, the pause with its reason, the key set through `packages/key`, the gateway's probe passing with it and the first task starting within a minute without Resume. Not run live: a plugin or `npx` package not installed or failed to install, the button on the page, and the key set from `/tools`. **If it does not go on:** press Resume once the key is set.

## The wizard's trust check

Since EKR-83 the Repository card shows only the trusted status or the pending automatic-write line. There is no trust switch or manual command in the wizard, Sessions settings or the trust pause. The status reads the shared Claude account's file (or the global file); the actual session account is checked again on launch and resume. The status is informational and does not block adding the project.

Fake-page checks cover trusted and untrusted wizard states, English/Russian and the project's Sessions settings ([verified page](../verified/page.md), EKR-83). The checkout/worktree flag was checked in Windows Sandbox ([verified sessions](../verified/sessions.md)); the full wizard → automatic trust → chain launch ran there on 2026-11-06 and found EKR-92. With the fix, Start through the chain API in a previously unseen checkout launched and completed a real worktree session without a trust pause, and the installed package of the fix ran wizard → Start → merge without one, for a folder never seen and for one with only a backslash key. The wizard's status line for a backslash-only entry was not looked at (unit tests cover it); an actual write-access failure, other service users and non-Windows hosts remain [open](sessions.md#writing-claude-folder-trust-before-launch-ekr-59). Fix a damaged or unwritable account file, then use Check again and resume.


## The setup's Git step on a machine without git (BTN-731)

Since BTN-877, a nonzero exit containing `xcrun: error: invalid active developer path` is also treated as missing git
on macOS: `/usr/bin/git` may be only the stub without Command Line Tools. The setup always offers
`xcode-select --install`, even with Homebrew on PATH, with a note that full Xcode is unnecessary and an existing
Xcode installation may need `sudo xcodebuild -license accept`. A license failure stays an ordinary git error with
its output. Pure-function tests cover the stub, ENOENT, other platforms, successful exits and unrelated failures.
Not checked live: the actual macOS stub opening its system dialog, the setup after installing Command Line Tools,
and a retry after accepting the Xcode license. **Workaround:** install Command Line Tools with
`xcode-select --install` (or accept the installed Xcode's license), then press Check again.

The step reads `git --version` from the service and takes an ENOENT of the start as "git is missing" (`GitResult.missing`); a test checks that with an empty `PATH`, and the page's states on `dev:fake` (`?git=missing|bare|anon`). Since EKR-54 the command comes from the package manager the service finds on its `PATH` (winget by `lstat`, since `stat` refuses its app alias; seen found on the host by `lstat` and missed by `existsSync`), with the git-scm.com download link always under it and alone where none is found; awaits the sandbox, which has no winget: the step should show only the link. The wizard's `git init` and first commit ran live on real git ([verified](../verified/page.md)). Seen in the sandbox with the start at sign-in (2026-11-04, [verified](../verified/page.md)): a machine with no git showed the step red with the winget command, which the sandbox lacks (before EKR-54); git installed meanwhile stayed unseen through "Check again" and even the tray's Restart, since the host handed node the `PATH` of its own start, until the machine restarted or the tray's Quit and `even-keel install` from a new terminal. Since EKR-57 the host builds node's `PATH` anew from the registry at every start, with its own leftover entries after. The step on Windows names the restart by how Even Keel was started (`windowsStart`, the parent process): the tray's Restart, a restart of the Windows service by its name, or a start from a new terminal; node checks git at its start, so after the restart the step should turn green by itself. Seen in the sandbox on 0.2.1-rc.1 (2026-11-04, [verified](../verified/page.md)): git installed, and the page showed it as soon as it was in. Awaits: `even-keel` started in cmd: the line says a new terminal, and a start from one turns the step green. Assumed, not seen: node started by `npm start` or the npm shim has `cmd.exe` for its parent and reads as a terminal. Not narrowed: once, git removed and the machine restarted, the step still showed git installed on a reload of the page; whether "Check again" was pressed is not known. Seen under a Windows service run as another user than the one at the page (Windows Sandbox, 2026-11-06, [verified](../verified/page.md)): "Save" wrote the name and email into that user's own `.gitconfig`, and its sessions merged with them. Not seen: the step's restart line under a Windows service, the install commands of macOS and Linux. **If it is wrong:** install git, then Quit Even Keel in the tray and run `even-keel install` from a new terminal (or restart the machine), and set the name with `git config --global user.name` and `user.email` as the service's user.

## The README badge (BTN-915)

Tests cover the state built from the service's state (only the picked fields, never a tracker title), the action text, the drawing (snapshots of every mode in both themes), the push schedule (the 2-minute gap, the 15-minute pulse, the last `stopped` state, failures and a missing secret), the stats and the preview route; the drawing was looked at in a browser (`.temp`). Pushes to a Worker on Cloudflare and the still picture inside GitHub's `<img>` (the image proxy, the embedded fonts, desktop, dark theme) were seen on 2026-11-10 ([verified](../verified/page.md)). Not checked live: the animations of a running chain under the proxy, GitHub's mobile app, and the KV write count over a day of a busy chain. **If it is wrong:** turn the badge off (Project settings → Repository → README badge) — the README keeps the last picture the Worker has.

## The README badge dialog (BTN-917)

Tests cover the dialog's pure parts (the switches over the fields, the default name, the releases link from the remotes, the snippet), the config write (`withBadge`), the check's answers for each Worker reply and network error, and the wiring that logs the network cause and gives the page only the notice; the dialog was shot on `dev:fake` (empty, filled, a refused and an unreachable check, 390 px, the light theme). Not checked live: "Check" against a deployed Worker (a real push and the picture read back, a wrong secret giving `badge.refused`, an old Worker giving `badge.rejected`), the preview refreshing as a real chain moves, the secret saved from the dialog reaching the next push without a restart, and the copied snippet in a GitHub README switching its picture with the reader's theme. **If it is wrong:** set `badge` and `EVEN_KEEL_BADGE_SECRET` by hand (`config-import`, `.env`) and write the README's `<picture>` from `docs/badge.md`.

## The badge's Worker on Cloudflare (BTN-916)

Tests with a fake KV cover the Worker's answers (401 for a wrong, missing or unset secret, 400 for every malformed state, the stored state, the drawing at the request's time in each mode, the light theme, 304 by `ETag`, 404 for other paths); `wrangler deploy --dry-run` bundled it, and a local `wrangler dev` (workerd with its local KV) took real pushes from the service's `postBadge` and served the SVG, 304 included ([verified](../verified/page.md)). An emergency deploy from a copy of the folder, outside the README's steps, showed on 2026-11-10 that `wrangler deploy` (4.159.0) creates the namespace by itself, and the deployed Worker's answers and headers through Cloudflare's edge and the dark `<picture>` on GitHub ([verified](../verified/page.md)). Not checked on Cloudflare: the Deploy to Cloudflare button (that it copies only `deploy/badge/` into the user's repository, creates the KV namespace from a binding without an id, asks for `BADGE_SECRET` from `.dev.vars.example` and shows the `cloudflare.bindings` descriptions; its one run was left at the form, Cloudflare having lost access to the account's GitHub), the README's "Deploy by hand" and "Updating" as written (`npm update even-keel-badge` then `wrangler deploy`), and the `<picture>` switching to the light theme on GitHub. The button URL points at `main`, so it works only once a release brings the folder there. Since BTN-941 the drawing is the npm package `even-keel-badge`: a tarball of it, installed into a copy of the folder, passed `tsc`, the Worker's tests and `wrangler deploy --dry-run`, but not checked are Cloudflare's build installing it without a lock (the `latest` tag) and the first publish by `publish.yml`, which needs the name held by a placeholder and its trusted publisher set first (`docs/releases.md`). **If it is wrong:** deploy by hand as the folder's README says, creating the namespace with `wrangler kv namespace create BADGE` and putting its `id` into `wrangler.jsonc` if the deploy does not.
