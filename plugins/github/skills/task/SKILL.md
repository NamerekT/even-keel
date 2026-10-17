---
name: task
description: Working a GitHub issue through GitHub's MCP server — reading the issue, recording decisions in its body, filing a blocker or a question, creating new issues, the closing comment and the merge into main. Load it when the prompt is a task id such as ABC-12 in a project whose issues live on GitHub (that is how Even Keel starts a session, sometimes with notes after the id), when the user says to take an issue, or before creating an issue. Not for projects whose work is not tracked in GitHub Issues.
---

# Working a GitHub issue

Issues are reached through the `github` MCP server (GitHub's remote server, toolsets `issues` and `labels`). One thing it lacks — "blocked by" links — goes through the `gh` CLI (§3). If anything else is missing, tell the user instead of scripting against the API.

Even Keel runs the chain: it takes the open issues of the repository in order, starts a session on the first one, closes it on GitHub when its branch lands in `main`, cleans up and starts the next. The session does the issue and merges; everything else is Even Keel's.

## 0. Which issue

A task id is `<project key>-<issue number>`: `ABC-12` is issue `#12`. The repository (`owner` and `repo` in every tool) is the one Even Keel's prompt names (`Tracker: GitHub, project owner/repo.`), otherwise the one the project's `CLAUDE.md` names; without either, the `origin` remote of the working folder (`git remote get-url origin`).

## 1. Read the issue

- `issue_read(method: "get", owner, repo, issue_number)` — title, body, labels, milestone, parent and sub-issue summary. Screenshots sit in the body as image links.
- Do not read the comments (`method: "get_comments"`) when picking the issue up. Title and body are the whole brief; read the comments only when the user or the body points at the discussion.
- Look for a blocking question (§3) before reading any code.

## 2. Where to work

`main` in this skill is the project's main branch: the one Even Keel's prompt names, otherwise the one the project's `CLAUDE.md` names, otherwise `main`.

- Started by Even Keel — the prompt names a ready worktree or a working folder: the session already runs in it, on the task's branch. Do not create a worktree, do not create or switch branches.
- Started by hand: follow the project's own `CLAUDE.md` for the branch and the worktree.
- Commit messages and branch names follow the project's `CLAUDE.md`. Without a rule there, prefix commits with the task id: `[ABC-12] Message`. Do not write `#12`, `fixes #12` or `closes #12` in commits: GitHub would link or close the issue on its own terms.
- **Do not close the issue.** Even Keel closes it as completed when the branch is merged into `main`. Touch the state by hand only when the user asks, or to close a parent (§4).

## 3. While working

- **Decisions go into the body.** Anything settled while the issue is open — scope, a number, an approach, a constraint — is folded into the body with `issue_write(method: "update", owner, repo, issue_number, body)` as soon as it is settled. The body is the one place a later session reads; a decision left in chat or in a comment is lost. `body` replaces the whole text: read it first, keep the user's text as it is and add a section.
- **A blocking question** — there is no sensible way to do the issue without the answer. Ask it before any code, with concrete options, and fold the answer into the body.
- **A question found mid-work** — do not stop. Take the option that is cheapest to undo, finish the issue on it, and file a question issue (§5) titled `Question: …` with what was done, the alternatives and what each would change, labelled `Question`. Even Keel puts it in the chain like any other issue and the session started on it is where the user answers — so write it for the session that will discuss it, not for one that codes it.
- **Blocked by other work** — the issue cannot go on until something else is done. Find that issue or create it (§5), then link it — the MCP server has no tool for this, so through `gh`:
  `gh api --method POST repos/<owner>/<repo>/issues/<this number>/dependencies/blocked_by -F issue_id=<blocker id>`
  where the blocker id is the numeric `id` that `issue_read` returns for the blocker, not its number. Comment on this issue why it stopped and where (`add_issue_comment`), and end the turn. Even Keel sees the open blocker, releases this issue and runs the blocker first; this issue comes back after it.
- **An unrelated bug or idea** noticed on the way — a new issue (§5), not a change in this one.

## 4. Finishing

When the code is written and the checks the project's `CLAUDE.md` names pass:

1. Commit to the task branch.
2. `add_issue_comment(owner, repo, issue_number, body)` — what was done, in a few lines. Anything left undone becomes its own issue or a question issue (§3), not a line in the comment: no later session reads comments.
3. Merge: in the main checkout, which must be on `main`, `git merge --no-edit <branch>`. If it is not on `main`, or git refuses because of local changes there, stop and report — never stash, reset or force over someone else's work. If the project's `CLAUDE.md` says the user merges, hand them the command instead.
4. Started by Even Keel: before the merge, stop the background processes this session started in the worktree (dev servers, watchers) and copy anything worth keeping out of it. After the merge do not remove the worktree, do not delete the branch, do not push `main` — Even Keel waits for the turn to end, closes the issue and cleans up.
5. Started by hand: after the merge remove the worktree and delete the branch yourself, from the main checkout; push only if the project says so.
6. Sub-issues: the session that merges the last open sub-issue of a parent closes the parent by hand (`issue_write(method: "update", state: "closed", state_reason: "completed")`). Never mention the parent's id in a commit.

## 5. Creating issues

- `issue_write(method: "create", owner, repo, title, body, labels, milestone)` in the repository of the current project.
- **Entering the chain.** GitHub has no backlog: an open issue is ready work. Projects that keep unread ideas out of the chain take only issues with an entry label (`chain.requiredLabels` in Even Keel's config; the project's `CLAUDE.md` names it). A new idea goes without it — the user adds it after reading. A question issue or a blocker you file (§3) gets it, so the chain takes it.
- **Priority** is a label, `priority: urgent|high|medium|low`, and it moves the issue in the chain: `priority: high` for a bug that breaks the current work or stops the chain, or when the user says it goes next; `priority: medium` for ordinary work; `priority: low` for ideas and polish. Never set `urgent` yourself. What the user says about urgency wins.
- **Where to look** — add a `## Where to look` section naming the files, types and functions the work will touch, when you can name them honestly. Symbols, not line numbers. A guessed pointer is worse than none.
- **Model** — a run label `<Provider> | <model>` (`Claude | sonnet`, `Codex | gpt-6.1-sol`) or a bare provider (`Codex`) picks what Even Keel starts the issue's session on, only in projects with run labels on (`modelLabels`). Set one only when the user named a model or a provider for the issue; otherwise leave it unlabeled. Take the name from the repository's labels (`list_label`), never create a new one.
- **Order** between issues — "blocked by" links (§3), not prose.
- **Parts of a bigger issue** — sub-issues: create the part with `parent_issue_number`, or attach an existing one with `sub_issue_write(method: "add", issue_number: <parent>, sub_issue_id: <part id>)`. An issue with sub-issues never enters the chain itself.
- A label the repository lacks — `label_write` creates it; `labels` on `issue_write` sets the whole list, so pass the existing labels too when you add one to an existing issue.
- Write titles, bodies and comments in the language the project's issues are written in; the project's `CLAUDE.md` may name it.
