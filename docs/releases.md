# Releases

How a version of Even Keel is made and released, and how the released one is fixed while the next is being built. The task order itself is in `docs/chain.md`.

## Branches

Users of a clone update with `git pull` (README, "Updating"), so whatever lands on `main` reaches them before any tag; the npm package reaches its users only at a release ("Publishing to npm" below). Hence three kinds of branch, in two folders:

| Branch | Holds | Folder and Even Keel project | Moves by |
| --- | --- | --- | --- |
| `main` | the latest release, nothing else: it is always at the newest tag | none, nobody checks it out | a push of the release's commit at a release, never a commit of its own |
| `dev` | the next version | `even-keel`, project `BTN` (`branch: dev`); the service runs here | the chain of `BTN` |
| `release/v<x.y>` | fixes of the released `x.y`, gathered until the next patch | `even-keel-github`, project `EKR` (`branch: release/v<x.y>`) | the chain of `EKR` |

- Merges go one way only: `release/v<x.y>` into `dev` ("A fix" below). `main` has no commits of its own, so nothing is ever merged out of it.
- Only the newest minor version gets patches: once `v0.2.0` is out, `release/v0.1` is left as it is.
- `git sync` (the global alias) syncs the branch the checkout is on with every remote; `dev` and `release/*` are pushed only by it.
- Two Huly projects, because before BTN-172 Even Keel could run neither two projects on one tracker project nor a chain of one milestone's tasks. Now it can (`docs/chain.md`, "Several projects on one tracker project"): the fixes may go back into `BTN` as a milestone, with a release project of its own key on the `BTN` tracker project (`huly: BTN`, `requiredMilestones: ["v0.1"]`, and `excludedMilestones: ["v0.1"]` on `BTN`), and `EKR` closes. Until that switch `EKR` stays.
- Both folders share one auto-memory: Even Keel keeps a store per folder (`sharedMemory`, `docs/accounts.md`), and `~/.claude-memory/D--Projects-git-repos-even-keel-github` is a junction to `even-keel`'s store, made by hand on 2026-10-20. A new release branch reuses `even-keel-github`; a further clone of the repository needs the same junction.

## Trackers

- `BTN` — the next version. Its Huly milestones are versions (`v0.2`, `v0.3`); a task belongs to the version it ships in, an idea for later goes into a later milestone. A blocker must not sit in a later milestone than the task it blocks: the chain halts on that (`order.later`).
- `EKR` — fixes of the released version, its milestone named by that version (`v0.1`), so the changelog of the chain's milestone head is the patch's section.
- A bug of the released version that must reach its users before the next minor is an `EKR` task; one that can wait is a `BTN` task in the next milestone.
- Urgency is the priority: an `Urgent` fix is released as a patch at once, the others wait for the next patch.
- GitHub issues are where users report. No chain reads them: the user picks the ones worth doing and puts a label on, and Even Keel takes each into `EKR` or `BTN` with a link back, by the label each of the two projects names in its `intakeLabel` (`docs/trackers.md`, "Taking GitHub issues in"), so the work and its decisions stay in Huly and a stranger's comment steers nothing. The issue gets one line when its task is done, the version that ships it, and is closed by Even Keel when that release is published (step 7 below). A session asked to take an issue by hand copies it the same way.

## A fix

1. The chain of `EKR` works it like any task and merges it into `release/v0.1`; Even Keel closes the task and syncs the branch.
2. The fix is carried into `dev` by Even Keel once `EKR` names `BTN` in its `mergeInto` (BTN-172, `docs/chain.md`, "Carrying a release project forward"): it merges `release/v0.1` into `dev` in `even-keel` while the chain of `BTN` stands, and syncs `dev`; the project's page has "Carry now". It may carry several fixes at once, but not past the next release of `dev`: before one, press "Carry now". A conflict holds the carry and is the user's to resolve; `CHANGELOG.md` is the usual one, where `dev`'s `Unreleased` meets the patch's section — both stay. By hand it is `git sync`, `git merge --no-edit origin/release/v0.1`, `git sync` in `even-keel`, while the chain of `BTN` is not merging. The temporary `commands.afterGreen` of `EKR` (a fast-forward of `dev`) goes once `mergeInto` is set.

