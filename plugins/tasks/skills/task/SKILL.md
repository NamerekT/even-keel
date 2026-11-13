---
name: task
description: Working a task through Even Keel's tasks MCP server (any tracker of an Even Keel project) — recording decisions in the description, filing a blocker or a question, creating tasks, the closing comment and the merge. Load it when the prompt is a task id such as ABC-12 and the session has the tasks server's tools, or before creating such a task. Not when the session has only a tracker's own MCP server — that tracker's skills cover it.
---

# Working a task

The tracker is reached only through the `tasks` server: `tasks_list`, `task_read`, `tasks_create`, `task_update`, `task_comment`. There is no delete. Labels, milestones and statuses go by name; an unknown one is refused with the list of existing ones — take a name from it, never invent one. Neighbour skill: `tasks:split`. A session with the tracker's own MCP server instead (such as `huly`) works by that plugin's skill (`huly:task`).

**The `chain:` line** names each tracker's roles, e.g. `chain: into it — Ready; skip — Manual; question — Question; milestones v0.3; priority: yes; estimate: no`. "Into it" is the status that puts a task into the chain, "skip" the label the chain passes over, "question" the label of a question. The names differ from project to project and between a project's trackers, so this skill names none of them: take each from the line. It is in a chain session's prompt (one per tracker when the project has feeds), under the head of every `task_read` and at the end of every refused status, label or milestone. A role with `none` has no name in that tracker: leave it out. `priority: no` or `estimate: no` — that tracker keeps none; send the task without it. `blocking links: no` — no `blocks` or `blockedBy` there: name the order in the description.

A project may read several trackers (its own and its feeds), each with its key prefix (`ABC-12`, `ABCGH-7`). A call on a key goes to that key's tracker; `tasks_list` searches all of them, `tracker: "<prefix>"` narrows it; `tasks_create` creates in your task's tracker unless `tracker` names another. Links and parents never cross trackers — name the other key in the description. A list line `<prefix>: unreachable, not searched` means that tracker was not searched: do not file a duplicate on its strength.

Even Keel runs the chain: it starts a session on the first open task, closes it when the branch lands in the main branch, cleans up and starts the next. The session does the task and merges; the rest is Even Keel's.

## 1. The task

- Started by Even Keel: the task's title, description and comments are already in the prompt — do not `task_read` your own task. Other tasks — `task_read(key)`, `comments: true` only when the discussion matters.
- Started by hand: `task_read(key)`. Calls without a project in the server's address name it: `project` is the key before the dash.
- Before any code: a blocking question (§3) and the size check of `tasks:split`.
- The task has no estimate and its tracker keeps one (`estimate: yes`) — set it now with `task_update(key, estimate: <minutes>)` (§5) before reading any code. Leave an existing estimate alone.

## 2. Where to work

- Started by Even Keel: the session already runs in the task's worktree on its branch. Do not create a worktree or switch branches. A handoff note named in the prompt is read first.
- Started by hand: the project's `CLAUDE.md` names the branch and the worktree.
- Commits follow the project's `CLAUDE.md`, otherwise `[ABC-12] Message`, naming only this task's id.
- **Do not move statuses.** Even Keel closes the task on the merge. Only when the user asks.

## 3. While working

- **Decisions go into the description** as soon as they are settled: `task_update(key, append: "## Decisions\n…")`, or `replace: [{old, new}]` for a section already there. `old` must occur exactly once — take a longer piece when it is refused. Never resend the whole description to add a line; a whole `description` needs `rev` from `task_read`. Keep the user's text as it is.
- **A blocking question** — no sensible way on without the answer: ask it before any code, with options, and fold the answer into the description.
- **A question found mid-work** — do not stop: take the option cheapest to undo, finish, and file a question task (`tasks_create` with the "into it" status and the "question" label of the `chain:` line) with what was done and the alternatives. This task is merged either way.
- **Blocked by other work** — find or create the blocker (the "into it" status of the `chain:` line), link it in the same call (`blocks: ["<this task>"]`), comment here why it stopped, end the turn. Even Keel runs the blocker first.
- **An unrelated bug or idea** — a new task (§5), not a change in this one.

## 4. Finishing

1. Commit to the task branch once the project's checks pass. A test that was already red before this session's changes does not hold the merge, but it is someone else's bug: find the task about it or file a new one (§5) and name it in the closing comment. Do not fix it in this task.
2. `task_comment(key, text)` — what was done, in a few lines. What is left undone becomes its own task, not a line in the comment.
3. Copy what is worth keeping out of the worktree's `.temp/`, stop every background process this session started.
4. Merge in the main checkout: `git merge --no-edit <branch>`. Local changes there or another branch checked out — stop and report, never stash or reset. In PR mode the prompt's rule wins.
5. Started by Even Keel: leave the worktree, the branch and the push to it. A task that needs no change in the repository: no commits, clean `git status`, last line `NO CHANGES: <why>`.
6. Started by hand: `git worktree remove <path>` (never `--force`), `git branch -d <branch>`.

## 5. Creating tasks

One `tasks_create` call per batch, every field at once: `title`, `description`, `status`, `priority`, `milestone`, `labels`, `parent`, `blocks`/`blockedBy`/`relates`, `estimate`. Inside the call refer to another task of it as `#1`, `#2`; a parent must come earlier. Pass `retry` (any unique string): a repeat after a lost answer returns the tasks already created instead of duplicates.

The same change to several tasks (a milestone, a status, a priority, labels, links) is one `task_update(keys: [...], …)` call, never a call a task. It answers a line a task; a task that fails gets its own line and the rest go on. `title` and the description edits stay one task a call. When the call breaks off, repeat it as it was: a task already changed answers `already so`.

- **Status** — leave the default unless the user says the task goes into the chain now: then the "into it" status of the `chain:` line.
- **Priority** — `high` for a bug that breaks current work or stops the chain; `medium` ordinary; `low` ideas and polish. Never `urgent` yourself.
- **Order** — `blocks` links, not prose. A blocker must not sit in a later milestone than the task it blocks.
- **Milestone** — the one of the task in hand for a bug or leftover found on the way; a later one for an idea. In another tracker than your task's, a milestone from that tracker's list (a refusal names it) or none.
- **Estimate** — minutes of your own active work: reading the area, the code, the checks, the merge — not a person's time and not the waits. One step of a doubling scale: **5** — a line or a config value; **10** — the usual task, one area with tests; **20** — several layers, or real digging first; **40** — rare: a new subsystem, a migration with several moving parts; **80** — run the size check of `tasks:split`. Agent minutes are not a developer's hours: a task a person needs half a day for is usually 10 or 20. Torn between two steps — take the lower. It is a guess; do not round it toward a safe number. Only where the `chain:` line says `estimate: yes`; the tools convert it into the tracker's unit.
- **Component and files** — `component` only where the `chain:` line lists components. `attach` (also on `task_update` and `task_comment`) takes paths of files in your working folder, such as a screenshot in `.temp/`; it is absent or refused where the line says `attachments: no` — then name the file in the text.
- **Where to look** — a `## Where to look` section with files and symbols when you can name them honestly; a guessed pointer is worse than none.
- **Model** — the `run` field, `run: {provider, model, effort}`, only when the user named one: Even Keel keeps it, the tracker gets no label. A model needs its provider; on `task_update` a `null` field clears it. **Run by hand** — the "skip" label of the `chain:` line.
- Write in the language the project's tasks are written in.
