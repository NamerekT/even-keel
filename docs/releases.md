# Releases

How a version of Even Keel is made and released, and what a fix of an already released version would take. The task order itself is in `docs/chain.md`.

## A milestone is a version

- The Huly milestones of `BTN` are versions: `v0.1`, `v0.2`. A task belongs to the version it ships in; an idea for later goes into a later milestone, not into the current one.
- All work goes into `main`, through the usual chain: one project, one main checkout, no release branches. The chain runs the tasks of an earlier milestone before those of a later one (`docs/chain.md`, "Order"), so `v0.2` starts on its own once the last `v0.1` task is closed.
- A blocker must not sit in a later milestone than the task it blocks: the chain halts on that (`order.later`).

## A release is a tag on `main`

The release is the user's: no session bumps the version, tags or publishes.

1. Every task of the milestone is closed and the CI of `main` is green.
2. `version` in `package.json` is set to the release (`0.1.0`): the service shows it in the gear menu and compares it with the latest release (`docs/web.md`, "Updates"). In `CHANGELOG.md` the `Unreleased` section becomes `## [0.1.0] - <date>`; the changelog draft of the milestone's head lists the tasks that section misses.
3. A tag `v0.1.0` on that commit of `main`, pushed to both remotes.
4. A GitHub release from the tag. Drafts and prereleases are not offered to installed copies; a published release is, within 12 h.

## A fix of a released version

Only needed when `main` already holds unreleased work of the next version and the fix cannot wait for it. Until then a fix is an ordinary task of the current milestone, released as the next patch from `main`.

Today it is done by hand, outside the chain:

1. `git switch -c release/v0.1 v0.1.0` in a separate clone (not a worktree of the main checkout: a worktree finds the main checkout's `.mcp.json` by walking up and does not read its `.claude/settings.local.json`).
2. The fix is committed there, `version` goes to `0.1.1`, the tag `v0.1.1` and a release follow as above.
3. `release/v0.1` is merged into `main`, otherwise the next version ships the bug again.

The global hooks close a task only on `main`/`master` (`is_main_branch` in `~/.githooks/_common.sh`), so a task fixed on `release/v0.1` is closed by hand or by the merge of step 3.

Even Keel cannot yet run a chain for a release branch next to the chain of `main`: the config refuses two projects with one key (`config.projectTwice`), and for Huly the key is the Huly project itself; nor can the chain take only one milestone's tasks. Project kinds (main, release, service), a chain rule by milestone and the forward merge of a release project after Done are BTN-172.

## Tally across clones

- A task's cost is by its ID, whatever folder its sessions ran in.
- A message with a task belongs to the Even Keel project of the task key, so every clone of `BTN` counts as `BTN`; a session without a task in a clone that is not a configured project is its own folder group on `/stats`.
- Tally keeps no milestone of a task, so spend per version is not shown.
- The rule history from git reads `main` literally (`gitVersions` in `tally/src/rule-history.ts`), not the project's `branch`.
