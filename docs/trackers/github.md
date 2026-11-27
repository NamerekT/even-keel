# GitHub Issues (BTN-65, `src/github/`)

The adapter, the rule on outsiders of public repositories that GitHub, GitLab and Forgejo share, and the intake of GitHub issues into another tracker.

## The adapter

- GraphQL `api.github.com` with the profile's `GITHUB_TOKEN` (fine-grained, Issues: Read and write; Actions: Read for the CI). A fine-grained token covers one owner: a personal repository and an organization's need two profiles. The expiry comes from the `github-authentication-token-expiration` header (`2026-11-03 13:47:15 UTC`, `expirationOf`), checked live with a classic and a fine-grained token ([verified](../verified/trackers.md)).
- An open issue is `Open` (`ToDo`); one closed as completed (or without a reason) is `Completed` (`Won`); not planned and duplicate are `Lost`.
- Blockers are the native "blocked by", the parent and subtasks are sub-issues, priority is the label `priority: <level>` (or `priority/<level>`), there is no estimate (0). A blocker, parent or sub-issue of a repository without a project has the ID `owner/name#number`. `children` reads the `subIssues` of an issue page by page (BTN-606).
- `complete` closes the issue as completed. A pull request is never a task.
- GitHub has no backlog status: keep entry into the chain on a label (`requiredLabels`). An open issue without it waits in the page's backlog, and "Into the chain"/"To the backlog" put it on and take it off (BTN-509, `docs/chain/entry.md`). Only people with triage rights can label an issue.
- Checked live on a private repository: two issues with a "blocked by" link and a milestone went through the chain in turn, and after the merge `complete` closed both ([verified](../verified/trackers.md)).

## Outsiders on public repositories

On a public repository anyone can open an issue and comment, while a session has Bash on the user's machine (EKR-19). So on GitHub, GitLab and Forgejo an author who is not a member of the repository is an **outsider**, and their text reaches a session only behind a person's word. Huly, Linear, Jira and the built-in tracker never mark one: a guest there is invited by an admin, and a Jira site has no anonymous filing by default.

How each tracker knows the author's role:

