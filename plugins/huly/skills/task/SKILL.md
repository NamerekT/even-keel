---
name: task
description: Working a Huly task through the huly MCP server — reading the task and its attachments, recording decisions in the description, filing a blocker or a question, creating new tasks, the closing comment and the merge into main. Load it when the prompt is a task id such as ABC-12 (that is how Even Keel starts a session, sometimes with notes after the id), when the user says to take a task, or before creating a task in Huly. Not for projects whose work is not tracked in Huly.
---

# Working a Huly task

Huly is reached only through the `huly` MCP server. If a tool is missing, tell the user instead of scripting against the Huly API.

Even Keel runs the chain: it takes the open tasks of the project in order, starts a session on the first one, closes it in Huly when its branch lands in `main`, cleans up and starts the next. The session does the task and merges; everything else is Even Keel's.

Two neighbouring skills: `huly:split` — when a task is too big or holds an unchosen fork, and for subtasks; `huly:setup` — putting a repository on the tracker.

## 1. Read the task

- `get_issue(project, identifier)` — the project is the key before the dash: `ABC` for `ABC-12`.
- `list_attachments(objectId, objectClass)` with the internal `issueId` from the `get_issue` answer and `objectClass: "tracker:class:Issue"` — the human identifier finds nothing. Users drop screenshots there instead of describing them; read them with `read_attachment_content(attachmentId)`.
- Do not read the activity feed (`list_activity`) when picking a task up. Title, description and attachments are the whole brief; the feed is a changelog that costs thousands of tokens. Read it only when the user or the description points at the discussion, and then also `list_activity_replies(messageId)` for messages with `replies > 0` — the feed does not include thread replies, and an answer given in a thread is otherwise missed.
- The task has no estimate — set one now (`update_issue` with `estimation`, §5) before reading any code. Leave an existing estimate alone.
- Before reading any code, look for a blocking question (§3) and run the size check of `huly:split`.

## 2. Where to work

- Started by Even Keel — the prompt names a ready worktree or a working folder: the session already runs in it, on the task's branch. Do not create a worktree, do not create or switch branches. A handoff note named in the prompt is read first.
- Started by hand: follow the project's own `CLAUDE.md` for the branch and the worktree. Without a rule there, from the main checkout: `git worktree add -b abc-12/short-description .claude/worktrees/abc-12 main`, lowercase, then work only inside it — absolute paths into the worktree, git run there. Even Keel uses the same path, so if the chain later takes the task it picks this worktree up. Branch from the local `main`, not from `origin/main` (so not the harness's own worktree tool): local `main` may be ahead. `.claude/worktrees/` must be ignored by git — add it to `.git/info/exclude` if it is not, or every search returns each file twice.
- The main checkout stays on `main`: merges and work without a task happen there.
- Commit messages and branch names follow the project's `CLAUDE.md`. Without a rule there, prefix commits with the task id: `[ABC-12] Message`. A commit message names only the id of the task it belongs to — git hooks and integrations close every task whose id reaches `main`.
- **Do not move statuses.** Even Keel closes the task when the branch is merged into `main`. Touch a status by hand only when the user asks, when an automation moved it wrongly, or to close a parent task (§4). Then take the name from `list_statuses` — names differ per project — and never move a task to a done status while its work is not in `main`.

## 3. While working

- **Decisions go into the description.** Anything settled while the task is open — scope, a number, an approach, a constraint — is folded into the description with `update_issue(project, identifier, description)` as soon as it is settled. The description is the one place a later session reads; a decision left in chat or in a comment is lost. Keep the user's own text as it is: add a section, do not rewrite theirs.
- **A blocking question** — there is no sensible way to do the task without the answer. Ask it before any code, with concrete options, and fold the answer into the description.
- **A question found mid-work** — do not stop. Take the option that is cheapest to undo, finish the task on it, and file a question task: `create_issue` titled `Question: …` with what was done, the alternatives and what each would change, `status: "Todo"`, then `add_issue_label` with the question label. Labels are workspace-wide: check `list_labels` and use the one already there — Even Keel reads both `Question` and `Вопрос`, and a second spelling only splits the label. Even Keel puts the task in the chain like any other and the session started on it is where the user answers — so write it for the session that will discuss it, not for one that codes it. An open question never holds the branch back: this task is merged either way.
- **Blocked by other work** — the task cannot go on until something else is done. Find that task or create it (`status: "Todo"`, so the chain takes it), link it with `add_issue_relation(project, issueIdentifier: <blocker>, targetIssue: <this task>, relationType: "blocks")`, comment on this task why it stopped and where, and end the turn. Even Keel sees the open blocker, releases this task and runs the blocker first; this task comes back after it. A blocker left in Backlog holds the task too, until the user moves it to Todo — use that when the blocker needs the user first.
- **An unrelated bug or idea** noticed on the way — a new task (§5), not a change in this one.

## 4. Finishing

When the code is written and the checks the project's `CLAUDE.md` names pass:

