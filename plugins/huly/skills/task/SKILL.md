---
name: task
description: Working a Huly task through the huly MCP server — reading the task and its attachments, recording decisions in the description, filing a blocker or a question, creating new tasks, the closing comment and the merge into main. Load it when the prompt is a task id such as ABC-12 (that is how Even Keel starts a session, sometimes with notes after the id), when the user says to take a task, or before creating a task in Huly. Not for projects whose work is not tracked in Huly.
---

# Working a Huly task

Huly is reached only through the `huly` MCP server. If a tool is missing, tell the user instead of scripting against the Huly API.

Even Keel runs the chain: it takes the open tasks of the project in order, starts a session on the first one, closes it in Huly when its branch lands in `main`, cleans up and starts the next. The session does the task and merges; everything else is Even Keel's.

## 1. Read the task

- `get_issue(project, identifier)` — the project is the key before the dash: `ABC` for `ABC-12`.
- `list_attachments(objectId, objectClass)` with the internal `issueId` from the `get_issue` answer and `objectClass: "tracker:class:Issue"` — the human identifier finds nothing. Users drop screenshots there instead of describing them; read them with `read_attachment_content(attachmentId)`.
- Do not read the activity feed (`list_activity`) when picking a task up. Title, description and attachments are the whole brief; the feed is a changelog that costs thousands of tokens. Read it only when the user or the description points at the discussion, and then also `list_activity_replies(messageId)` for messages with `replies > 0`.
- The task has no estimate — set one now (`update_issue` with `estimation`, §5) before reading any code. Leave an existing estimate alone.
- Look for a blocking question (§3) before reading any code.

## 2. Where to work

- Started by Even Keel — the prompt names a ready worktree or a working folder: the session already runs in it, on the task's branch. Do not create a worktree, do not create or switch branches.
- Started by hand: follow the project's own `CLAUDE.md` for the branch and the worktree.
- Commit messages and branch names follow the project's `CLAUDE.md`. Without a rule there, prefix commits with the task id: `[ABC-12] Message`.
- **Do not move statuses.** Even Keel closes the task when the branch is merged into `main`. Touch a status by hand only when the user asks, or to close a parent task (§4).

## 3. While working

- **Decisions go into the description.** Anything settled while the task is open — scope, a number, an approach, a constraint — is folded into the description with `update_issue(project, identifier, description)` as soon as it is settled. The description is the one place a later session reads; a decision left in chat or in a comment is lost. Keep the user's own text as it is: add a section, do not rewrite theirs.
- **A blocking question** — there is no sensible way to do the task without the answer. Ask it before any code, with concrete options, and fold the answer into the description.
- **A question found mid-work** — do not stop. Take the option that is cheapest to undo, finish the task on it, and file a question task: `create_issue` titled `Question: …` with what was done, the alternatives and what each would change, `status: "Todo"`, then `add_issue_label` with `Question`. Even Keel puts it in the chain like any other task and the session started on it is where the user answers — so write it for the session that will discuss it, not for one that codes it.
- **Blocked by other work** — the task cannot go on until something else is done. Find that task or create it (`status: "Todo"`, so the chain takes it), link it with `add_issue_relation(project, issueIdentifier: <blocker>, targetIssue: <this task>, relationType: "blocks")`, comment on this task why it stopped and where, and end the turn. Even Keel sees the open blocker, releases this task and runs the blocker first; this task comes back after it.
- **An unrelated bug or idea** noticed on the way — a new task (§5), not a change in this one.

## 4. Finishing

When the code is written and the checks the project's `CLAUDE.md` names pass:

1. Commit to the task branch.
2. `add_comment(project, issueIdentifier, body)` — what was done, in a few lines. Anything left undone becomes its own task or a question task (§3), not a line in the comment: no later session reads comments.
3. Merge: in the main checkout, which must be on `main`, `git merge --no-edit <branch>`. If it is not on `main`, or git refuses because of local changes there, stop and report — never stash, reset or force over someone else's work. If the project's `CLAUDE.md` says the user merges, hand them the command instead.
4. Started by Even Keel: before the merge, stop the background processes this session started in the worktree (dev servers, watchers) and copy anything worth keeping out of it. After the merge do not remove the worktree, do not delete the branch, do not push `main` — Even Keel waits for the turn to end, closes the task in Huly and cleans up.
5. Started by hand: after the merge remove the worktree and delete the branch yourself, from the main checkout; push only if the project says so.
6. Subtasks: the session that merges the last open child of a parent task moves the parent to its done status by hand (`list_statuses` for the name). Never mention the parent's id in a commit.

## 5. Creating tasks

- `create_issue(project, title, description, priority, estimation)` in the project of the current repository. Leave the status at the default (Backlog) unless a rule above says `Todo`: Even Keel takes a task only once someone moves it to Todo.
- **Priority** moves the task in the chain: `high` for a bug that breaks the current work or stops the chain, or when the user says it goes next; `medium` for ordinary work; `low` for ideas and polish. Never set `urgent` yourself. What the user says about urgency wins.
- **Estimate** — hours of the agent's own active work, minute precision (`0.25` is 15 minutes): reading the area, the code, the checks, the merge. It is a guess; do not round it toward a safe number.
- **Where to look** — add a `## Where to look` section naming the files, types and functions the work will touch, when you can name them honestly. Symbols, not line numbers. A guessed pointer is worse than none.
- **Model** — the labels `Sonnet`, `Opus` and `Haiku` pick the model Even Keel starts the session with. Label a well-scoped task that a test or a build checks `Sonnet`; leave the rest unlabeled.
- **Order** between tasks — `blocks` relations, not prose.
- Component and milestone — set them when the project uses them (`list_components`, `set_issue_component`, `set_issue_milestone`).
- Write titles, descriptions and comments in the language the project's tasks are written in; the project's `CLAUDE.md` may name it.

## 6. Tool arguments

The server names its arguments inconsistently; these are exact:

- `get_issue(project, identifier)` · `update_issue(project, identifier, <field>: <value>)` — the field itself, e.g. `description`, never `field`/`value`.
- `add_comment(project, issueIdentifier, body)` · `list_activity(project, issueIdentifier, limit)`.
- `list_attachments(objectId, objectClass)` — internal id, `"tracker:class:Issue"`, no `project`.
- `add_issue_relation(project, issueIdentifier, targetIssue, relationType)` — the source is `issueIdentifier`: `blocks` means the source blocks the target.
- `add_issue_label(project, identifier, label)` creates the label if the project lacks it.