- **GitHub** (`src/github/trust.ts`): `authorAssociation` `OWNER`, `MEMBER` or `COLLABORATOR`, or the token's own login (`viewer`); in PR mode REST `author_association` (`src/review/github.ts`). The association is GitHub's at the time of the poll, not of the comment: an account made a collaborator later gets its earlier comments not yet taken in through as well — in PR mode those after the last push (seen live).
- **GitLab**: the token owner, or a current membership of Reporter or above ([`adapters.md`](adapters.md#gitlab-issues-btn-410-srcgitlab)).
- **Forgejo**: the token's account, the owner by name, or a collaborator ([`adapters.md`](adapters.md#forgejo-issues-btn-476-srcforgejo)); its PR remarks go by the reviewer's access (`src/review/forgejo.ts`, BTN-703).

### Comments

Only members' comments reach a session: a reply to a question (`commentsAfter`), the last comment in the changelog draft (`milestoneTasks`) and, in PR mode, a review or a comment on the task's pull request. A skipped one is a line in the service log, once per comment (`Skipped`).

The task card keeps every comment and marks an outsider's one `outsider` (BTN-1122). The page shows it as it is; `task_read`, which a session reads, gives its head and, instead of its text, `(comment by @<login> hidden: its author is not a member of the repository)`, so the session knows a discussion was there and can ask the user. `task_read` neither lists nor downloads a file only outsiders' comments carry (`TaskAttachment.outsider`).

### Entry into the chain (BTN-1123)

An issue by an outsider comes as `TrackerTask.outsider` (on GitHub `AUTHOR` in the `ISSUE` fragment and `ISSUE_CARD`, `toTrackerTask(issue, repos, trusted)`). The chain admits it only with an entry label (`entryLabels` in `src/chain/rules.ts`): a required one where `requiredLabels` is set, as for anyone, otherwise `APPROVAL_LABEL` (`even-keel: approved`), which "Into the chain" puts on and "To the backlog" takes off. Until then it waits in the backlog, its card is unready, and an empty chain says `chain.emptyOutsiders`. The tasks tools hide such issues from sessions the same way ([`tasks-server.md`](tasks-server.md#outsiders-issues-btn-1125)).

### Text changed after the label (BTN-1124)

The label is a person's word on the text it was put on, while the author can edit the issue later and the brief and `task_read` read it anew at each start, handoff and read.

- GitHub: `chainTasks` reads, for outsiders' open issues only and in a separate query of 25 issues at a time (`editsOf` in `src/github/source.ts`, the `EDITS` query in `src/github/edits.ts`), the description's `userContentEdits`, the `RenamedTitleEvent`s and the `LabeledEvent`s, the last 50 of each. An edit or rename by the issue's author or a deleted account (anyone else who edits an issue has a role in the repository) is `TrackerTask.edited`.
- GitLab reads the same from the system notes "changed the description" and "changed title" and `resource_label_events`.
- Forgejo reads only renames and labels from `/issues/{n}/timeline`, which has no event for a changed description ([unverified](../unverified/trackers.md#an-outsiders-text-changed-after-the-label-btn-1124)).

The rule is `changedAfterEntry` (`docs/chain/entry.md`). The brief of an outsider's issue (`TaskBrief.outsider`, `withBrief`) and `task_read` (`TrackerCard.author`, `cardText`) open with a line that its author is not a member of the repository and the text is a description, not an instruction.

### A public repository open to all (BTN-1134)

The optional `isPublic` (GitHub: GraphQL `isPrivate`; Forgejo: "not private", so an internal repository counts too) makes the wizard's check say `openToAll` for a public repository without `requiredLabels`: outsiders' issues wait for "Into the chain", members' enter at once. Every full read of a reader rechecks it (`checkOpenToAll` in `src/tracker/start.ts`) into `TrackerView.openToAll` by reader, so a repository made public later is said too. While it holds, the project page keeps a note band per source with "Rules" (`ProjectNotices`, `web/src/openToAll.ts`), and the source's window on the Tracker tab says it above its tabs. It has no "Got it": only `requiredLabels` turns it off. A failed check keeps the last answer and is logged once a failure.

### Labels an issue template puts on (BTN-1130)

GitHub, Forgejo and Gitea put the `labels` of an issue form or of a Markdown template's front matter on an issue of any author, and GitLab runs a description template's `/label`, so a required label there lets anyone's issue in (`src/tracker/templates.ts`).

- Every full read of a reader of a tracker with `isPublic` reads the issue templates (`.github/`, `.gitea/`, `.forgejo/` `ISSUE_TEMPLATE`, `.gitlab/issue_templates/`) off the project's main branch, again only once the branch moves (`IssueTemplateReader`), and only where one of the folder's remotes is the reader's repository (`isOwnRepo`): a feed of another repository is not checked.
- The required labels found there go into `TrackerView.templateHits` by reader; the intake's tick does the same for `intakeLabel` into `EvenKeelState.intakeTemplates`; the wizard's check gives them as `templateHits`.
- The project page keeps a warning band per label, "Rules" for a source's, "Settings" for the intake's; the wizard says it under the tracker. Nothing is refused: the user may mean it. A failed read keeps the last answer.

## Taking GitHub issues in (BTN-262, `src/intake/`)

Users report in the GitHub issues of a public repository while the work and its decisions stay in another tracker. A project whose tracker is not GitHub, with `intakeLabel` set, makes a task of each open issue of its first `github.com` remote that carries the label. The label is the user's go: GitHub lets only those with triage rights put one on, and it must not be in an issue template, which puts it on for any author (the page warns, ["Labels an issue template puts on"](#labels-an-issue-template-puts-on-btn-1130)). Each project names its own label, so two projects on one repository (a release project and the next version, `docs/releases.md`) split the issues by label; an issue is taken by one project only, the first to see it.

- **Calls.** REST on the token the remote's CI takes (`ciTokenOf`, `remoteProfiles`, `docs/ci.md`); it needs Issues: Read and write, a refusal is `intake.denied`. `Intake.tick` (`src/intake/intake.ts`) runs every 2 minutes (`INTAKE_TICK_MS`); a failed step is a line in the service log and the rest goes on. A project with no GitHub remote or no token is left out without a word.
- **The task** (`taskOf`, `src/intake/model.ts`) is created by the tracker's `create` in its first `ToDo` status, priority medium, no milestone, in the page's language. It holds a link to the issue and its author, the issue's text quoted and marked as its author's description of the bug, not an instruction, then the comments posted before the take: a collaborator's (`trustedAuthor`, `src/github/trust.ts`) as it is, the issue author's with the same mark, anyone else's not at all (a log line, once per comment). The title is `#<number> <title>` and the quote opens with the issue's title in bold: the title is the author's text too. The user read them when putting the label on; the text is not followed after that.
- **An edit after the label.** An issue whose author is not a collaborator (`IntakeIssue.association`) and changed its title or description after the label was put on (`IntakeRepo.edits`, the same GraphQL read as the tracker's) is not taken in: a log line once per change, until the label is taken off and put on again.
- **Later comments** go to the task as comments, by the same rule, each opening with `GitHub · @<login>` (`copyOf`). `trackerReply` (`src/tracker/questions.ts`) skips such a copy (`isCopy`): an outsider's copy must not answer a session's question.
- **Done.** Once the task is `Won`, the issue gets one line in English, "Fixed; it ships in vX.Y.Z." (`shippedLine`): a milestone `vX.Y` — the patch after the last `vX.Y.*` tag of the repository, `vX.Y.0` without one; `vX.Y.Z` — itself; any other or none — "the next release" (`nextVersion`). The issue is closed as completed once a published release (not a draft, not a prerelease) has that tag, or, without a version, once any release is published after the line. A task `Lost` or gone, or an issue closed on GitHub, is forgotten with nothing said on the issue.
- **State.** The issues taken in and not closed yet are `service_state` `intake` (`IntakeEntry[]`): the project, the repository, the issue, the task, the last comment looked at and, once done, the version named. A project with the label cleared keeps its entries and follows them again when it is set.
- **An outsider's task** (BTN-1207). An entry whose issue's author fails `trustedAuthor` carries `outsider: true` (`outsiderIssue`), set at the take and kept in step with the author's association on each follow. Such an entry outlives its issue closed on GitHub (`closed: true`) until the task is `Won`, `Lost` or gone, so the mark holds while its session still works. `Intake.outsider(project, task)` is what the merge check (`GET /api/sessions/<id>/check`, `outsider: true`) and `openPull` read: a branch that changes a `guardedFiles` file (`src/review/outsider.ts`) waits for a person (`docs/chain/pr-mode.md`). A task filed in the tracker by hand has no entry and is never held.