## A release

The release is the user's: no session bumps the version, tags or publishes. A patch is released from `release/v<x.y>` in `even-keel-github`, a minor version from `dev` in `even-keel`; below the branch is called the source.

1. Every task meant for it is closed and the CI of the source is green.
2. The CLI check ("Checking a CLI version" below) passes on the newest Claude Code and Codex, and both checked CLI versions are raised to the ones it passed on: `checked` of the Claude Code adapter (`src/claude/adapter.ts`) and of the Codex one (`src/codex/adapter.ts`), and the "Last checked against" line of the README's "Before you run it" — a test keeps them equal. The page warns about any other installed version (BTN-249, `docs/web.md`).
3. `version` in `package.json` is set to the release (`0.1.0`) on the source: the service shows it in the gear menu and compares it with the latest release (`docs/web.md`, "Updates"). In `CHANGELOG.md` the `Unreleased` section becomes `## [0.1.0] - <date>`. The section is written from the milestone's head in the chain (BTN-209, `docs/web.md`) — `EKR`'s for a patch, `BTN`'s for a minor version: the agent drafts it from the done tasks, the user edits it in words or in the file, "Write" commits it to the project's branch, and "Add N" works in the tasks closed since. Once the tag exists the section is frozen: tasks closed after it go into a new section above, headed as the next patch (`## [0.1.1]`), never into the released one.
4. In the source's folder, without leaving its branch: `git sync`, `git tag v0.1.1`, then for each remote `git push <remote> <source>:main v0.1.1`. A remote takes it only as a fast-forward of its `main`; a refusal means `main` got a commit of its own: stop and find it before the other remote. The global `pre-push` hook names the tasks of the pushed range as merged; they are closed already.
5. The tag's push to `github` publishes the npm package of that version ("Publishing to npm" below): check that the workflow `Publish` went through and that `npm view even-keel version` names the release.
6. A minor version also gets its branch, `git branch release/v0.2 v0.2.0` and a push of it to both remotes; then `even-keel-github` is switched to it, and so is `EKR`'s `branch`.
7. A GitHub release from the tag. Drafts and prereleases are not offered to installed copies; a published release is, within 12 h.

## Publishing to npm

The npm package `even-keel` is the second way to install (`npx even-keel`, `docs/service.md`, "An npm install"); its version is the release's, `0.2.0` for `v0.2.0`. `.github/workflows/publish.yml` publishes it on the push of a `v*` tag to GitHub: it refuses a tag that is not `v` + `version` of `package.json`, builds in `prepack` (an empty `dist/` first, so nothing stale is shipped) and publishes; a tag with a `-` (`v0.2.0-rc.1`) goes under the dist-tag `next`, so `npx even-keel` and `even-keel update` stay on the release. What the package holds is the `files` of `package.json`: the compiled `dist/src`, `dist/tally` (with Tally's `.sql`, copied by `scripts/copy-assets.ts`) and `dist/web`, the plugins, the status line, the service scripts, `tally/bin` and the examples; `npm pack --dry-run` lists it.

There is no npm token: npm trusts the workflow by OIDC. Once, on npmjs.com, the package's Settings → Trusted publishing names the GitHub repository `NamerekT/even-keel` and the workflow `publish.yml`; publishing needs npm 11.5.1 or later, which the workflow installs. The name was held before by placeholder versions `0.0.1` and `0.0.2`. A failed publish is repeated by re-running the workflow on the same tag; a published version cannot be replaced, only followed by a patch.

**A revert release** takes back what an earlier release broke: a new version (a patch) whose notes have a `### Reverted` section listing what it takes back, which the update window shows as a mark over the release (`revertedOf`, `docs/service.md`, "Updating from the page"). **A revert release never rolls back the storage format**: it keeps the `SCHEMA_VERSION`, the database steps (`STEPS`) and the Tally schema of the release it follows, with their migrations, and reverts only the behaviour. Copies that updated already have their state in the new format, and an older reader on it stops with only the page; the page's "Revert" is refused across a storage change for the same reason.

## Starting the branches (2026-10-20)

