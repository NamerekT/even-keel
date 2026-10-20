# Releases

How a version of Even Keel is made and released, and how the released one is fixed while the next is being built. The task order itself is in `docs/chain.md`.

## Branches

Users install with `git clone` and update with `git pull` (README, "Updating"), so whatever lands on `main` reaches them before any tag. Hence three kinds of branch, in two folders:

| Branch | Holds | Folder and Even Keel project | Moves by |
| --- | --- | --- | --- |
| `main` | the latest release, nothing else: it is always at the newest tag | none, nobody checks it out | a push of the release's commit at a release, never a commit of its own |
| `dev` | the next version | `even-keel`, project `BTN` (`branch: dev`); the service runs here | the chain of `BTN` |
| `release/v<x.y>` | fixes of the released `x.y`, gathered until the next patch | `even-keel-github`, project `EKR` (`branch: release/v<x.y>`) | the chain of `EKR` |

- Merges go one way only: `release/v<x.y>` into `dev` ("A fix" below). `main` has no commits of its own, so nothing is ever merged out of it.
- Only the newest minor version gets patches: once `v0.2.0` is out, `release/v0.1` is left as it is.
- `git sync` (the global alias) syncs the branch the checkout is on with every remote; `dev` and `release/*` are pushed only by it.
- Two Huly projects, because Even Keel cannot yet run two projects on one tracker key (`config.projectTwice`) nor a chain of one milestone's tasks. With BTN-172 the fixes can go back into `BTN` as a milestone and `EKR` closes.
- Both folders share one auto-memory: Even Keel keeps a store per folder (`sharedMemory`, `docs/accounts.md`), and `~/.claude-memory/D--Projects-git-repos-even-keel-github` is a junction to `even-keel`'s store, made by hand on 2026-10-20. A new release branch reuses `even-keel-github`; a further clone of the repository needs the same junction.

## Trackers

- `BTN` — the next version. Its Huly milestones are versions (`v0.2`, `v0.3`); a task belongs to the version it ships in, an idea for later goes into a later milestone. A blocker must not sit in a later milestone than the task it blocks: the chain halts on that (`order.later`).
- `EKR` — fixes of the released version, its milestone named by that version (`v0.1`), so the changelog of the chain's milestone head is the patch's section.
- A bug of the released version that must reach its users before the next minor is an `EKR` task; one that can wait is a `BTN` task in the next milestone.
- Urgency is the priority: an `Urgent` fix is released as a patch at once, the others wait for the next patch.
- GitHub issues are where users report. No chain reads them: the user picks the ones worth doing and has a session copy each into `EKR` or `BTN` with a link back, so the work and its decisions stay in Huly and a stranger's comment steers nothing. Doing that by Even Keel is BTN-262.

## A fix

1. The chain of `EKR` works it like any task and merges it into `release/v0.1`; Even Keel closes the task and syncs the branch.
2. The fix is carried into `dev` by hand, in `even-keel`, while the chain of `BTN` is not merging: `git sync`, `git merge --no-edit origin/release/v0.1`, `git sync`. It may wait and carry several fixes at once, but not past the next release of `dev`. A conflict is the user's to resolve; `CHANGELOG.md` is the usual one, where `dev`'s `Unreleased` meets the patch's section — both stay.

## A release

The release is the user's: no session bumps the version, tags or publishes. A patch is released from `release/v<x.y>` in `even-keel-github`, a minor version from `dev` in `even-keel`; below the branch is called the source.

