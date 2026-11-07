---
name: task
description: Working a task of Even Keel's built-in tracker through the tasks MCP server — recording decisions in the description, filing a blocker or a question, creating tasks, the closing comment and the merge. Load it when the prompt is a task id such as ABC-12 in a project whose tasks Even Keel keeps itself, or before creating such a task. Not for Huly, GitHub or other trackers — they have their own skills.
---

# Working a task

The tracker is reached only through the `tasks` server: `tasks_list`, `task_read`, `tasks_create`, `task_update`, `task_comment`. There is no delete. Labels, milestones and statuses go by name; an unknown one is refused with the list of existing ones — take a name from it, never invent one. Neighbour skill: `tasks:split`.

Even Keel runs the chain: it starts a session on the first open task, closes it when the branch lands in the main branch, cleans up and starts the next. The session does the task and merges; the rest is Even Keel's.

## 1. The task

- Started by Even Keel: the task's title, description and comments are already in the prompt — do not `task_read` your own task. Other tasks — `task_read(key)`, `comments: true` only when the discussion matters.
- Started by hand: `task_read(key)`. Calls without a project in the server's address name it: `project` is the key before the dash.
- Before any code: a blocking question (§3) and the size check of `tasks:split`.

## 2. Where to work

- Started by Even Keel: the session already runs in the task's worktree on its branch. Do not create a worktree or switch branches. A handoff note named in the prompt is read first.
- Started by hand: the project's `CLAUDE.md` names the branch and the worktree.
- Commits follow the project's `CLAUDE.md`, otherwise `[ABC-12] Message`, naming only this task's id.
- **Do not move statuses.** Even Keel closes the task on the merge. Only when the user asks.

## 3. While working

- **Decisions go into the description** as soon as they are settled: `task_update(key, append: "## Decisions\n…")`, or `replace: [{old, new}]` for a section already there. `old` must occur exactly once — take a longer piece when it is refused. Never resend the whole description to add a line; a whole `description` needs `rev` from `task_read`. Keep the user's text as it is.
- **A blocking question** — no sensible way on without the answer: ask it before any code, with options, and fold the answer into the description.
- **A question found mid-work** — do not stop: take the option cheapest to undo, finish, and file a question task (`tasks_create`, status `Todo`, the question label from the refusal's list) with what was done and the alternatives. This task is merged either way.
- **Blocked by other work** — find or create the blocker (status `Todo`), link it in the same call (`blocks: ["<this task>"]`), comment here why it stopped, end the turn. Even Keel runs the blocker first.
- **An unrelated bug or idea** — a new task (§5), not a change in this one.

## 4. Finishing

1. Commit to the task branch once the project's checks pass.
2. `task_comment(key, text)` — what was done, in a few lines. What is left undone becomes its own task, not a line in the comment.
3. Copy what is worth keeping out of the worktree's `.temp/`, stop every background process this session started.
4. Merge in the main checkout: `git merge --no-edit <branch>`. Local changes there or another branch checked out — stop and report, never stash or reset. In PR mode the prompt's rule wins.
5. Started by Even Keel: leave the worktree, the branch and the push to it. A task that needs no change in the repository: no commits, clean `git status`, last line `NO CHANGES: <why>`.
6. Started by hand: `git worktree remove <path>` (never `--force`), `git branch -d <branch>`.

## 5. Creating tasks

One `tasks_create` call per batch, every field at once: `title`, `description`, `status`, `priority`, `milestone`, `labels`, `parent`, `blocks`/`blockedBy`/`relates`. Inside the call refer to another task of it as `#1`, `#2`; a parent must come earlier. Pass `retry` (any unique string): a repeat after a lost answer returns the tasks already created instead of duplicates.

- **Status** — leave the default unless the user says the task goes into the chain now (`Todo`).
- **Priority** — `high` for a bug that breaks current work or stops the chain; `medium` ordinary; `low` ideas and polish. Never `urgent` yourself.
- **Order** — `blocks` links, not prose. A blocker must not sit in a later milestone than the task it blocks.
- **Milestone** — the one of the task in hand for a bug or leftover found on the way; a later one for an idea.
- **Where to look** — a `## Where to look` section with files and symbols when you can name them honestly; a guessed pointer is worse than none.
- **Model** — a run label `<Provider> | <model>` only when the user named one. **Run by hand** — the label the chain skips (`Manual` by default).
- Write in the language the project's tasks are written in.