`dev` and `release/v0.1` were branched from `main` before `v0.1.0`, so that 0.2 could start while 0.1 is still being checked: `v0.1.0` is released from `release/v0.1` as any patch is, by step 4 above. `even-keel` went to `dev` and `BTN`'s `branch` with it; `even-keel-github` went to `release/v0.1`; in Even Keel the project `EVK` (GitHub issues of this repository) was removed and `EKR` added on that folder and branch. The `BTN` tasks of `v0.1` still open then (BTN-135, BTN-149, BTN-161, BTN-162, BTN-241) carry `Вручную` and are done by hand in `even-keel-github`; the push of the release to `main` closes them.

## Checking a CLI version

`npm run cli-check -- claude <account> [version]` (or `codex`) runs one live session of a cheap model (`haiku`, `gpt-5.6-luna`) through the `Agent` calls the chain and the page use (BTN-253, `scripts/cli-check.ts`): Even Keel's copy of the version, the sign-in, a launch, the daemon's version, an `AskUserQuestion` seen as the page sees it (Codex asks in text), the answer sent as the chat sends it (stop, then `resume` with `replyPrompt`), the file it writes, the `CHECKPOINT:` line, the chat's feed with the question, the answer and the last reply, the transcript, the stop, and `/usage` once (`--no-usage` leaves it out). The version is the adapter's `checked` by default. Two Haiku runs did not move a five-hour window by a whole percent.

- The account folder must have no live session: the check refuses one that has. A Claude daemon on the checked version takes the folder over, so the check stops it at the end, and the next chain launch there starts one on the pinned version.
- Its copies and its working folder are under `<state>/cli-check/`, not the service's `cli/`: the service downloads its own once `checked` is raised. The working folder is a detached linked worktree of the repository the state folder lies in, made afresh and removed at the end, as a chain task's place is: from Claude Code 2.1.306 a background session's `Write`/`Edit` in a main checkout is refused until it calls `EnterWorktree`, and then it writes in a worktree of its own and its transcript moves to that folder's project (a `relocated` line). Outside a repository it is a plain folder, which the CLI does not guard. Either way it takes the trust of the checkout it lies in; an account that has not trusted the checkout fails the launch with "Workspace not trusted".
- It runs from a terminal, not from the service: what differs in the Windows service's session 0 (the Codex sandbox, BTN-171) is not covered.
- The CLI is released every day or two, and a new model may need a newer one (an old version does not know its alias, Codex lists models by the client's version). A version need not wait for a release of Even Keel: the check passes, `checked` is raised in a task of its own, and the service downloads the copy at its next call after the restart.

Passed on 2026-10-19: Claude Code 2.1.303 and codex-cli 0.163.0 on Windows x64. On 2.1.303 a stopped `AskUserQuestion` is in the transcript after the resume, with the result "Tool call interrupted"; the reply still repeats the question, and the session answered it.

Passed on 2026-10-21: Claude Code 2.1.306 on Windows x64 (EKR-16). Its new guard (`worktree.bgIsolation`, `CLAUDE_BG_ISOLATION`) refuses a background session's file tools — not Bash — in a main checkout unless the session's folder or the file is in a linked worktree; every chain session runs in one (a task worktree, a slot, the fix's place), so by the binary's code a session's `git merge` in the main checkout and its conflict edits there pass. A live NBC-105 session on 2.1.306 edited its task worktree without a refusal. Even Keel finds a moved transcript anyway: it looks for `<session>.jsonl` in every project folder.

Passed on 2026-10-22: Claude Code 2.1.308 on Windows x64, for 0.1.1; codex-cli was still 0.163.0.

## Tally across clones

- A task's cost is by its ID, whatever folder its sessions ran in.
- A message with a task belongs to the Even Keel project of the task key, so every clone of `BTN` counts as `BTN`; a session without a task in a clone that is not a configured project is its own folder group on `/stats`.
- Tally keeps a Huly task's milestone (`tasks.milestone`, BTN-172), and the view `milestone_costs` sums the cost per project and milestone, so spend per version is a query; `/stats` does not show it.
- The rule history from git reads each project's `branch` (`gitVersions` in `tally/src/rule-history.ts`): a rule changed on `dev` shows in it when it lands on `dev`. The rule files are snapshotted per folder, so one change of `CLAUDE.md` shows once per clone.
