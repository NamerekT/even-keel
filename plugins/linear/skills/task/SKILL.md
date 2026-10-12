---
name: task
description: Working a Linear issue through Linear's MCP server — reading the issue, recording decisions in its description, filing a blocker or a question, creating new issues, the closing comment and the merge into main. Load it when the prompt is a task id such as ENG-12 in a project whose issues live in Linear (that is how Even Keel starts a session, sometimes with notes after the id), when the user says to take an issue, or before creating an issue. Not for projects whose work is not tracked in Linear.
---

# Working a Linear issue

Issues are reached through the `linear` MCP server (Linear's remote server). If a tool is missing, tell the user instead of scripting against the API.

Even Keel runs the chain: it takes the open issues of the team (or of one Linear project of it) in order, starts a session on the first one, moves it to the team's done state when its branch lands in `main`, cleans up and starts the next. The session does the issue and merges; everything else is Even Keel's.

## 0. Which issue

A task id is the Linear identifier itself: `ENG-12` is issue 12 of the team with the key `ENG`. Every tool that takes an issue takes this identifier.

## 1. Read the issue

- `get_issue(id: "ENG-12", includeRelations: true)` — title, description, state, labels, project, milestone, parent, relations, attachments. Screenshots sit in the description as image links; `extract_images` reads them.
- Do not read the comments (`list_comments`) when picking the issue up. Title and description are the whole brief; read the comments only when the user or the description points at the discussion.
- Look for a blocking question (§3) before reading any code.

## 2. Where to work

`main` in this skill is the project's main branch: the one Even Keel's prompt names, otherwise the one the project's `CLAUDE.md` names, otherwise `main`.

- Started by Even Keel — the prompt names a ready worktree or a working folder: the session already runs in it, on the task's branch. Do not create a worktree, do not create or switch branches.
- Started by hand: follow the project's own `CLAUDE.md` for the branch and the worktree.
- Commit messages and branch names follow the project's `CLAUDE.md`. Without a rule there, prefix commits with the task id: `[ENG-12] Message`. A commit names only the id of its own issue, and never with a magic word (`fixes ENG-12`, `closes ENG-12`): Linear's GitHub or GitLab integration would close the issue on its own terms.
- **Do not move the state.** Even Keel moves the issue to the team's first completed state when the branch is merged into `main`. Touch the state by hand only when the user asks, or to close a parent (§4); take the name from `list_issue_statuses(team)`.

## 3. While working

- **Decisions go into the description.** Anything settled while the issue is open — scope, a number, an approach, a constraint — is folded into the description with `save_issue(id, patch)` as soon as it is settled. The description is the one place a later session reads; a decision left in chat or in a comment is lost. Keep the user's text as it is: add a section with `patch`, do not rewrite theirs with `description` (that replaces the whole text).
- **A blocking question** — there is no sensible way to do the issue without the answer. Ask it before any code, with concrete options, and fold the answer into the description.
- **A question found mid-work** — do not stop. Take the option that is cheapest to undo, finish the issue on it, and file a question issue (§5) titled `Question: …` with what was done, the alternatives and what each would change, labelled `Question`. Even Keel puts it in the chain like any other issue and the session started on it is where the user answers — so write it for the session that will discuss it, not for one that codes it.
- **Blocked by other work** — the issue cannot go on until something else is done. Find that issue or create it (§5), link it with `save_issue(id: <this issue>, blockedBy: ["<blocker>"])`, comment on this issue why it stopped and where (`save_comment(issueId, body)`), and end the turn. Even Keel sees the open blocker, releases this issue and runs the blocker first; this issue comes back after it. A blocker left in Backlog or Triage holds the issue too, until the user moves it on — use that when the blocker needs the user first.
- **An unrelated bug or idea** noticed on the way — a new issue (§5), not a change in this one.

## 4. Finishing

When the code is written and the checks the project's `CLAUDE.md` names pass:

1. Commit to the task branch.
2. `save_comment(issueId, body)` — what was done, in a few lines. Anything left undone becomes its own issue or a question issue (§3), not a line in the comment: no later session reads comments.
3. Merge: in the main checkout, which must be on `main`, `git merge --no-edit <branch>`. If it is not on `main`, or git refuses because of local changes there, stop and report — never stash, reset or force over someone else's work. If the project's `CLAUDE.md` says the user merges, hand them the command instead.
4. Started by Even Keel: before the merge, stop the background processes this session started in the worktree (dev servers, watchers) and copy anything worth keeping out of it. After the merge do not remove the worktree, do not delete the branch, do not push `main` — Even Keel waits for the turn to end, closes the issue and cleans up.
5. Started by hand: after the merge remove the worktree and delete the branch yourself, from the main checkout; push only if the project says so.
6. Sub-issues: the session that merges the last open sub-issue of a parent moves the parent to a completed state by hand (`save_issue(id: <parent>, state: "completed")`). Never mention the parent's id in a commit.

## 5. Creating issues

- `save_issue(team, title, description, priority, project, milestone, labels, state)` — no `id` when creating. The team is the key before the dash of the current task; the project is the Linear project the current issue is in, so Even Keel sees the new issue in the same chain.
- **Entering the chain.** By default Even Keel takes issues in a `unstarted` or `started` state; Backlog and Triage are a store of ideas. A new idea stays in Backlog (`state: "backlog"`) — the user moves it on after reading. A question issue or a blocker you file (§3) goes to Todo (`state: "unstarted"`), so the chain takes it.
- **Priority** moves the issue in the chain: `2` (High) for a bug that breaks the current work or stops the chain, or when the user says it goes next; `3` (Medium) for ordinary work; `4` (Low) for ideas and polish. Never set `1` (Urgent) yourself. What the user says about urgency wins.
- **Where to look** — add a `## Where to look` section naming the files, types and functions the work will touch, when you can name them honestly. Symbols, not line numbers. A guessed pointer is worse than none.
- **Model** — the labels `Sonnet`, `Opus` and `Haiku` pick the model Even Keel starts the session with. Label a well-scoped issue that a test or a build checks `Sonnet`; leave the rest unlabeled.
- **Run by hand** — an issue the user does themselves gets the label `Manual`: the chain skips it.
- **Order** between issues — `blockedBy`/`blocks` (§3), not prose. Issues of a later project milestone go after all issues of an earlier one; a blocker must not sit in a later milestone than the issue it blocks — Even Keel cannot order that and stops the chain.
- **Parts of a bigger issue** — sub-issues: `parentId: "<parent>"`. An issue with sub-issues never enters the chain itself.
- Labels: `list_issue_labels(team)` first and use the one already there; a missing one — `save_issue_label`. `labels` replaces the whole set, `addLabels` appends.
- Estimates in Linear are points, not hours; Even Keel does not read them.
- Write titles, descriptions and comments in the language the project's issues are written in; the project's `CLAUDE.md` may name it.