1. Every task meant for it is closed and the CI of the source is green.
2. The CLI check ("Checking a CLI version" below) passes on the newest Claude Code and Codex, and both checked CLI versions are raised to the ones it passed on: `checked` of the Claude Code adapter (`src/claude/adapter.ts`) and of the Codex one (`src/codex/adapter.ts`), and the "Last checked against" line of the README's "Before you run it" — a test keeps them equal. The page warns about any other installed version (BTN-249, `docs/web.md`).
3. `version` in `package.json` is set to the release (`0.1.0`) on the source: the service shows it in the gear menu and compares it with the latest release (`docs/web.md`, "Updates"). In `CHANGELOG.md` the `Unreleased` section becomes `## [0.1.0] - <date>`. The section is written from the milestone's head in the chain (BTN-209, `docs/web.md`) — `EKR`'s for a patch, `BTN`'s for a minor version: the agent drafts it from the done tasks, the user edits it in words or in the file, "Write" commits it to the project's branch, and "Add N" works in the tasks closed since. Once the tag exists the section is frozen: tasks closed after it go into a new section above, headed as the next patch (`## [0.1.1]`), never into the released one.
4. In the source's folder, without leaving its branch: `git sync`, `git tag v0.1.1`, then for each remote `git push <remote> <source>:main v0.1.1`. A remote takes it only as a fast-forward of its `main`; a refusal means `main` got a commit of its own: stop and find it before the other remote. The global `pre-push` hook names the tasks of the pushed range as merged; they are closed already.
5. A minor version also gets its branch, `git branch release/v0.2 v0.2.0` and a push of it to both remotes; then `even-keel-github` is switched to it, and so is `EKR`'s `branch`.
6. A GitHub release from the tag. Drafts and prereleases are not offered to installed copies; a published release is, within 12 h.

## Starting the branches (2026-10-20)

`dev` and `release/v0.1` were branched from `main` before `v0.1.0`, so that 0.2 could start while 0.1 is still being checked: `v0.1.0` is released from `release/v0.1` as any patch is, by step 4 above. `even-keel` went to `dev` and `BTN`'s `branch` with it; `even-keel-github` went to `release/v0.1`; in Even Keel the project `EVK` (GitHub issues of this repository) was removed and `EKR` added on that folder and branch. The `BTN` tasks of `v0.1` still open then (BTN-135, BTN-149, BTN-161, BTN-162, BTN-241) carry `Вручную` and are done by hand in `even-keel-github`; the push of the release to `main` closes them.

## Checking a CLI version

`npm run cli-check -- claude <account> [version]` (or `codex`) runs one live session of a cheap model (`haiku`, `gpt-5.6-luna`) through the `Agent` calls the chain and the page use (BTN-253, `scripts/cli-check.ts`): Even Keel's copy of the version, the sign-in, a launch, the daemon's version, an `AskUserQuestion` seen as the page sees it (Codex asks in text), the answer sent as the chat sends it (stop, then `resume` with `replyPrompt`), the file it writes, the `CHECKPOINT:` line, the chat's feed with the question, the answer and the last reply, the transcript, the stop, and `/usage` once (`--no-usage` leaves it out). The version is the adapter's `checked` by default. Two Haiku runs did not move a five-hour window by a whole percent.

- The account folder must have no live session: the check refuses one that has. A Claude daemon on the checked version takes the folder over, so the check stops it at the end, and the next chain launch there starts one on the pinned version.
- Its copies and its working folder are under `<state>/cli-check/`, not the service's `cli/`: the service downloads its own once `checked` is raised. The working folder is no repository of its own, so it takes the trust of the Even Keel checkout it lies in; an account that has not trusted the checkout fails the launch with "Workspace not trusted".
- It runs from a terminal, not from the service: what differs in the Windows service's session 0 (the Codex sandbox, BTN-171) is not covered.
- The CLI is released every day or two, and a new model may need a newer one (an old version does not know its alias, Codex lists models by the client's version). A version need not wait for a release of Even Keel: the check passes, `checked` is raised in a task of its own, and the service downloads the copy at its next call after the restart.

Passed on 2026-10-19: Claude Code 2.1.303 and codex-cli 0.163.0 on Windows x64. On 2.1.303 a stopped `AskUserQuestion` is in the transcript after the resume, with the result "Tool call interrupted"; the reply still repeats the question, and the session answered it.

## Tally across clones

- A task's cost is by its ID, whatever folder its sessions ran in.
- A message with a task belongs to the Even Keel project of the task key, so every clone of `BTN` counts as `BTN`; a session without a task in a clone that is not a configured project is its own folder group on `/stats`.
- Tally keeps no milestone of a task, so spend per version is not shown.
- The rule history from git reads `main` literally (`gitVersions` in `tally/src/rule-history.ts`), not the project's `branch`: a rule changed on `dev` shows in it only once it is released.
