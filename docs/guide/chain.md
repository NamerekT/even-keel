# The chain

Even Keel takes a project's open tasks from the tracker, puts them in order and runs them one at a time: a session for a task, and the next task once that one is closed. This page says which tasks the chain takes, in what order, what happens to a task between its start and Done, and what you can leave to the chain while you are away.

- [Which tasks enter the chain](#which-tasks-enter-the-chain)
- [The order](#the-order)
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

The rules of which statuses are in work, which are closed and which labels a task needs or must not have are set in **Settings → Chain rules** for all projects, on a tracker profile for the projects on it (each tracker names its statuses differently), and on a project's **Tracker** tab, the narrowest winning key by key.

They are one form on all three: a table of the tracker's statuses, each in the chain, out of it or closed — by its category until you move it —, and a table of labels, each required or not taken, with "Take any" or "Only with a required label" under it.

No label is "not taken" until you add one. Even Keel's own labels are listed there too and do not change: `Question`/`Вопрос` only mark a task.

The "From" column says where each row comes from — the category, the shared settings, the profile or the project; a row the level does not set is greyed but can be changed, and one it sets has a reset arrow.

A level keeps each list whole: moving one status makes that level's list of in-chain (or closed) statuses its own.

Which tasks of the tracker project are the project's at all is apart from the chain: **Project tasks** — all, only some milestones' or all but some milestones' — on the project's Tracker tab, and for all projects in **Settings → Chain rules**.

## The order

Order: open blockers first, then the order you set by dragging on the page, then milestone, priority, task number.

A task with an open blocker waits, and the blocker may be a task of another project in the same tracker: a client change blocked by its API change starts only once the API task is closed, against the merged API, while the client's chain runs its other tasks meanwhile.

### Tasks with subtasks

A task with subtasks never runs itself — its subtasks do, and Even Keel closes it once they are all closed and at least one is done; one whose subtasks were all cancelled is left to you.

Once a project has such a task, a switch at the top of its list shows the parents instead of the chain: each with its closed subtasks counted, its card and its sessions to read (they are not answered from there); a press on a family's coloured rail in the chain opens its parent there.

### Milestone order

Milestones follow the tracker's own order when all milestones being compared provide positions in the same tracker project: Linear's project milestone order.

Otherwise, and always for Jira versions (as on Jira's Releases page), they follow target dates, with undated milestones after dated ones, then the first number in the name (`v0.2` before `v0.10`, numbered names before unnumbered), then the name.

Equal tracker positions use the same fallback.

Positions from different tracker projects or task feeds are never mixed; if any position is missing or from another source, the whole set uses the fallback.

The active milestone and the card's choices follow this rule too.

An incorrect date can therefore put a later version first: correct it in the tracker, then refresh the tasks.

To set the order yourself, open the project's settings, then **Tracker** → **Configure** → **Milestones**.

The **Milestone order** block lists the milestones that still have open tasks in the chain or its backlog, from the main tracker and every feed, in the order the chain goes by; it is marked **auto** while the automatic order above applies.

Dragging a milestone (or moving it with the arrow keys on its handle) saves the whole list as the project's own order, and **Back to automatic** drops it.

Under a saved order a milestone that appears later is marked **new** and takes its automatic place among its neighbours until the next drag saves it; a milestone with no open tasks left drops out of the list.

Milestones are matched by name, so a renamed milestone counts as a new one.

The order is the project's alone and applies at once, without a restart.

A "blocked by a task in a later milestone" or "blockers go against the milestone order" message has a button that opens this block.

### A milestone for tasks without one

**Give the active milestone to tasks without one** assigns the current task's milestone to a task entering the chain without one, or the earliest milestone in the chain when the current task has none. The backlog's "will stand here" preview uses that milestone too. If the assignment would put a blocker after a task it holds, the task keeps no milestone. A successful assignment appears on the page in the same refresh; a milestone you later change or clear is left alone.

## Several projects at once

Sequential within a project, not across them: `parallel` lets that many chains on different projects run at once (one by default). Other projects wait in a queue and start as soon as a chain ends. The usage limit stays shared: every running chain takes tasks until the window is used up, then they all wait for the reset.

## What happens to a task

Each task gets a background session (`claude --bg`) in its own git worktree `.claude/worktrees/<key>-<number>` on a branch `<key>-<number>/task`, made from `main` (or the project's `branch`; `main` below means that branch).

The session does the task and merges its branch into `main`; Even Keel sees the merge, closes the task in the tracker, stops the session, removes the worktree and the branch, and syncs `main` with the remote.

A sync that cannot reach the remote (no connection, a timeout, DNS) is tried again 30 s and 2 min later while the next task runs; only after the third failure does the project page show a warning to sync by hand.

### A task with nothing to merge

A task that needs no change in the repository — done in `main` already, research, an answer — has nothing to merge. Its session ends the turn with the last line `NO CHANGES: <one line — why>`, and Even Keel checks the worktree: with no commits beyond `main` and nothing uncommitted it moves the task to Done, puts the line in a comment on it and cleans up as after a merge.

With commits or uncommitted changes the session is told to merge them or drop them and mark again. In PR mode the `PULL REQUEST:` mark does the same.

A session may give its answer and forget the mark.

While its turn has ended on a message, with no question open and no commits or uncommitted changes in its folder, the session panel and the chat show "Accept as answer": the press puts the session's last message on the task as a comment, moves the task to Done and lets the chain clean up and go on.

A branch with commits is refused — that work closes by a merge.

### A task merged but not closed

If a task is merged but its tracker refuses to close it, the project page and card show the tracker's response and **Open in the tracker**. Fill the required field or close the task in the tracker yourself. Even Keel retries automatically every 30 seconds and continues the chain once the task closes. This wait is shown separately from a session waiting for your reply.

### Statuses on actions

On Huly, Linear and Jira, Even Keel can move a task to a status you choose at three points: when it starts the task, when it opens the task's pull request (in PR mode) and when it closes the task after the merge.

Set them on a tracker profile, in its tab of **Settings → Chain rules**, section **Statuses on actions**: start and pull request offer "leave as is" and the statuses in the chain, completion "automatic" and the done statuses.

A project's tracker and each task feed can override them in their **Configure** window on the Tracker tab, third tab, where "as in the profile" shows the profile's value.

A new profile of these trackers asks for them right after it is saved, prefilled with the first in-progress status and a review status where the tracker has one; skip it and nothing changes.

A status the tracker does not have is refused on save; one already chosen — by hand in the config, or renamed in the tracker since — shows as "not in the tracker" at its field.

By default nothing moves and a merged task closes into the tracker's first done status.

Moves only go forward: a task already in progress is not moved back on its start, and a closed one is never touched. A status outside the chain is not offered, since the chain would drop the task the moment it moved there.

If the tracker refuses a move, the chain goes on and the project page shows the tracker's answer with **Open the statuses on actions**; a refused close waits and retries as above.

## Warnings above the chain

Errors above the chain always stay visible. Several cleanup and carry warnings share a folded row with their count and a short summary; open it for the individual actions. One warning stays open. When several closed tasks have cleanup warnings, **Done for all** dismisses them together; warnings on tasks still shown in the chain keep their own **Done** button.

## Work left in a task's folder

Work that sits in a task's folder but not in the main branch — files never committed, or commits never merged — is marked once the task is out of the chain: a red chip on its backlog row, or on its chain row when it was skipped or is closed, with the path, the branch and what to do on hover, a red dot on the **Backlog** tab, and a callout on its card.

While the chain still leads the task, or is closing it and cleaning up, its uncommitted files are its session's and get no chip.

So a task parked in the backlog with a finished change is not forgotten: answer it and move it back to Todo, and a new session picks the work up, or commit and merge it yourself.

A closed task whose cleanup had to leave its folder behind stays in the chain list instead of going to the archive, with what the cleanup said in the chip's tip: commit and merge the work or delete the folder and it goes to the archive by itself, or press **Done** on its row.

The mark follows the folder within about a minute, and at once after a cleanup.

## Unattended mode

For when nobody will answer — a switch in **Settings → Chain** (the gear in the header).

Sessions are told to ask nothing, to do everything a question does not hold, and to park a task held by one: committed on its branch, unmerged, the question left in the task, the task moved to Backlog.

In a project without git a parked task leaves the folder's files as they are and its turn ends without `TASK DONE`.

A session that sits 10 minutes without the task done is skipped, and the session of a done task that stays busy for 10 quiet minutes is no longer waited for, so one stuck session does not stop the whole run.

## A project without git

**A project without git** is for tasks that change no code — "find this out and write it into the task". Choose "Without git" when you add the project.

Its folder need not be a repository or exist: leave it blank and Even Keel makes one in `projects/` of its data folder (the project's **Settings** → **Repository** shows the path with a copy button).

All the project's tasks share that folder, where sessions keep their notes, so one session works at a time: there are no worktrees, branches, merges, slots, pull requests or checks of `main`.

The sessions are refused any call of git, by the agent's own deny rules and a hook of the `agent-bridge` plugin, so a folder that is a repository after all, or lies inside one, is left as it was; this is not a Protection group and has no switch — it ends when you turn git on.

A session writes its result in the last message of its turn and ends it with the last line `TASK DONE`; Even Keel puts that message on the task as a comment (up to 30,000 characters) and moves the task to Done.

A turn that ends on a question waits for your reply as usual. Removing the project leaves the folder.

### Turning git on

You can turn git on later, between tasks, on the project's **Settings** → **Repository**; it is not turned off again.

**Turn on git** makes the folder a repository, with whatever it holds in the first commit, and asks how tasks get their folders; a folder that already was a repository keeps its history, and the dialog lists the changes made there while git was off and commits them in one commit only while **Commit them in one commit** stays ticked — unticked, git stays off until you commit or discard them yourself, since tasks start from the last commit and would not see them.

In the **Turn on git** dialog, hover or focus the greyed button to see what needs attention: git, the commit name and e-mail, the folder count or a busy project. If switching fails, the error stays above the dialog's action buttons.

Git does not turn itself on when the folder becomes a repository.

Even Keel looks at the folder when it starts and after each task of the project is done: once git runs on the machine and the folder is the top of a repository of its own, the project page offers **Turn on git**.

If that repository is on another branch than the project's main branch (`git init` often gives `master`), the dialog offers to make it the main branch.

**Not now** hides the offer for this repository; it comes back only if the folder is made a repository anew.

## Slots

For repositories with heavy ignored caches (Unity's `Library`, big `node_modules`) a project can use a pool of permanent worktrees instead of a fresh one per task, so the next task rebuilds only the difference.
