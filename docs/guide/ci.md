# CI, pull requests and releases

After a task is merged, something has to say whether the main branch still works. Even Keel reads the repository's CI, or runs the project's own check commands, and has a red main branch fixed before the next task builds on it. This page also covers the pull request mode, release branches and changelog drafts.

- [CI](#ci)
- [A check without CI](#a-check-without-ci)
- [Pull requests](#pull-requests)
- [Release branches](#release-branches)
- [Changelog drafts](#changelog-drafts)

## CI

### What the chain does with the verdict

After a task is merged and `main` is pushed, the next task waits for the CI's verdict (as long as the project allows) while its worktree is prepared.

A red `main` first gets one rerun of its failed jobs on GitHub Actions and GitLab CI, so a flaky test does not start a fix (`ci.rerunFailed`, on by default).

Red again, it is fixed first: Even Keel stops the session working on the current task, starts a session to fix `main` — with the failed jobs, the end of the failed job's log and the commits of the push in its prompt, without a task in the tracker — and, once the fix is merged, continues the stopped session with a note to merge `main` into its branch.

A project can ask for a high-priority fix task in the tracker instead (`ci.fixTask`).

If the fix is red too, the chain pauses instead of starting another.

If the CI turns red just as a session starts, Even Keel waits until it can tell whether the session is working or waiting before making room for the fix. A session waiting for an answer keeps its question and is set aside without being stopped.

While Even Keel decides whether to rerun the failed jobs and waits for their result, the log shows the rerun's info entries without a red main notification.

A green rerun produces no red alert; a red rerun produces one.

If rerunning is off, unsupported or refused, the red notification follows the first verdict.

A CI marked "not counted" still warns independently.

Several projects in separate clones of one repository, on the same main branch, share a red `main`: while one of them fixes it, the others start no new task and start no second fix of the same break; their sessions already at work go on. Once the fix is green, they all go on.

### The CI panel

A badge in the project's head shows the CI of each remote — Forgejo Actions, GitHub Actions or GitLab CI, found from `git remote` and the workflow folders or root `.gitlab-ci.yml` file: whether the API answers and a runner takes the runs, the current push with its tasks and a row per workflow it started, each with its jobs and steps against that workflow's usual length, and the recent pushes, a dot per workflow.

The push, recent pushes and usual lengths belong to the project's configured branch.

A run that waits says when the runner is busy with another run, a run no runner took is grey rather than red, and a CI the chain does not wait for is marked "not counted".

When the next task waits — for the CI's verdict, for the project's own check, or for a push no runner took in time — the panel says so under the push it waits on, with the time.

Each push says whether the chain pushed it or someone did by hand, and a project with commands after a green main has an "After green" row: running, done, the command that failed, or skipped and why.

The API is polled only while a run is unfinished or after a push.

A failed CI outside the project's selection, or with the protection of main off, still gets a notification, which says that the chain does not use that CI to decide whether to continue.

## A check without CI

A project with no CI, or whose CI does not answer, can name its own check commands, such as `npm run typecheck && npm test`.

A session's merge into `main` waits until they pass in the task's worktree (a hook of the [agent-bridge](../../plugins/agent-bridge) plugin), and a failure goes back to the session to fix.

If `main` moved while the task ran, Even Keel runs the check again on `main` in the next task's worktree before that task starts; a failure there is handled like a red CI.

## Pull requests

With `pullRequests` on, a session does not merge its branch: Even Keel pushes it, opens a pull request on GitHub or Forgejo, or a merge request on GitLab, and takes the next task; review feedback and failed checks, with the end of the failed job's log, go back to the task's session, and a chain that ran out of tasks starts again for them by itself (one you stopped waits for **Start**).

When the tasks are GitHub issues and the pull request is on GitHub, Even Keel ends its body with `Closes owner/repo#N`, so the issue shows the pull request and GitHub closes it at the merge; with GitLab Issues on the same GitLab server it ends a merge request with `Closes #N` (an issue of another project: `Closes group/name#N`).

Feedback goes back to the task's session: reviews that ask for changes or comment, comments in the pull request's conversation (yours included: a forge does not let you request changes on a pull request opened with your own token) and failed checks.

Whose remarks count:

- on GitHub those of the repository's owner, the members of its organization, its collaborators and the token's own account — anyone else's is skipped with a line in the service log, and bots' are not feedback;
- on GitLab every note by a member with Reporter access or above, not system notes such as approvals and not bots;
- on Forgejo those of the token's own account and of anyone with write access or above to the repository — when the token's account is not an admin of the repository, Forgejo does not tell it others' access, and then only the token's account and the repository's owner count, so make the profile's account an admin of the repository for other reviewers — anyone else's is skipped with a line in the service log.

A chain that ran out of tasks with pull requests open starts again by itself when feedback comes on one of them; a chain you stopped waits for **Start**.

The merge closes the task in the tracker; a close without a merge returns it skipped, and its next run is told of the closed pull request and its comments.

A task that changed nothing in the repository (research, work already in `main`) is closed without a pull request.

It takes the token the remote's CI takes — a GitHub, GitLab or Forgejo profile on `/settings` → **Trackers and CI** — which then needs to write pull requests ([Token permissions](setup.md#token-permissions)); the branch itself is pushed by git on the service account's credentials.

Without a remote on GitHub, GitLab or Forgejo and a token for it the mode is not turned on: the switch in **Settings** → **Check and CI** stays off and says which is missing, and when it is the token, **Add profile** beside it opens **Trackers and CI** with a new profile of the remote's forge on the remote's address.

A project whose remote or token went away — whether its chain was running or you press **Start** or **Resume** — waits paused with the reason instead of starting tasks, with the same **Add profile** under it, or a button to the project's **Check and CI** when the remote is gone (its switch can still be turned off); it goes on by itself within a minute of the remote or the profile being added.

A session that writes on its own pull request is told to put the hidden line `<!-- even-keel:session -->` into its text, and such a comment is not feedback, even when it is posted with your token.

Use it at your own risk: on GitHub, opening, closing and merging a pull request, the owner's and collaborators' comments, reviews with line comments and failed runs reaching the session, `Closes owner/repo#N`, and the move to Done with the cleanup ran live, and Forgejo ran the same way with a conflict with the main branch; GitLab merge requests, their notes, line comments and failed pipelines ran live on GitLab.com and a self-managed server.

## Release branches

Fixes of a released version can run in a chain of their own while the next version goes on in another.

Clone the repository a second time, check out the release branch there and add it as a project on the same tracker project, with the same key or one of its own (`huly` then names the tracker project; on Linear, `TEAM/Project`).

Two projects of one key are told apart on the page by their name in brackets, `ABC (Release)`.

The two split the tracker's tasks by milestone: the release project requires the release's milestone (`chain.requiredMilestones`), the main one excludes it (`chain.excludedMilestones`), and Even Keel refuses a pair that would both take one task.

The "Add a project" form does this for you: on a tracker project another project already has, it asks for the milestones the new one takes ("Only tasks in milestones") and, as it adds the project, moves them into the other's **Project tasks** → "All except".

They read the tracker once between them.

### Carrying fixes forward

With `mergeInto` naming the main project, the release project is carried forward: Even Keel merges its branch into the main project's branch in the main project's checkout and pushes it, in batches, whenever the main chain stands — stopped, empty or paused — so a fix never lands in the middle of a task's merge.

**Carry now** on the release project's page does it at once.

A conflict is aborted and the carry waits, one line on the release project's page with the files and git's output under **Details**.

Press **Resolve with the agent** and a session without a tracker task, `<KEY>-CARRY` of the release project, merges the release commit in the main project's own worktree after that project's current task, on its model and account, keeping the main branch's structure and putting the release fix's meaning on top; it shows as a row of the main chain, and once the main branch has the release commit the carry is done and the row closes as "Carry of <KEY>: N commits".

A main project with no chain running gets one for this session alone.

**Skip** on that row lets the session go and the conflict waits again.

Turn on **Resolve a conflict with the agent by itself** under **Merges into**, or run unattended, and a conflict goes to that session at once, with no button to press; a session that did not land the carry gets no successor until the release branch moves, and then the carry is tried again.

Or resolve it by merging by hand.

A merge git refuses for another reason — the service's account has no git name and email, say — waits the same way, and the page shows git's message: fix that, then press **Carry now**.

Nothing is ever merged into `main` of a released version; that moves by your release.

The main project must be of the same repository — the two checkouts share a remote, or one is a clone of the other's folder: the settings offer only such projects, and a carry between two other repositories fetches nothing and says so.

If a carry merges but its push fails, the release project's page keeps the push error until Even Keel confirms that all remotes have the merge commit. It checks every minute, so a later push by hand or another task's sync clears the message automatically. A remote that cannot be reached leaves the message in place.

## Changelog drafts

A button on a milestone's head in the chain opens that milestone's changelog: before the first draft it shows how many tasks are done and open and the section your changelog file already has, and nothing is spent until you press "Write draft".

Then the agent writes the section in the Keep a Changelog format, from the titles and closing comments of its done tasks, in the language of your `CHANGELOG.md` (or `README.md`).

It runs read-only, on the account and model the project's next session would get, and starts from the section already in your changelog file, so your own edits there stay.

It writes for someone upgrading from the previous release, whose section it is given: a fix of something new in this release is part of that feature's entry, not a line under Fixed.

The section shows rendered or as Markdown, a switch above it that the page remembers.

You ask for changes in words and see them highlighted in the Markdown view, with what each turn cost and on which account; "Write" puts the section into the file (the project setting `changelog`, `CHANGELOG.md` by default) and commits it to the main branch of your checkout; tasks closed later are added to the section with one button, and a released version's section is left alone.

Tasks a user would not notice (refactoring, tests, process) are left out; when that leaves the section with no entry, the dialog says so and names the tasks instead of keeping an empty draft — say in a task's closing comment what it changes for users and write again.
