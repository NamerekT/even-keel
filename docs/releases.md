# Releases

How a version of Even Keel is made and released, and how the released one is fixed while the next is being built. The task order itself is in `docs/chain.md`.

## Branches

Users install with `git clone` and update with `git pull` (README, "Updating"), so whatever lands on `main` reaches them before any tag. Hence three kinds of branch:

| Branch | Holds | Folder | Moves by |
| --- | --- | --- | --- |
| `main` | the latest release, nothing else: it is always at the newest tag | none needs it checked out | a fast-forward at a release, never a commit of its own |
| `dev` | the next version | `even-keel-dev`, the `BTN` project of Even Keel (`branch: dev`) and the service | the chain |
| `release/v<x.y>` | fixes of the released `x.y`, gathered until the next patch | `even-keel`, the main checkout | sessions started by hand |

- Merges go one way only: `release/v<x.y>` into `dev` after every fix ("A fix" below). `main` has no commits of its own, so nothing is ever merged out of it.
- Only the newest minor version gets patches: once `v0.2.0` is out, `release/v0.1` is left as it is.
- Until `v0.1.0` is tagged `main` plays `dev`'s part; `dev` and `release/v0.1` are branched from that tag.
- `git sync` (the global alias) syncs the branch the checkout is on with every remote; each of these branches is pushed only by it.

## Milestones and labels

- The Huly milestones of `BTN` are versions: `v0.1`, `v0.2`. A task belongs to the version it ships in; an idea for later goes into a later milestone, not into the current one.
- A bug of a released version that must reach its users before the next minor goes into that version's milestone (`v0.1`) with the label `Manual`: the chain of `dev` takes every open `BTN` task, earliest milestone first (`docs/chain.md`, "Order"), and `Manual` is what keeps it out. A bug that can wait goes into the next milestone like any task.
- Urgency is the priority: an `Urgent` fix is released as a patch at once, the others wait for the next patch.
- A blocker must not sit in a later milestone than the task it blocks: the chain halts on that (`order.later`).

## A fix

1. A session started by hand in `even-keel` on `release/v0.1`: the task's branch from `release/v0.1`, merged back into it, then `git sync`.
2. The fix is carried into `dev` in the same folder: `git switch dev`, `git sync`, `git merge --no-edit release/v0.1`, `git sync`, `git switch release/v0.1`. The chain of `dev` takes it up before its next task (`fastForwardMain`, `src/git/sync.ts`) or at the sync after a Done. A conflict is the user's to resolve; `CHANGELOG.md` is the usual one, where `dev`'s `Unreleased` meets the patch's section — both stay.
3. The task stays open until the patch is out: the global `post-merge` hook closes the tasks named in a merge only on `main`, and the fast-forward of the release is such a merge. A session may close it earlier through the tracker.

Even Keel does none of this yet: two projects with one tracker key are refused (`config.projectTwice`), and the chain cannot take one milestone's tasks. A project of `release/v0.1` with a milestone rule and the merge into `dev` after its Done is BTN-172.

## A release

The release is the user's: no session bumps the version, tags or publishes. A patch is released from `release/v<x.y>`, a minor version from `dev`; below the branch is called the source.

1. Every task of the milestone meant for it is closed (for a patch: merged into the source) and the CI of the source is green.
2. The CLI check ("Checking a CLI version" below) passes on the newest Claude Code and Codex, and both checked CLI versions are raised to the ones it passed on: `checked` of the Claude Code adapter (`src/claude/adapter.ts`) and of the Codex one (`src/codex/adapter.ts`), and the two "Last checked against" lines of the README's "Before you run it" — a test keeps them equal. The page warns about any other installed version (BTN-249, `docs/web.md`).
3. `version` in `package.json` is set to the release (`0.1.0`) on the source: the service shows it in the gear menu and compares it with the latest release (`docs/web.md`, "Updates"). In `CHANGELOG.md` the `Unreleased` section becomes `## [0.1.0] - <date>`. The section of a minor version is written from the milestone's head in the chain (BTN-209, `docs/web.md`): the agent drafts it from the done tasks, the user edits it in words or in the file, "Write" commits it to the project's branch, and "Add N" works in the tasks closed since. A patch's section is written by hand on `release/v<x.y>`: its `Manual` tasks are not in the chain, and "Write" commits to `dev`. Once the tag exists the section is frozen: tasks closed after it go into a new section above, headed as the next patch (`## [0.1.1]`), never into the released one.
4. `main` is brought to the source in `even-keel`: `git switch main`, `git sync`, `git merge --ff-only <source>`, then the tag (`v0.1.1`) on that commit, `git sync` and the tag pushed to both remotes, and back to `release/v<x.y>`. A fast-forward that fails means `main` got a commit of its own: stop and find it. A minor version also gets its branch: `git branch release/v0.2 v0.2.0`, synced.
5. A GitHub release from the tag. Drafts and prereleases are not offered to installed copies; a published release is, within 12 h.

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
