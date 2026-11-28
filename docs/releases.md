# Releases

How a version of Even Keel is made and released, and how the released one is fixed while the next is being built. The task order itself is in `docs/chain/entry.md`.

## Branches

A clone on `main` is updated with `git pull` ([`guide/updating.md`](guide/updating.md#updating)), so whatever lands on `main` reaches its users before any tag; the npm package reaches its users only at a release ("Publishing to npm" below). Hence three kinds of branch, in two folders:

| Branch | Holds | Folder and Even Keel project | Moves by |
| --- | --- | --- | --- |
| `main` | the latest release, nothing else: it is always at the newest tag | none, nobody checks it out | a push of the release's commit at a release, never a commit of its own |
| `dev` | the next version | `even-keel`, project `BTN` (`branch: dev`); the service runs here | the chain of `BTN` |
| `release/v<x.y>` | fixes of the released `x.y`, gathered until the next patch | `even-keel-github`, project `EKR` (`branch: release/v<x.y>`) | the chain of `EKR` |

- Merges go one way only: `release/v<x.y>` into `dev` ("A fix" below). `main` has no commits of its own, so nothing is ever merged out of it.
- Only the newest minor version gets patches: once `v<x.y+1>.0` is out, `release/v<x.y>` is left as it is.
- There is one remote, `origin` on GitHub; the self-hosted Forgejo copy is a read-only pull mirror of it, never pushed to. `git sync` (the global alias: fetch, merge, push) syncs the checkout's branch with `origin`; `dev` and `release/*` are pushed only by it.
- Two tracker projects, `BTN` and `EKR`. A release project of its own key on `BTN`'s tracker, by milestone, would do as well (`docs/chain/projects.md`, "Several projects on one tracker project"); `EKR` stays for now. Both are on Even Keel's built-in tracker since 2026-11-22 (BTN-1407); older commits and notes name Huly.
- Both folders share one auto-memory: Even Keel keeps a store per folder (`sharedMemory`, `docs/accounts.md`), so on every machine with both clones the store of `even-keel-github` is a link to `even-keel`'s (a junction on Windows, a symlink elsewhere), made by hand. A new release branch reuses `even-keel-github`; a further clone needs the same link.

## Trackers

- **`BTN`** — the next version. Its milestones are versions (`v0.4`, `v0.5`); a task belongs to the version it ships in, an idea for later goes into a later milestone. A blocker must not sit in a later milestone than the task it blocks: the chain halts on that (`order.later`).
- **`EKR`** — fixes of the released version, its milestone named by that version (`v0.3`), so the changelog of `EKR`'s milestone is the patch's section.
- **Which one.** A bug of the released version that must reach its users before the next minor is an `EKR` task; one that can wait is a `BTN` task in the next milestone. Urgency is the priority: an `Urgent` `EKR` fix is released as a patch at once, the others wait for the next patch.
- **GitHub issues** are where users report. No chain reads them, and a stranger's comment steers nothing: the work and its decisions stay in our tracker.
  1. The user picks an issue worth doing and puts on the label one of the two projects names in its `intakeLabel`.
  2. Even Keel takes it into `EKR` or `BTN` with a link back (`docs/trackers/github.md`, "Taking GitHub issues in"). A session asked to take an issue by hand copies it the same way.
  3. When the task is done the issue gets one line naming the version that ships it.
  4. Even Keel closes the issue once the GitHub release of that version is published (step 11 of "A release").

## A fix

1. The chain of `EKR` works it like any task and merges it into `release/v<x.y>`; Even Keel closes the task and syncs the branch.
2. Even Keel carries the fix into `dev`, since `EKR` names `BTN` in its `mergeInto` (BTN-172, `docs/chain/projects.md`, "Carrying a release project forward"):
   - **By itself** it merges `release/v<x.y>` into `dev` in `even-keel` while the chain of `BTN` stands, and syncs `dev`. It may carry several fixes at once, but not past the next release of `dev`: before one, press "Carry now" on the project's page.
   - **A conflict** holds the carry until "Resolve with the agent" (the session `EKR-CARRY` in the chain of `BTN`, BTN-369; at once with `EKR`'s `carryAgent` on or in unattended mode, BTN-370) or a merge by hand. `CHANGELOG.md` is the usual one, where `dev`'s `Unreleased` meets the patch's section: both stay.
   - **By hand**, while the chain of `BTN` is not merging: `git sync`, `git merge --no-edit origin/release/v<x.y>`, `git sync` in `even-keel`.

## A release

The release is the user's: no session bumps the version, tags or publishes. A patch is released from `release/v<x.y>` in `even-keel-github`, a minor version from `dev` in `even-keel`; below the branch is called the source. The example is the minor `0.4.0`; a patch goes the same way from its release branch, with no step 10.

1. **The limit answers of other plans**, while the milestone still has open tasks: the answers of the plans we have no account for are searched again, since the date of the last search (`docs/sessions/limits.md`, "Answers of plans we have no account for"). A new shape is a task of this release (in `EKR` for a patch), and the search's date goes into that section. Providers change these answers between releases, and nobody remembers the search otherwise.
2. **Tasks and CI.** Every task meant for the release is closed and the CI of the source is green.
3. **The nights.** The last nights of "Real CLIs", "Tracker contract" and "macOS" and the last Huly contract on `dev` are green: `sh scripts/nights-green.sh` says so ([`docs/ci/workflows.md`](ci/workflows.md#the-release-gate-of-the-nights)).
   - The Huly contract is run by hand, since the night has no Huly stand: `sh scripts/huly-contract.sh` on the workstation brings Huly up, runs the contract on `dev`, waits for it and brings Huly down (its up and down commands come from the host's own config, not the repository).
   - "macOS" with no run on `dev` yet holds the release too: `gh workflow run macos.yml --ref dev` gives it one, until a release brings its schedule to `main`.
   - A red night, or a Huly contract that is red or never ran, holds the release until a fix on `dev` and a green run. `publish.yml` checks the same before `npm publish`, so a tag pushed past it publishes nothing until the workflow `Publish` is re-run once they are green.
   - `cli-latest.yml` does not hold the release: a red run calls for "Checking a CLI version" below, not a fix to `dev`.
4. **The CLIs.** The CLI check ("Checking a CLI version" below) passes on the newest Claude Code, Codex, OpenCode and Copilot CLI, and the checked versions are raised to the ones it passed on: `checked` of each adapter (`src/claude/adapter.ts`, `src/codex/adapter.ts`, `src/opencode/adapter.ts`, `src/copilot/adapter.ts`) and the "Last checked against" line of the README's "Before you run it" — a test keeps them equal. The page warns about any other installed version (BTN-249, `docs/web/interface.md`).
5. **The guide's pictures** are shot again on the source: `npm run guide-shots` (`docs/web/screenshots.md`, "The guide's frames"). Frames it reports `changed` are looked at — the interface moved under the guide's words, so the text around them may need a fix too — and committed with any such fix before step 6; all `same` needs no commit.
6. **The version.** `version` in `package.json` is set to the release (`0.4.0`) on the source: the service shows it in the gear menu and compares it with the latest release (`docs/web/header.md`, "Updates").
7. **The changelog.** In `CHANGELOG.md` the `Unreleased` section becomes `## [0.4.0] - <date>`. It is written from the changelog of the release's milestone on the project page (BTN-209, `docs/web/project-page/head.md`) — `BTN`'s for a minor version, `EKR`'s for a patch: the agent drafts it from the done tasks, the user edits it in words or in the file, "Write" commits it to the project's branch, and "Add N" works in the tasks closed since. Once the tag exists the section is frozen: tasks closed after it go into a new section above, headed as the next patch (`## [0.4.1]`), never into the released one.
8. **The tag and `main`.** In the source's folder, without leaving its branch: `git sync`, `git tag v0.4.0`, `git push origin <source>:main v0.4.0`. `origin` takes it only as a fast-forward of its `main`; a refusal means `main` got a commit of its own: stop and find it. The global `pre-push` hook names the tasks of the pushed range as merged; they are closed already. GitHub's CI does not check this commit again if its workflows are green on the source (`docs/ci/workflows.md`, "A commit already green"): wait for the source's runs to end before this step, or `main` gets a full run of its own.
9. **npm.** The tag's push publishes the npm packages of that version ("Publishing to npm" below): check that the workflow `Publish` went through and that `npm view even-keel version` and `npm view even-keel-badge version` name `0.4.0`.
10. **A minor version's branch**: `git branch release/v0.4 v0.4.0`, `git push origin release/v0.4`; then `even-keel-github` is switched to it, and so is `EKR`'s `branch`.
11. **The GitHub release** from the tag. Drafts and prereleases are not offered to installed copies; a published release is, within 12 h. Publishing it closes the issues its tasks shipped ("Trackers" above).
12. **The repository's description and topics** are settings, not files: no push changes them. If the README's top changed in this release, they are brought in line with it the same day (`gh repo edit NamerekT/even-keel --description … --add-topic …`), never before step 8, or they promise what `main` does not have yet.

## Publishing to npm

The npm package `even-keel` is the second way to install (`npx even-keel`, [`service/platforms.md`](service/platforms.md#an-npm-install-btn-265)); its version is the release's, `0.4.0` for `v0.4.0`. `.github/workflows/publish.yml` publishes it on the push of a `v*` tag:

- **Refusals.** A tag that is not `v` + `version` of `package.json`, and a release while a nightly workflow is red (`scripts/nights-green.sh`, step 3 above).
- **The build** is in `prepack`, an empty `dist/` first, so nothing stale is shipped. What the package holds is the `files` of `package.json`: the compiled `dist/src`, `dist/tally` (with Tally's `.sql`, copied by `scripts/copy-assets.ts`) and `dist/web`, the plugins, the status line, the service scripts, `tally/bin` and the examples; `npm pack --dry-run` lists it.
- **The channel.** A tag with a `-` (`v0.4.0-rc.1`) goes under the dist-tag `next`, so `npx even-keel` and `even-keel update` stay on the release.
- **npm's review.** A published version first sits in npm's automated review ("Validating" on the package's Versions tab, a few minutes): until it is "Published", installing it fails (`ETARGET`, then a 404 on its tarball), and that 404 stays in npm's CDN for about 5 minutes after the review passes. Start a live check of a new version only once the Versions tab says "Published".

The same run then publishes the second package, `even-keel-badge` (`packages/badge`, BTN-941): the badge's drawing, which the badge's Cloudflare Worker (`deploy/badge`) installs as its latest release (`docs/badge.md`, "Kept apart from the package"). Its `package.json` says `0.0.0`; the step sets the tag's version, so a release edits no second file. It builds in its own `prepack` (`packages/badge/build.mjs`, an empty `dist/` first) and goes under `next` for a tag with a `-`, like the main package. A change of the drawing has no release of its own: it reaches deployed Workers with the next release.

**Trusted publishing.** There is no npm token: npm trusts the workflow by OIDC. On npmjs.com each package's Settings → Trusted publishing names the GitHub repository `NamerekT/even-keel` and the workflow `publish.yml`; publishing needs npm 11.5.1 or later, which the workflow installs. npm offers that setting only for a package that exists, so a new package name is first held by a placeholder published by hand (`npm publish` of `0.0.1` from a folder with only a `package.json` of that name), then the setting. A failed publish is repeated by re-running the workflow on the same tag: each step skips a version npm already has. A published version cannot be replaced, only followed by a patch.

**A revert release** takes back what an earlier release broke: a new version (a patch) whose notes have a `### Reverted` section listing what it takes back, which the update window shows as a mark over the release (`revertedOf`, `docs/guide/updating.md`, "From the page"). **A revert release never rolls back the storage format**: it keeps the `SCHEMA_VERSION`, the database steps (`STEPS`) and the Tally schema of the release it follows, with their migrations, and reverts only the behaviour. Copies that updated already have their state in the new format, and an older reader on it stops with only the page; the page's "Revert" is refused across a storage change for the same reason.

### Docker image

After both npm publishes succeed, the image job builds the same checkout for `linux/amd64` and `linux/arm64` and pushes one multi-platform image to GHCR. Its tags are the package version without `v` and the npm channel (`latest` or `next`). The GHCR package is public, so a Compose client without a sign-in can pull it.

## Checking a CLI version

Whenever an adapter's `checked` version is raised, in this order:

1. **The downloads**: `npm run cli-fetch` locally and the manual **CLI downloads** workflow (`.github/workflows/cli-fetch.yml`, `--ref dev` for the development branch) on GitHub ("The download check" below).
2. **The live check**: `npm run cli-check -- <provider> <account> [version]` (`claude`, `codex`, `opencode`, `copilot`) for each new version; it saves a capture of the transcripts.
3. **The comparison**: `npm run cli-compare -- <provider> <old-version> <new-version>` reports added and removed event types and nested field paths across all captures of each version, including JSON inside OpenCode rows. Review the differences.
4. **The tests**: the parser tests replay every saved capture.
5. **The pin**: raise `checked` in a task of its own (step 4 of "A release"), and add the check's row to [`verified/platforms.md`](verified/platforms.md).

Before raising Claude's `checked`, look at `claude setup-token --help` of the new version (2.1.327 has only `-h`): a flag that prints the sign-in link and the token without a terminal lets the page drive the long token instead of the command and the paste (BTN-1212, `docs/accounts/claude-kinds.md`, "Long-token accounts"); file a task when one appears.

A version need not wait for a release of Even Keel: the CLI is released every day or two, and a new model may need a newer one (an old version does not know its alias, Codex lists models by the client's version). `checked` lives in the adapters' code, so a raise reaches only what runs that code: the service on `dev` downloads the copy at its first call after the restart, installed packages and clones keep their own `checked` until they update to the release that carries it.

### What `cli-check` checks (BTN-253, `scripts/cli-check.ts`)

One live session of a cheap model (`haiku`, `gpt-5.6-luna`, the free `opencode/big-pickle`, Copilot's own `auto`) through the `Agent` calls the chain and the page use: Even Keel's copy of the version (the adapter's `checked` by default), the sign-in, a launch, the daemon's version, an `AskUserQuestion` seen as the page sees it (the other agents ask in text), the answer sent as the chat sends it (stop, then `resume` with `replyPrompt`), the file it writes, the `CHECKPOINT:` line, the chat's feed with the question, the answer and the last reply, the transcript, the context window, the package hooks, the limits shape and the stop.

- **The package hooks.** The session gets the real `agent-bridge` package through `Packages.startOf`, pinned in the check's own catalog and cache. A loopback stub on a free port records its hook requests; at least one must name the launched or resumed session. Claude and Copilot use the package's command hooks, Codex installs the plugin in the account folder, and OpenCode loads its JS plugin. Before a Codex launch, `hooks/list` with the turn's plugin flags must list hooks of the package and mark every one `trusted`. No hooks, a changed trust status or no request fails a named step with the received evidence.
- **The limits.** Claude's `/usage` is asked once (`--no-usage` leaves it out); Codex's limits are always read from this check's rollout, so a usage API answer or another session cannot mask a changed CLI format; OpenCode's and Copilot's are asked of ChatGPT or GitHub, not of the CLI, so they skip it with a note. The check requires a displayable five-hour, weekly or monthly window, or an explicit adapter `missing` answer, printed as `no data`. If Codex's rollout has non-null `rate_limits` but `limitsOfRollout` yields no displayable window, it fails with the received `rate_limits`. A windowless `premium` event after an earlier usable window must preserve that window. This checks parsing, not an actual limit refusal: spending the allowance deliberately is outside the check; two Haiku runs did not move a five-hour window by a whole percent.
- **The capture.** A successful check saves the question and answer transcripts in `test/fixtures/cli/<provider>/<version>/<content-hash>.json`, with the summary observed live, the probed context window and the limits evidence; a replay must match that summary before the file is saved. Repeating a version adds a capture, never overwrites one. What a capture holds and how the replay tests read it: [`test/fixtures/cli/README.md`](../test/fixtures/cli/README.md).
- **Anonymization.** Paths, session, tool and message ids, account emails, credentials and machine and user names are replaced before anything is written; event types, field names, token counts and model names stay.
- **The account's own context** is not touched by anonymization, so the check keeps it out of the session (BTN-724):
  - Claude runs with `CLAUDE_CODE_DISABLE_CLAUDE_MDS` and `CLAUDE_CODE_DISABLE_AUTO_MEMORY` (in the environment and in `--settings`, with `autoMemoryEnabled: false`) and every skill of the folder's `skills/` set `off` in `skillOverrides`;
  - Codex with `features.memories`, `memories.use_memories` and `memories.generate_memories` off (`SessionStart.noMemory`); Codex's global `AGENTS.md` has no switch;
  - then, before anonymization, a capture holding any trimmed line of 40 characters or more of the folder's `CLAUDE.md`, `AGENTS.md`, `AGENTS.override.md`, `rules/`, `projects/*/memory/`, `memories/` or a skill's `SKILL.md` (a description without its key) is not saved, and the check fails naming those files (`scripts/cli-sample-account.ts`).

### Its environment and traps

- **Copilot** on a machine sign-in refused every model named by `--model`, so its check runs on the CLI's default.
- **A live session** in the account folder makes the check refuse it. A Claude daemon on the checked version takes the folder over, so the check stops it at the end, and the next chain launch there starts one on the pinned version.
- **Its copies and working folder** are under `<state>/cli-check/`, not the service's `cli/`: the service downloads its own once `checked` is raised.
- **The working folder** is a detached linked worktree of the repository the state folder lies in, made afresh and removed at the end, as a chain task's place is: from Claude Code 2.1.306 a background session's `Write`/`Edit` in a main checkout is refused until it calls `EnterWorktree`, and then it writes in a worktree of its own and its transcript moves to that folder's project (a `relocated` line). Outside a repository it is a plain folder, which the CLI does not guard. Either way it takes the trust of the checkout it lies in; an account that has not trusted the checkout fails the launch with "Workspace not trusted".
- **Session 0.** From a terminal what differs in the Windows service's session 0 (the Codex sandbox, BTN-171) is not covered; the automatic run below goes through the service.

### The download check

`npm run cli-fetch` and `cli-fetch.yml` download the checked Claude Code, Claude SDK, Codex, OpenCode and Copilot through the same `fetch*` functions as `PinnedCli`, check each CLI's `--version`, and load the SDK module and check its package version (the SDK has no standalone CLI). No service, tracker or account sign-in is needed. The table names the platform, package or target, elapsed seconds and version or error; unsupported targets are skipped, any failed check exits with code 1. Copies are made under `.temp/cli-fetch-*` and removed afterwards; GitHub's job summaries keep the tables. The workflow covers Linux x64 (glibc and Alpine musl), native Linux arm64, macOS arm64 and Intel (`macos-15-intel`), and Windows x64 and arm64; the passes are rows of [`verified/platforms.md`](verified/platforms.md).

### The automatic run in the service (BTN-569)

With the setting "Check new CLI versions on this machine" (`cliCheck`, Even Keel's own, off by default: each run spends the account's limits; on the developer's machine on) the service runs the same steps itself (`src/cli-check/run.ts`, scheduled by `CliChecks` in `src/cli-check/scheduler.ts`, wired in `src/service/cli-check.ts`):

- **Which agents, which folder.** Each agent a project runs on by its provider, in the account folder the first such project chooses; no separate folder.
- **When.** The latest version is asked at most every 6 hours, from where `PinnedCli` downloads (`Agent.latest`: Claude Code's `latest` file on `downloads.claude.ai`, npm's `latest` dist-tag for `@openai/codex`, `opencode-ai` and `@github/copilot`). A version newer than `checked` and not tried yet is checked once; several released in a row — only the newest. Besides, once a week the `checked` version runs again: it catches what the provider changes without a new CLI (model lists, `/usage`, the ChatGPT and GitHub windows, OpenCode Zen's free models, the Copilot token). The service looks every 10 minutes whether a run is due.
- **The folder while it runs** (`AccountLease`, `src/cli-check/lease.ts`):
  - a run waits while the folder has a live session, with a banner naming the account by its label;
  - meanwhile the chain does not launch or resume sessions in that folder: a launch waits as for a slot (`cliCheck.chainWaits`), a resume after a limit, a temporary model error or for a main fix waits as for a sign-in;
  - other touches in the same minutes (a `CHECKPOINT:` handover, pull request feedback) are refused with `cliCheck.busy`, which pauses the chain until the user resumes it;
  - after the run the Claude daemon is stopped, as from the terminal, and the next launch starts one on the pinned version.
- **The result** is a banner per agent: waiting, running, passed, or failed with the step that failed and its reason; the whole run is in the log (`cli-check:` lines). The history (`cliCheck.history` in `service_state`) keeps the versions tried; a run the service's stop cut short is shown as interrupted and runs again. `/usage` is not asked, transcripts are not saved as samples, and `docs/verified/` gets no row per run: a row comes only with raising `checked`, which stays a task of its own.
