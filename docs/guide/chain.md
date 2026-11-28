# The chain

Even Keel takes a project's open tasks from the tracker, puts them in order and runs them one at a time: a session for a task, and the next task once that one is closed. This page says which tasks the chain takes, in what order, what happens to a task between its start and Done, and what you can leave to the chain while you are away.

- [Which tasks enter the chain](#which-tasks-enter-the-chain)
- [The order](#the-order)
- [Why one task at a time](#why-one-task-at-a-time)
- [Several projects at once](#several-projects-at-once)
- [What happens to a task](#what-happens-to-a-task)
- [Warnings above the chain](#warnings-above-the-chain)
- [Work left in a task's folder](#work-left-in-a-tasks-folder)
- [Unattended mode](#unattended-mode)
- [A project without git](#a-project-without-git)
- [Slots](#slots)

## Which tasks enter the chain

Tasks enter the chain by status (by default: ready and in-progress tasks — not the backlog, not closed ones) and by labels you choose; a task with a label you told the chain not to take never enters it, it is yours to run.

A project with nothing to run says so and opens the project in its tracker, where you file or ready the next tasks.

### Chain rules

The rules say which statuses are in work, which are closed, and which labels a task needs or must not have. They are set on three levels:

- **Settings → Chain rules**, for all projects;
- a tracker profile, for the projects on it (each tracker names its statuses differently);
- a project's **Tracker** tab.

For each rule the narrowest level that sets it wins: the project over the profile, the profile over the shared settings. The form is the same on all three:

- **A table of the tracker's statuses**, each in the chain, out of it or closed. A status follows its category (the tracker's own kind of status: to do, in progress, done…) until you move it.
- **A table of labels**, each required or not taken, with **Take any** or **Only with a required label** under it. No label is "not taken" until you add one. Even Keel's own labels are listed there too and do not change: the question label (`Question`/`Вопрос`) only marks a task that waits for your answer.
- **The "From" column** says where each row comes from — the category, the shared settings, the profile or the project. A row the level does not set is greyed but can be changed; one it sets has a reset arrow.

A level that changes one status of a list takes that whole list as its own: move one in-chain status on a project, and later changes of the profile's in-chain statuses no longer reach that project.

Apart from the chain, **Project tasks** says which tasks of the tracker project belong to the Even Keel project at all — all, only some milestones' or all but some milestones'. It is on the project's Tracker tab, and for all projects in **Settings → Chain rules**.

## The order

Order: open blockers first, then the order you set by dragging on the page, then milestone, priority, task number.

A task with an open blocker waits, and the blocker may be a task of another project in the same tracker: a client change blocked by its API change starts only once the API task is closed, against the merged API, while the client's chain runs its other tasks meanwhile.

### Tasks with subtasks

A task with subtasks never runs itself — its subtasks do, and Even Keel closes it once they are all closed and at least one is done; one whose subtasks were all cancelled is left to you. When a session splits its task, Even Keel stops that session once its turn is over, unless it asked a question: the transcript and the worktree stay until the parent is done, and the session can be resumed by hand.

Once a project has such a task, a switch at the top of its list shows the parents instead of the chain: each with its closed subtasks counted, its card and its sessions to read (they are not answered from there). In the chain, the subtasks of one parent share a coloured bar at the left of their rows; a press on it opens their parent there.

### Milestone order

By default milestones go:

- on Linear, in the project's own milestone order;
- elsewhere, and always for Jira versions (as on Jira's Releases page), by target date, undated ones last; then by the first number in the name (`v0.2` before `v0.10`, numbered names before unnumbered); then by name.

The active milestone and the card's choices follow the same order. A wrong date can therefore put a later version first: correct it in the tracker, then refresh the tasks.

To set the order yourself, open the project's settings, then **Tracker** → **Configure** → **Milestones**. The **Milestone order** block lists the milestones that still have open tasks in the chain or its backlog, from the main tracker and every feed, in the order the chain goes by; it is marked **auto** while the default order applies.

- Dragging a milestone (or moving it with the arrow keys on its handle) saves the whole list as the project's own order; **Back to automatic** drops it.
- Under a saved order a milestone that appears later is marked **new** and takes its default place among its neighbours until the next drag saves it; a milestone with no open tasks left drops out of the list.
- Milestones are matched by name, so a renamed milestone counts as a new one.
- The order is the project's alone and applies at once, without a restart.

A "blocked by a task in a later milestone" or "blockers go against the milestone order" message has a button that opens this block.

### A milestone for tasks without one

**Give the active milestone to tasks without one** assigns the current task's milestone to a task entering the chain without one, or the earliest milestone in the chain when the current task has none. The backlog shows where such a task will stand by that milestone too. If the assignment would put a blocker after a task it holds, the task keeps no milestone. A successful assignment appears on the page in the same refresh; a milestone you later change or clear is left alone.

## Why one task at a time

Most agent orchestrators sell width: ten agents in parallel, each in its own worktree. Even Keel deliberately runs the tasks of a project one after another. Why:

- **Backlog tasks are connected.** A parallel agent working on task B decides on its own what task A, not yet done, will look like. The sequential agent on B reads A's merged code.
- **The bottleneck is human attention, not typing speed.** Questions, reviews and merges are yours to handle. Ten agents produce ten queues of them at once.
- **A worktree isolates the work, not the result.** Conflicts, especially semantic ones that git does not see, move to merge time, where they are more expensive.
- **The subscription limit is shared.** Parallel agents spend it sooner, not on more; and each of them reads the same area of the code again.

Even Keel wins in time, not in width: the agent keeps working while you are away, and the chain survives what usually stops it — the usage limit running out, a context grown too large. That steady going is what the name means.

One task at a time holds per folder, not per repository: different projects, or a second clone of the same repository on another branch, have chains of their own that run side by side. A project with [machines](hub-machine.md) can widen this on purpose: **Project's tasks at once** on its **Machines** tab runs several of its tasks, each on a machine of its own, and **Lanes by component** there keeps two tasks of the same tracker component from running at once.

## Several projects at once

Sequential within a project, not across them: **Chains at once** (Settings → **Chain**) lets that many chains on different projects run at once (one by default). Other projects wait in a queue and start as soon as a chain ends. The usage limit stays shared: every running chain takes tasks until the window is used up, then they all wait for the reset.

## What happens to a task

Each task gets a session of its agent in its own git worktree `.claude/worktrees/<key>-<number>` on a branch `<key>-<number>/task`, made from `main` (the project's main branch).

The session does the task and merges its branch into `main`. Once its turn ends, Even Keel lands the merge: it fetches the remote, merges in what the remote got meanwhile, runs the project's check commands when there was such work, and pushes `main`. Only a task whose branch is in the remote's `main` is closed in the tracker; then Even Keel stops the session and removes the worktree and the branch. A repository without a remote closes by the merge into the local `main`; with **Pull requests instead of merging** the forge lands the branch ([pull requests](ci.md)).

When the landing does not go through:

- **The remote's `main` conflicts with the merge, or the check fails on it.** Even Keel puts the local `main` back as it was before the merge and tells the task's session what happened — the conflicting files, or the failed command with its output — so it merges the remote's `main` into its branch, resolves it and merges again. That happens three times at most; a fourth time the chain pauses on the task with a question in its chat, and your answer gives the session three more tries.
- **The remote cannot be reached.** The task stays open, the session untouched, and the landing is tried again 30 s and 2 min later, then every 10 minutes. Meanwhile the project page says the task waits for the remote; **Close without pushing** under that line closes it anyway, for a remote that stays down long, and a later sync pushes the merge once the remote is back.
- **The remote refuses the push** (a server hook, no rights): the chain pauses with git's text.

While a task's session resolves its landing, the project starts no new task: its merge would most likely meet the same conflict. Tasks already running on other machines go on; the next start waits, the chain's state under Start and Stop says "waiting", and its tip names the task being resolved. Turn this off with **Wait while a task resolves its landing** (Settings → **Check and CI**, shared or per project).

While the task runs, Even Keel pushes its branch to the repository's remote (`origin`, else its first one), so the work can go on from another machine of a hub. It pushes:

- whenever one session hands the task to the next — a limit, a handoff, a restart;
- when it stops a task's session;
- at the end of each turn that left new commits on the branch (a turn that ended on a question, say), with pull requests too, so the branch reaches the forge before its pull request.

A task taken in from an outsider's issue is not pushed while its branch changes CI workflows, agent files or `package.json` ([Security](security.md)). The branch on the remote goes with the local one after Done. A refused push is only a line in the log; the chain goes on.

After Done, Even Keel syncs `main` with the remote once more, for work merged into it by hand. A sync that cannot reach the remote (no connection, a timeout, DNS) is tried again 30 s and 2 min later while the next task runs; only after the third failure does the project page show a warning to sync by hand.

### A task with nothing to merge

A task that needs no change in the repository — done in `main` already, research, an answer — has nothing to merge. Its session ends the turn with the last line `NO CHANGES: <one line — why>`, and Even Keel checks the worktree: with no commits beyond `main` and nothing uncommitted it moves the task to Done, puts the line in a comment on it and cleans up as after a merge.

With commits or uncommitted changes the session is told to merge them or drop them and end with the line again; with pull requests the line `PULL REQUEST:` works the same way. A session that cannot go on without your answer asks and ends its turn without either line, and the task waits for the reply.

A session may give its answer and forget the line. While its turn has ended on a message, with no question open and no commits or uncommitted changes in its folder, the session panel and the chat show **Accept as answer**: the press puts the session's last message on the task as a comment, moves the task to Done and lets the chain clean up and go on. A folder with commits gets no such button: that work closes by a merge. In the chat the button stands in a banner over the reply box; its ✕ hides the banner until the session's next turn, and the same **Accept as answer** stays in the menu of the session's last message (right click, or a long press on a phone).

### A task merged but not closed

If a task is merged but its tracker refuses to close it, the project page and card show the tracker's response and **Open in the tracker**. Fill the required field or close the task in the tracker yourself. Even Keel retries every 30 seconds and continues the chain once the task closes. This wait is shown apart from a session waiting for your reply.

### Statuses on actions

On Huly, Linear and Jira, Even Keel can move a task to a status you choose at three points: when it starts the task, when it opens the task's pull request and when it closes the task after the merge. By default nothing moves and a merged task closes into the tracker's first done status.

- **Where:** on a tracker profile, in its tab of **Settings → Chain rules**, section **Statuses on actions**. Start and pull request offer "leave as is" and the statuses in the chain; completion offers "automatic" and the done statuses. A project's tracker and each task feed can override them in their **Configure** window on the Tracker tab, third tab, where "as in the profile" shows the profile's value.
- **A new profile** of these trackers asks for them right after it is saved, prefilled with the first in-progress status and a review status where the tracker has one; skip it and nothing changes.
- **Only forward:** a task already in progress is not moved back on its start, and a closed one is never touched. A status outside the chain is not offered, since the chain would drop the task the moment it moved there.
- **A status the tracker does not have** is refused on save; one renamed in the tracker since it was chosen shows as "not in the tracker" at its field.
- **A refused move** does not stop the chain: the project page shows the tracker's answer with **Open the statuses on actions**; a refused close waits and retries as above.

## Warnings above the chain

Errors above the chain always stay visible. Several warnings about cleanup after Done or about carrying a release's fixes forward ([merges into another project](ci.md)) share a folded row with their count and a short summary; open it for the individual actions. One warning stays open. When several closed tasks have cleanup warnings, **Done for all** dismisses them together; warnings on tasks still shown in the chain keep their own **Done** button.

## Work left in a task's folder

Work that sits in a task's folder but not in the main branch — files never committed, or commits never merged — is marked once the task is out of the chain:

- a red chip on its backlog row, or on its chain row when it was skipped or is closed, with the path, the branch and what to do on hover;
- a red count on the **Backlog** tab;
- a callout on its card.

While the chain is still running the task, or closing it and cleaning up, its uncommitted files are its session's and get no chip. The mark follows the folder within about a minute, and at once after a cleanup.

So a task parked in the backlog with a finished change is not forgotten: answer it and move it back to Todo, and a new session picks the work up, or commit and merge it yourself.

A closed task whose cleanup had to leave its folder behind stays in the chain list instead of going to the archive, with what the cleanup said in the chip's tip: commit and merge the work or delete the folder and it goes to the archive by itself, or press **Done** on its row.

## Unattended mode

For when nobody will answer — the **Unattended** switch in **Settings → Chain** (the gear in the header).

- Sessions are told to ask nothing and do all that does not depend on an answer. A task that cannot go on without one is parked: committed on its branch, unmerged, the question left in the task, the task moved to Backlog. In a [project without git](#a-project-without-git) a parked task leaves the folder's files as they are.
- A session that sits 10 minutes without the task done is skipped, and the session of a done task that stays busy for 10 quiet minutes is no longer waited for, so one stuck session does not stop the whole run.

## A project without git

**A project without git** is for tasks that change no code — "find this out and write it into the task". Choose "Without git" when you add the project.

- **Its folder** need not be a repository or exist: leave it blank and Even Keel makes one in `projects/` of its data folder (the project's **Settings** → **Repository** shows the path with a copy button). Removing the project leaves the folder.
- **One session at a time.** All the project's tasks share that folder, where sessions keep their notes: there are no worktrees, branches, merges, slots, pull requests or checks of `main`.
- **No git calls.** The sessions are refused any call of git, so a folder that is a repository after all, or lies inside one, is left as it was. This has no switch of its own and ends when you turn git on.
- **Closing a task.** A session writes its result in the last message of its turn and ends it with the last line `TASK DONE`; Even Keel puts that message on the task as a comment (up to 30,000 characters) and moves the task to Done. A turn that ends on a question waits for your reply as usual.

### Turning git on

You can turn git on later, between tasks, on the project's **Settings** → **Repository**; it is not turned off again. Git does not turn itself on when the folder becomes a repository: Even Keel looks at the folder when it starts and after each task of the project is done, and once git runs on the machine and the folder is the top of a repository of its own, the project page offers **Turn on git**. **Not now** hides the offer for this repository; it comes back only if the folder is made a repository anew.

**Turn on git** makes the folder a repository, with whatever it holds in the first commit, and asks how tasks get their folders. In the dialog:

- A folder that already was a repository keeps its history. The dialog lists the changes made there while git was off and commits them in one commit while **Commit them in one commit** stays ticked; unticked, git stays off until you commit or discard them yourself, since tasks start from the last commit and would not see them.
- If that repository is on another branch than the project's main branch (`git init` often gives `master`), the dialog offers to make it the main branch.
- A greyed button says on hover or focus what needs attention: git, the commit name and e-mail, the folder count or a busy project. If switching fails, the error stays above the dialog's buttons.

## Slots

For repositories with heavy ignored caches (Unity's `Library`, big `node_modules`) a project can use a pool of permanent worktrees, called slots, instead of a fresh one per task, so the next task rebuilds only the difference. Choose **Permanent folders** when you add the project, or set **Slots** above zero on its **Repository** tab.

After each Done in a slot Even Keel deletes the slot's temporary files, `.temp/` by default, so they do not pile up; the config key `projects[].slotCleanup` chooses what is deleted and what is kept ([reference](config.md)).
