# CI, pull requests and releases

After a task is merged, something has to say whether the main branch still works. Even Keel reads the repository's CI, or runs the project's own check commands, and has a red main branch fixed before the next task builds on it. This page also covers the pull request mode, release branches and changelog drafts.

The settings are in **Settings** → **Check and CI** for all projects and on a project's **Check and CI** tab for one.

- [CI](#ci)
- [A check without CI](#a-check-without-ci)
- [Pull requests](#pull-requests)
- [Release branches](#release-branches)
- [Changelog drafts](#changelog-drafts)

## CI

### What the chain does with the verdict

After a task is merged and the main branch is pushed, the next task's worktree is prepared while the chain waits for the CI's verdict. **Keep main green** turns the watch on, **CI of main** picks the CIs it waits for, and **Longest wait for CI, min** limits the wait: empty — as long as it takes, 0 — no wait, faster but the next task may start on a broken main branch.

- **A rerun first.** On GitHub Actions and GitLab CI, a red main branch first gets one rerun of its failed jobs, so a flaky test does not start a fix (**Rerun failed CI jobs once**, on by default). The red notification comes only if the rerun is red too, or right away when there is no rerun.
- **Then a fix.** Red again, it is fixed first: Even Keel stops the session working on the current task and starts a session to fix the main branch, with the failed jobs, the end of the failed job's log and the commits of the push in its prompt, without a task in the tracker. Once the fix is merged, it continues the stopped session with a note to merge the main branch into its branch. With **Create a task when CI fails** the chain creates a high-priority fix task in the tracker instead and takes it after the current one.
- **A red fix** pauses the chain instead of starting another.
- **A session that just started** is not stopped mid-way: Even Keel waits until it can tell whether the session is working or waiting. A session waiting for an answer keeps its question and is set aside without being stopped.
- **Several projects in separate clones of one repository**, on the same main branch, share a red main branch: while one of them fixes it, the others start no new task and no second fix of the same break; their sessions already at work go on. Once the fix is green, they all go on.

### The CI panel

A badge in the project's head shows the CI of each remote — Forgejo Actions, GitHub Actions or GitLab CI, found from `git remote` and the workflow folders or the root `.gitlab-ci.yml`. It opens a panel with:

- whether the API answers and a runner takes the runs;
- the current push with its tasks, and a row per workflow it started, each with its jobs and steps against that workflow's usual length;
- the recent pushes, a dot per workflow.

All of them are of the project's main branch.

![The CI panel open from the CI tab: on Forgejo Actions a new push waiting for a run with the line that the next task waits for the CI's verdict on it, under it the red run of the push before with its failed test job, the after-green row and the history dots; below, a GitHub Actions run marked "not counted" with two workflows at work](images/ci-panel.webp)

- A run that waits says when the runner is busy with another run; a run no runner took is grey rather than red; a CI the chain does not wait for is marked "not counted".
- When the next task waits — for the CI's verdict, for the project's own check, or for a push no runner took in time — the panel says so under the push it waits on, with the time.
- Each push says whether the chain pushed it or someone did by hand. A project with **Commands after a green main** has an "After green" row: running, done, the command that failed, or skipped and why.

A failed CI the chain does not wait for — "not counted", or with **Keep main green** off — still gets a notification, which says that the chain does not use that CI to decide whether to go on.

## A check without CI

A project with no CI, or whose CI does not answer, can name its own **Check commands**, such as `npm run typecheck && npm test`.

A session's merge into the main branch waits until they pass in the task's worktree, and a failure goes back to the session to fix. With **Check main again if it moved**, if the main branch moved while the task ran, Even Keel runs the check again on it in the next task's worktree before that task starts; a failure there is handled like a red CI.

When no plugin reported a passed check before the merge (an old `agent-bridge` or none), the check runs on the main branch in the next task's worktree anyway.

## Commands before start and after a green main

- **Commands before start** run in order in the task's worktree or slot before a new session starts, such as `npm ci` (in `cmd.exe` on Windows); the output goes to the service log. A failed one pauses the chain with its output on the page; a resumed session does not run them again.
- **Commands after a green main** run in order in the project's main checkout once a pushed main branch is green by the CI or the check — say, to build and restart the project's service on this machine. They need **Keep main green**.
  - They run once per commit, only while the checkout is on the main branch; a checkout behind is brought up to the green commit by fast-forward, and one with changes or a merge under way is skipped.
  - A push you make yourself while Even Keel runs counts too, once a counted CI passes it; a red one only shows in the CI panel, with no fix.
  - The next task waits for them; a failure is a warning on the page, not a red main branch.
  - A command that restarts Even Keel itself goes last and as one process (`pwsh -NoProfile -Command "Restart-Service EvenKeel"`, not `net stop … && net start …`): the commands after it do not run.
  - A machine of the hub runs them too, in its own clone, once its main branch is brought up to the green commit; a machine may have commands of its own instead, or none ([A machine of a hub](hub-machine.md#a-machine-of-a-hub-preview)).

## Pull requests

With **Pull requests instead of merging** on, a session does not merge its branch: Even Keel pushes it, opens a pull request on GitHub or Forgejo, or a merge request on GitLab, and takes the next task.

- **Linked issues.** When the tasks are GitHub issues and the pull request is on GitHub, Even Keel ends its body with `Closes owner/repo#N`, so the issue shows the pull request and GitHub closes it at the merge; with GitLab Issues on the same GitLab server it ends a merge request with `Closes #N` (an issue of another project: `Closes group/name#N`).
- **Merging and closing.** The merge closes the task in the tracker. A pull request closed without a merge puts the task back as skipped, and its next run is told of the closed pull request and its comments. A task that changed nothing in the repository (research, work already on the main branch) is closed without a pull request.

### Feedback

Feedback goes back to the task's session: reviews that ask for changes or comment, comments in the pull request's conversation (yours included: a forge does not let you request changes on a pull request opened with your own token) and failed checks with the end of the failed job's log. A chain that ran out of tasks with pull requests open starts again by itself when feedback comes on one of them; a chain you stopped waits for **Start**.

Only the remarks of the repository's own people count, as [Whose text a session reads](security.md#github-gitlab-and-forgejo) says; anyone else's is skipped with a line in the service log. On top of that:

- bots' remarks and GitLab's system notes, such as approvals, are not feedback;
- a session's own comments on its pull request carry the hidden line `<!-- even-keel:session -->` and are not feedback, even when posted with your token;
- on Forgejo a reviewer needs write access or above, and Forgejo tells another user's access only to an admin of the repository: make the profile's account an admin of the repository, or only that account and the repository's owner count.

### The token and the remote

The mode takes the token the remote's CI takes — a GitHub, GitLab or Forgejo profile in **Settings** → **Trackers and CI** — which then needs to write pull requests ([Token permissions](tracker-several.md#token-permissions)). For an HTTPS remote the branch is pushed with that token too, for an SSH one with the service account's keys.

- **Without a remote** on GitHub, GitLab or Forgejo, or a token for it, the switch stays off and says which is missing; when it is the token, **Add profile** beside it opens **Trackers and CI** with a new profile on the remote's address.
- **A remote or token that went away** pauses the project with the reason instead of starting tasks, with the same **Add profile**, or a button to the project's **Check and CI** when the remote is gone. It goes on by itself within a minute of the remote or the profile being added.

### The description

The session writes the pull request's title and description into a file in its working folder and marks the pull request; Even Keel reads it from there. A file outside the folder, `.env` or `.env.*` (but `.env.example`), anything under `.git`, or a text over 64 KiB with its title is refused, and the chain pauses before pushing the branch. Answer the session in the chat to write the description to `.temp/pull-request.md` and mark the pull request again: the new mark opens it and the chain goes on. **Resume** reads the same file again, so it helps only after you correct that file yourself.

The mode has run live on GitHub, Forgejo, GitLab.com and a self-managed GitLab: opening, closing and merging, reviews with line comments, failed runs and a conflict with the main branch ([what was checked](../verified/ci.md)). Use it at your own risk.

## Release branches

Fixes of a released version can run in a chain of their own while the next version goes on in another.

Clone the repository a second time, check out the release branch there and add it as a project on the same tracker project, with the same key or one of its own. Two projects of one key are told apart on the page by their name in brackets, `ABC (Release)`.

The two split the tracker's tasks by milestone: the release project takes only the release's milestone, the main one all except it, and Even Keel refuses a pair that would both take one task. **+ Add project** does this for you: on a tracker project another project already has, it asks for the milestones the new one takes ("Only tasks in milestones") and moves them into the other's **Project tasks** → "All except" as it adds the project.

### Carrying fixes forward

A release project whose **Merges into** names the main project is *carried* forward: Even Keel merges its branch into the main project's branch, in the main project's checkout, and pushes it. It does so in batches whenever the main chain stands — stopped, empty or paused — so a fix never lands in the middle of a task's merge. **Carry now** on the release project's page does it at once.

A carry merges only into the main project's branch: the branch your releases are published from (`main`, when the next version is built on another one) moves only by your release.

The main project must be of the same repository: the two checkouts share a remote, or one is a clone of the other's folder. The settings offer only such projects.

#### A conflict

A conflict is aborted and the carry waits, with one line on the release project's page: the files, and git's output under **Details**. Then either merge by hand, or press **Resolve with the agent**:

- A session without a tracker task, `<KEY>-CARRY` of the release project, merges the release commit in the main project's own worktree, after that project's current task, on its model and account. It keeps the main branch's structure and puts the release fix's meaning on top.
- It shows as a row of the main chain; a main project with no chain running gets one for this session alone. While the row waits for its turn, its panel shows how many commits are to merge, which files conflict and how many lines each has in conflict.
- Once the main branch has the release commit, the carry is done and the row closes as "Carry of <KEY>: N commits". **Skip** on the row lets the session go and the conflict waits again.

With **Resolve a conflict with the agent by itself**, or in unattended mode, a conflict goes to that session at once. A session that did not land the carry gets no successor until the release branch moves; then the carry is tried again.

#### Other failures

- **A merge git refuses for another reason** — the service's account has no git name and email, say — waits the same way, and the page shows git's message: fix that, then press **Carry now**.
- **A failed push** of a merged carry keeps the error on the release project's page until every remote has the merge commit. Even Keel checks every minute, so a later push by hand clears it.

## Changelog drafts

A button on a milestone's head in the chain opens that milestone's changelog. Before the first draft it shows how many tasks are done and open and the section your changelog file already has; nothing is spent until you press "Write draft".

- **What it writes.** The agent writes the section in the Keep a Changelog format, from the titles and closing comments of the milestone's done tasks, in the language of your `CHANGELOG.md` (or `README.md`). It writes for someone upgrading from the previous release, whose section it is given: a fix of something new in this release is part of that feature's entry, not a line under Fixed.
- **What it leaves out.** Tasks a user would not notice (refactoring, tests, process). When that leaves no entry, the dialog says so and names the tasks: say in a task's closing comment what it changes for users and write again.
- **How it runs.** Read-only, on the account and model the project's next session would get, starting from the section already in your file, so your own edits there stay. When that account's limit is spent, nothing is sent: the dialog says which limit and when it resets, with a button to the project's **Sessions** settings to give it another account.
- **Editing.** The section shows rendered or as Markdown. You ask for changes in words and see them highlighted in the Markdown view, with what each turn cost and on which account.
- **Writing.** "Write" puts the section into the file (**Changelog file** on the **Repository** tab, `CHANGELOG.md` by default) and commits it to the main branch of your checkout. Tasks closed later are added to the section with one button; a released version's section is left alone.
