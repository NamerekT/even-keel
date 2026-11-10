# What has not been verified: The page

One area of [What has not been verified](../unverified.md), which says what an entry is, how to report a run into one and where a new one goes. What has been checked in this area is in [What has been verified: The page](../verified/page.md).

## The badge's status line from the agent (BTN-932)

Unit tests cover when the service asks (no badge, a badge without the action, no push yet, a failed push, a session the
chain does not run, a badge turned off mid-task, once per two minutes), the hook's output, the transcript's fold (a
line asked for, one nobody asked for, one of an earlier turn) and the filter. Not checked live: whether a Claude Code
session writes the line at all on a request in `additionalContext`, how often it ignores it, answers it in other words
or keeps writing `status:` unasked, whether the request's mark reaches the transcript in a `hook_additional_context`
attachment when it comes alone and next to mail, and what the line costs in output tokens over a task. BTN-919 owns
the run. **If it is wrong:** the badge shows the default action; a session distracted by the requests — turn "Tasks in
work and the current action" off in the badge's dialog, which stops them at the next tool call.

## The badge's filter of private data (BTN-931)

Unit tests cover every shape of layer 2 with its false alarms, the list of the service's own strings from a made-up
state, the dropped title and action, the same state in the push, the preview and "Check", the log line and the `NONE`
answer of the translation. Not checked live: how many descriptions of real sessions the filter drops (a dotted name
such as `state.tasks` counts as a host, so a badge may show the bare tool more often than it should), the list built
from a real machine's accounts, profiles and projects, and whether Gemini follows the prompt — replaces names and
answers `NONE`. BTN-919 owns the run. **If it is wrong:** a badge that shows too little — the log names the field and
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

## The demo on the first run (BTN-776)

An end-to-end test runs the demo on the real chain, git and built-in tracker with the demo's agent: from `demo/start` to the end card, DEMO-2 after DEMO-1, a restart mid-turn that goes on in the same session, DEMO-3's question answered from the chat, the removal mid-turn and a new start in Russian, and the refusal without git (an empty `PATH`). The page's screens were shot only on `dev:fake` (`?projects=none`, `?demo=running|finished`). Not watched on a live service: the pace of the turns by eye, the chain's stage and context growing on the page, the demo's own question in the chat window, a restart of the Windows service mid-demo, the removal on Windows while a turn holds the repository (`rmSync` retries five times), the wizard's «Remove the demo» after a real project is added, and a machine without git. **If it is wrong:** remove the demo with **Remove** in the band's **⋯**; if its folder stays, stop Even Keel and delete `<state>/demo`, then remove the project Demo in its settings.

## The README badge (BTN-915)

Tests cover the state built from the service's state (only the picked fields, never a tracker title), the action text, the drawing (snapshots of every mode in both themes), the push schedule (the 2-minute gap, the 15-minute pulse, the last `stopped` state, failures and a missing secret), the stats and the preview route; the drawing was looked at in a browser (`.temp`). Not checked live: the SVG inside GitHub's `<img>` (the camo proxy, the embedded fonts, the animations, GitHub's mobile app), a push to a deployed Worker (a local `wrangler dev` took them, [verified](../verified/page.md); the Worker's own entry is below), and the KV write count over a day of a busy chain. **If it is wrong:** turn the badge off (Project settings → Repository → README badge) — the README keeps the last picture the Worker has.

## The README badge dialog (BTN-917)

Tests cover the dialog's pure parts (the switches over the fields, the default name, the releases link from the remotes, the snippet), the config write (`withBadge`), the check's answers for each Worker reply and network error, and the wiring that logs the network cause and gives the page only the notice; the dialog was shot on `dev:fake` (empty, filled, a refused and an unreachable check, 390 px, the light theme). Not checked live: "Check" against a deployed Worker (a real push and the picture read back, a wrong secret giving `badge.refused`, an old Worker giving `badge.rejected`), the preview refreshing as a real chain moves, the secret saved from the dialog reaching the next push without a restart, and the copied snippet in a GitHub README switching its picture with the reader's theme. **If it is wrong:** set `badge` and `EVEN_KEEL_BADGE_SECRET` by hand (`config-import`, `.env`) and write the README's `<picture>` from `docs/badge.md`.

## The badge's Worker on Cloudflare (BTN-916)

Tests with a fake KV cover the Worker's answers (401 for a wrong, missing or unset secret, 400 for every malformed state, the stored state, the drawing at the request's time in each mode, the light theme, 304 by `ETag`, 404 for other paths); `wrangler deploy --dry-run` bundled it, and a local `wrangler dev` (workerd with its local KV) took real pushes from the service's `postBadge` and served the SVG, 304 included ([verified](../verified/page.md)). Not checked on Cloudflare: the Deploy to Cloudflare button (that it copies only `deploy/badge/` into the user's repository, creates the KV namespace from a binding without an id, asks for `BADGE_SECRET` from `.dev.vars.example` and shows the `cloudflare.bindings` descriptions), the manual `wrangler deploy` creating the namespace by itself (wrangler ≥ 4.45), the deployed Worker's answers and headers through Cloudflare's edge, and the `<picture>` of both themes on GitHub. The button URL points at `main`, so it works only once a release brings the folder there. Since BTN-941 the drawing is the npm package `even-keel-badge`: a tarball of it, installed into a copy of the folder, passed `tsc`, the Worker's tests and `wrangler deploy --dry-run`, but not checked are Cloudflare's build installing it without a lock (the `latest` tag) and the first publish by `publish.yml`, which needs the name held by a placeholder and its trusted publisher set first (`docs/releases.md`). **If it is wrong:** deploy by hand as the folder's README says, creating the namespace with `wrangler kv namespace create BADGE` and putting its `id` into `wrangler.jsonc` if the deploy does not.
