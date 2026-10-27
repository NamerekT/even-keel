---
name: task
description: Working a Jira Cloud issue through the Atlassian Rovo MCP server — reading the issue, recording decisions in its description, filing a blocker or a question, creating new issues, the closing comment and the merge into main. Load it when the prompt is a task id such as ABC-12 in a project whose issues live in Jira (that is how Even Keel starts a session, sometimes with notes after the id), when the user says to take an issue, or before creating an issue. Not for projects whose work is not tracked in Jira.
---

# Working a Jira issue

Issues are reached through the `jira` MCP server (the Atlassian Rovo MCP server). If a tool is missing or refuses a call, tell the user instead of scripting against the API. The organization admin must enable API token authentication before the user creates a separate Atlassian MCP V2 token; the REST token does not work here. A successful tools/list alone does not prove access: getAccessibleAtlassianResources must include the issue's site, and getJiraIssue must succeed.

Even Keel runs the chain: it takes the open issues of the Jira project in order, starts a session on the first one, moves it to a Done-category status when its branch lands in `main`, cleans up and starts the next. The session does the issue and merges; everything else is Even Keel's.

## 0. Which issue

A task id is the Jira issue key itself: `ABC-12` is issue 12 of the project with the key `ABC`. Every Jira tool takes it as `issueIdOrKey`, together with the site's `cloudId`: call `getAccessibleAtlassianResources` once at the start and take the `id` of the site whose URL the issue lives on. Take the other arguments from each tool's schema.

## 1. Read the issue

- `getJiraIssue(cloudId, issueIdOrKey)` — summary, description, status, labels, priority, fix versions, parent, issue links, attachments. Screenshots are attachments: `downloadJiraIssueAttachment` reads them.
- Do not read the comments (`listJiraIssueComments`) when picking the issue up. Summary and description are the whole brief; read the comments only when the user or the description points at the discussion.
- Look for a blocking question (§3) before reading any code.

## 2. Where to work

`main` in this skill is the project's main branch: the one Even Keel's prompt names, otherwise the one the project's `CLAUDE.md` names, otherwise `main`.

- Started by Even Keel — the prompt names a ready worktree or a working folder: the session already runs in it, on the task's branch. Do not create a worktree, do not create or switch branches.
- Started by hand: follow the project's own `CLAUDE.md` for the branch and the worktree.
- Commit messages and branch names follow the project's `CLAUDE.md`. Without a rule there, prefix commits with the task id: `[ABC-12] Message`. A commit names only the key of its own issue, and never with a smart-commit command (`ABC-12 #done`, `#close`): Jira's development integration would move the issue on its own terms.
- **Do not move the status.** Even Keel moves the issue to a Done-category status when the branch is merged into `main`. Touch the status by hand only when the user asks, or to close a parent (§4): `listJiraIssueTransitions`, then `transitionJiraIssue` with the transition's id.

## 3. While working

- **Decisions go into the description.** Anything settled while the issue is open — scope, a number, an approach, a constraint — is folded into the description with `editJiraIssue` as soon as it is settled. The description is the one place a later session reads; a decision left in chat or in a comment is lost. The edit replaces the whole description: read it first and send it back with a section added, keeping the user's text as it is.
- **A blocking question** — there is no sensible way to do the issue without the answer. Ask it before any code, with concrete options, and fold the answer into the description.
- **A question found mid-work** — do not stop. Take the option that is cheapest to undo, finish the issue on it, and file a question issue (§5) titled `Question: …` with what was done, the alternatives and what each would change, labelled `Question`. Even Keel puts it in the chain like any other issue and the session started on it is where the user answers — so write it for the session that will discuss it, not for one that codes it.
- **Blocked by other work** — the issue cannot go on until something else is done. Find that issue or create it (§5), link them with `createJiraIssueLink` of the type `Blocks` so that this issue reads "is blocked by <blocker>" (`listJiraIssueLinkTypes` shows the type; the inward and outward fields are easy to swap, so check the direction with `getJiraIssue` and redo a reversed link), comment on this issue why it stopped and where (`addOrEditJiraIssueComment`), and end the turn. Even Keel sees the open blocker, releases this issue and runs the blocker first; this issue comes back after it. A blocker left in Backlog holds the issue too, until the user moves it on — use that when the blocker needs the user first.
- **An unrelated bug or idea** noticed on the way — a new issue (§5), not a change in this one.