1. Commit to the task branch.
2. `add_comment(project, issueIdentifier, body)` — what was done, in a few lines. Anything left undone becomes its own task or a question task (§3), not a line in the comment: no later session reads comments. If the code turned out to live elsewhere than the description's `## Where to look` said, fix that section now.
3. Before the merge: copy anything worth keeping out of the worktree (its `.temp/` and the like) into the main checkout, and stop every background process this session started there — dev servers, watchers, a second instance of the app. Stop them by process tree: on Windows a shell wrapper dies and leaves its child holding the folder.
4. Merge: in the main checkout, which must be on `main`, `git merge --no-edit <branch>`. If it is not on `main`, or git refuses because of local changes there, stop and report — never stash, reset or force over someone else's work. If the project's `CLAUDE.md` says the user merges, hand them the command instead, with the cleanup of step 6 in it.
5. Started by Even Keel: after the merge do not remove the worktree, do not delete the branch, do not push `main` — Even Keel waits for the turn to end, closes the task in Huly and cleans up.
6. Started by hand: clean up from the main checkout, in this order — git will not delete a branch that a worktree still has checked out:
   - `git worktree remove <path>`, never `--force`: it refuses a dirty tree, then commit or ask. If it fails with `Permission denied` or `Device or resource busy`, git has already unregistered the worktree and left the folder: a process still holds it. Kill it only if this session started it, then delete the empty folder; otherwise name the folder and the holder to the user.
   - `git branch -d <branch>` — lowercase `-d`, it refuses an unmerged branch.
   - `git push origin --delete <branch>` if the branch was pushed. Push `main` only if the project says so.
7. Subtasks: started by Even Keel — leave the parent alone, Even Keel closes it once all its children are closed. Started by hand — the session that merges the last open child of a parent task moves the parent to its done status by hand (`list_statuses` for the name).

## 5. Creating tasks

- `create_issue(project, title, description, priority, estimation)` in the project of the current repository. Leave the status at the default (Backlog) unless a rule here says `Todo`: Even Keel takes a task only once someone moves it to Todo. Subtasks — `huly:split`.
- **Priority** moves the task in the chain: `high` for a bug that breaks the current work or stops the chain, or when the user says it goes next; `medium` for ordinary work; `low` for ideas and polish. Never set `urgent` yourself. What the user says about urgency wins.
- **Estimate** — hours of the agent's own active work, minute precision (`0.25` is 15 minutes): reading the area, the code, the checks, the merge — not the user's time and not the waits for them. It is a guess; do not round it toward a safe number.
- **Where to look** — add a `## Where to look` section naming the files, types and functions the work will touch, when you can name them honestly. Creation is the moment: the code is usually still in your context. Symbols, not line numbers. A guessed pointer is worse than none — the next session trusts it. Learned where something lives while on another task — write it into the task that needs it.
- **Model** — the labels `Sonnet`, `Opus` and `Haiku` pick the model Even Keel starts the session with. Label a well-scoped task that a test or a build checks `Sonnet`; leave the rest unlabeled.
- **Run by hand** — a task the user does themselves, or wants to start themselves, gets the label `Manual` (Even Keel also reads `Вручную`; use the one in `list_labels`): the chain skips it entirely. End its description with a line saying so. A missing milestone does not keep a task out of the chain.
- **Order** between tasks — `blocks` relations, not prose. Tasks of a later milestone go after all tasks of an earlier one, so an idea for later goes into a later milestone; a task without a milestone fits anywhere, by priority. A blocker must not sit in a later milestone than the task it blocks — Even Keel cannot order that and stops the chain.
- **Component** — `list_components`, then `set_issue_component`. Nothing fits and the task opens a new area — `create_component`.
- **Milestone** — `set_issue_milestone` when the project uses them. Milestones are version slices (`v0.1`, `v0.2`), not deadlines; the milestone description is the map of the slice.
- Labels are not a `create_issue` argument: `add_issue_label` after it.
- Write titles, descriptions and comments in the language the project's tasks are written in; the project's `CLAUDE.md` may name it.
- Leave the assignee empty unless the user names one: the user's own e-mail is not always a Person in the workspace, and the call fails.

## 6. Tool arguments

The server names its arguments inconsistently; these are exact:

- `get_issue(project, identifier)` · `update_issue(project, identifier, <field>: <value>)` — the field itself, e.g. `description`, never `field`/`value`.
- `create_issue(project, title, description, priority, estimation, status, parentIssue)` — `parentIssue` is the parent's identifier, `ABC-7`.
- `add_comment(project, issueIdentifier, body)` · `list_activity(project, issueIdentifier, limit)` · `list_activity_replies(messageId)`.
- `list_attachments(objectId, objectClass)` — internal id, `"tracker:class:Issue"`, no `project`. `read_attachment_content(attachmentId)` returns images; other files — `download_attachment(attachmentId)`.
- `add_issue_relation(project, issueIdentifier, targetIssue, relationType)` — the source is `issueIdentifier`: `blocks` means the source blocks the target.
- `add_issue_label(project, identifier, label)` creates the label if the workspace lacks it.
- `get_milestone(project, milestone)` — the label or id, not `milestoneId`.