## 4. Finishing

When the code is written and the checks the project's `CLAUDE.md` names pass:

1. Commit to the task branch.
2. `addOrEditJiraIssueComment` — what was done, in a few lines. Anything left undone becomes its own issue or a question issue (§3), not a line in the comment: no later session reads comments.
3. Merge: in the main checkout, which must be on `main`, `git merge --no-edit <branch>`. If it is not on `main`, or git refuses because of local changes there, stop and report — never stash, reset or force over someone else's work. If the project's `CLAUDE.md` says the user merges, hand them the command instead. If Even Keel's prompt says the project is in PR mode, its rule outranks this step: do not merge.
4. Started by Even Keel: before the merge, stop the background processes this session started in the worktree (dev servers, watchers) and copy anything worth keeping out of it. After the merge do not remove the worktree, do not delete the branch, do not push `main` — Even Keel waits for the turn to end, closes the issue and cleans up. An issue that needs no change in the repository — done in `main` already, research, an answer — has nothing to merge, and no merge closes it: leave the branch with no commits beyond `main` and `git status` clean, and end the turn with the last line `NO CHANGES: <one line — why>`. Even Keel closes the issue with that line as a comment. In PR mode the prompt's own mark applies instead.
5. Started by hand: after the merge remove the worktree and delete the branch yourself, from the main checkout; push only if the project says so.
6. Child issues: the session that merges the last open child of a parent moves the parent to a Done-category status by hand (§2). Never mention the parent's key in a commit.

## 5. Creating issues

- `createJiraIssue` in the project of the current issue, of the type `Task` (`listJiraProjectIssueTypesMetadata` shows the project's types), with the fix version of the current issue, so Even Keel sees the new issue in the same slice.
- **Entering the chain.** By default Even Keel takes issues in a To Do- or In Progress-category status; a status named `Backlog` is a store of ideas. A new idea stays in Backlog — the user moves it on after reading. A question issue or a blocker you file (§3) goes to the project's first To Do-category status after it, so the chain takes it.
- **Priority** moves the issue in the chain: `High` for a bug that breaks the current work or stops the chain, or when the user says it goes next; `Medium` for ordinary work; `Low` for ideas and polish. Never set `Highest` yourself. What the user says about urgency wins.
- **Where to look** — add a `## Where to look` section naming the files, types and functions the work will touch, when you can name them honestly. Symbols, not line numbers. A guessed pointer is worse than none.
- **Model** — a run label `<Provider> | <model>` (`Claude | sonnet`, `Codex | gpt-6.1-sol`) or a bare provider (`Codex`) picks what Even Keel starts the issue's session on, only in projects with run labels on (`modelLabels`). Set one only when the user named a model or a provider for the issue; otherwise leave it unlabeled. Jira labels cannot hold spaces: use the label the project already has, never invent a spelling.
- **Run by hand** — an issue the user does themselves gets the label `Manual`: the chain skips it.
- **Order** between issues — `Blocks` links (§3), not prose. Issues of a later fix version go after all issues of an earlier one; a blocker must not sit in a later version than the issue it blocks — Even Keel cannot order that and stops the chain.
- **Parts of a bigger issue** — child issues with the `parent` field, or subtasks. An issue with children never enters the chain itself.
- Estimates are not read by Even Keel.
- Write summaries, descriptions and comments in the language the project's issues are written in; the project's `CLAUDE.md` may name it.
