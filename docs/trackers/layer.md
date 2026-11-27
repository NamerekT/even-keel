# The tracker layer: the contract

The neutral task model of `src/tracker/` (BTN-58) and the optional capabilities an adapter offers. The adapter contract is `source.ts`, `TaskSource`/`TrackerAdapter`, with the details in its JSDoc for those who write their own adapter. The chain, the order, the rules and the page state know only this layer.

Every adapter has most capabilities below. Each section lists how Huly, GitHub and Linear do it; Jira, GitLab and Forgejo do it in [`adapters.md`](adapters.md), the built-in tracker in [`builtin.md`](builtin.md). An adapter that lacks a capability is named where the capability is.

## Terms

- **Kind** — the adapter's name (`huly`, `github`, `linear`, `gitlab`, `jira`, `forgejo`, `builtin`), also the kind of a tracker profile.
- **Place** — where in the tracker a project reads: a Huly project, a repository, a Linear team or project (`placeOf`, "Projects and places" below).
- **Reader** — one source of a project's tasks: the project's own tracker or one of its task feeds (`readerIds`, `docs/chain/entry.md`, "Task feeds"). The service keeps reads, failures and refusals by reader, and judges a reader's tasks by its own chain rules.
- **Status categories** — the neutral `StatusCategory`, named after Huly's: `UnStarted` (backlog), `ToDo` (ready), `Active` (in work), `Won` (done), `Lost` (cancelled, duplicate). Every adapter maps its statuses onto them.
- **Own adapter** — one marked `own` (the built-in tracker): it needs no account, so the wizard's tracker list and the profile kinds leave it out.

## The model and the registry

- `model.ts`: `TrackerTask` comes from the adapter; `Task` adds the question flag (the label `Question` or `Вопрос`) and the open `ancestors`. A task's model and effort are not labels: they are its run, kept by Even Keel (`docs/sessions/models.md`, "The run of a task").
- A task ID is `<project key>-<number>`: the worktree, the branch and the stats go by it. What the tracker lacks, the adapter returns empty.
- The registry is `src/tracker/adapters.ts`: Huly, GitHub, Linear, GitLab, Jira Cloud, Forgejo and the built-in tracker. A project's adapter is its own `tracker`: the wizard, the project form and `config-import` always store it. `DEFAULT_TRACKER` (`github`) applies only to a hand-written project of the current schema that names none.
- The adapters know only the project key. Even Keel's own id of a project (`projects[].id`, a GUID) names it in `state/` and in the page's URLs and never reaches the tracker layer (`docs/chain/state.md`, "State files and the schema version").

## Projects and places

- `projectKey`: for a tracker whose project is not named by a key, the adapter declares a key in the project object (GitHub `github`: `owner/name`). A missing or malformed value is a config error.
  - `optional`: only a malformed value is an error (Linear's `linear` narrows the team to a project).
  - `alias`: the value names the tracker's project, and the key is only Even Keel's (Huly's `huly`, BTN-172).
- `placeOf(key, value)` gives the place a project reads (`read`) and the prefix of its task ids (`ids`) when the ids are the tracker's own. Projects with one place read it once and split it by milestone (`docs/chain/projects.md`, "Several projects on one tracker project"). `readKeyOf`/`idPrefixOf` in `src/config.ts` fall back to the key. The values reach `setup` as its second argument.
- `projectOfRemote` (optional) turns a git remote of the repository into that value: GitHub — a github.com remote's `owner/name`; GitLab — the full path on the profile's server ([`adapters.md`](adapters.md#gitlab-issues-btn-410-srcgitlab)). It gets the parsed remote, the URL as git has it and the values of the profile the draft runs on. The wizard fills the field with the first remote's answer (`repo.suggested` of `checkDraft`).

## The brief

`brief` gives the task's title and description for the launch and handoff prompts; `trackerOf` adds the task's parents, root first, the same way for every adapter (BTN-1398, `docs/sessions/models.md`, "Prompts"). Every adapter has it; in Huly (`src/huly/source.ts`) the description is Markdown.

Whether the prompt carries it is the `brief` key (global and per project, applied live):

- Unset or `null` — auto (`briefOn` in `src/service/account-packages.ts`): off exactly when an enabled package of the project brings the adapter's MCP server (`mcpServer`, for Huly `huly`) or, for a tracker the tasks server serves, the `tasks` server ([`tasks-server.md`](tasks-server.md#stands-in-for-the-trackers-server)). A project with the tracker's plugin gets only the task id, one without it gets the task, with nothing to switch. A feed's task goes by the feed's reader the same way. An adapter without `mcpServer` has the brief on.
- `true` or `false` overrides it. With `false` the packages must bring the server: without it the set has the problem `noTrackerMcp`, and the chain pauses with the reason and goes on by itself once it is gone (`chain.noTrackerMcp`, `docs/chain/pr-mode.md`).

A prompt without the brief says in its place to read the task first (BTN-1202, `withUnbriefed` in `src/chain/relay.ts`): through `task_read(<key>, comments: true)` when a package brings `tasks`, otherwise through the tracker's tools. A weak agent may never open the skill that says it.

## `complete` — closing on a merge

`complete(id)` moves the task to Done and returns `true`, or `false` when the task was already closed and nothing was written. Every adapter has it; in Huly Done is a status of the `Won` category from the project type.

Even Keel calls it once it sees the task's branch merged into the project's main branch (its `branch` key) on every remote of the checkout, a landing it pushed itself (BTN-1581, `docs/chain/worktrees.md`, "Landing"). A checkout without a remote and PR mode go by the local main branch (`src/git/merged.ts`, `src/tracker/closer.ts`): the branch tip is in it, and it has at least one commit made in the branch itself. That is read from the reflog: creation, `reset` and fast-forward pulls do not count, so a branch that only pulled in the main branch is not merged.

A task reopened after such a close is closed again only by a new merge (BTN-689, `docs/chain/cleanup.md`, "Cleanup after Done"). A git hook that also moves the task to Done does not conflict: whoever is first closes it. A chosen done status goes through `complete(id, name)` ([`link.md`](link.md#moving-a-task-to-a-chosen-status-btn-554)).

## `children` — closing a parent

`children` gives the direct subtasks of a task in any status. Every adapter but Forgejo has it: Huly by `attachedTo`, GitHub by `subIssues`, Linear by the `parent` filter, GitLab by the work-item hierarchy, Jira by subtasks and the issues of an epic.

With it and `complete`, Even Keel closes a parent (`src/tracker/parents.ts`). When tasks are refreshed, a parent open by the rules with no open subtask among the known tasks is checked in the tracker: all subtasks closed and at least one `Won` — `complete`; all cancelled — left to the user. The check runs before the chain gets the tasks, on a read and on a status poll that sees a subtask close, so a parent holding tasks with `blocks` is closed before the chain picks the next one and does not end it (BTN-1236).

In Huly `parents` goes from the direct parent to the root, the direct parent first, so a grandchild counts under its own parent. The parents view's subtask counts (`parentRows`) take each open task once, even when a nested parent is both among the parents and the tasks.

## The card

`card` (`TrackerCard`, `src/tracker/card.ts`, BTN-76) is the task card on the page: the description and comments in Markdown, labels, milestone, priority, parent, "blocked by", "blocks", "related", subtasks and attachments. Every adapter has it; without it the page answers "the tracker doesn't provide a card" and gives a link. The server (`GET /api/tasks/<id>`) adds `cardOf`: what each label means to Even Keel (question, keeps out, required) and whether the task can go into the chain or back to the backlog.

### `ready` and `unready`

Huly, Linear, Jira and the built-in tracker have them. `ready` moves a task of the `UnStarted` category to the first `ToDo` status of the project type and returns the new status; `unready` (BTN-509) moves a `ToDo` or `Active` task to the first `UnStarted` status, `null` for any other.

The page never calls them directly. `POST /api/task/ready` ("Into the chain") and `POST /api/task/unready` ("To the backlog") also put on or take off the chain's required label through `relabel`, so a tracker with no backlog status (GitHub, GitLab, Forgejo) gets both buttons by label alone (`docs/chain/entry.md`, "Entry into the chain"). The service puts the new state of the task into the chain at once, without waiting for a poll. Whether the adapter has `ready`, `unready` and `relabel` is carried in `trackers[]` of the state, so the buttons stand right in the backlog panel and the chain.

### Subtasks

The card's `subtasks` (BTN-1152, `SubtaskRef`: key, title, status, milestone label, made by `subtaskRef`) are the direct children in every status, read only for a task that has any. The list is the card's one source of subtasks, the built-in card's editing included (`CardEdit` has none).

- Huly asks the sub-issues (`attachedTo`) when the issue's `subIssues` count is above zero (`HulyCardDocs.subIssues`).
- GitHub runs `children` page by page when `subIssuesSummary.total` is above zero.
- Linear runs `children` (archived ones too) with the card query on every card: the card's own `children` connection leaves the archived out.
- GitLab reads each child of the hierarchy the card already reads by its own issue, for its milestone only.
- Jira runs `children` (`parent = <key>`) for an epic (`hierarchyLevel` above zero) or an issue that lists sub-tasks.
- The built-in tracker gives the store's children. Forgejo has no subtasks and leaves the field out.

### Attachments and the file route

The card's `attachments` (`file`, `name`, MIME `type`, `size`, `url`) are the files of the task and of its comments. An adapter with a public address gives `url`; with `url: null` the server puts its own `/api/tasks/<id>/files/<file>`, served by the optional `file(id, file)` (`TaskFile`: type, size, a byte stream).

The route sends `nosniff` and `private, max-age=3600`. Only raster images, video, audio and PDF go `inline`; everything else is `attachment` with `content-security-policy: sandbox`. There is no `Range`: a video plays, but seeking ahead waits for the download.

### How each tracker fills the card

- **Huly.** "Blocks" — tasks with this one in `blockedBy`; the query passes `blockedBy: { _id, _class }` as a whole object, since by `blockedBy._id` or `$elemMatch` Huly finds nothing. "Related" — the task's own `relations`: Huly stores the link on both sides. Comments are `chunter:class:ChatMessage` by `attachedTo`, the markup turned into Markdown with `@hcengineering/text-markdown`; the author is `createdBy` (social id) → `SocialIdentity.attachedTo` → `Person.name` as "Surname,Name". `file` answers only for a file of that task or its comments and streams it from the workspace storage (`connectStorage`, connected lazily, reconnected once on failure).
- **GitHub** (`toCard` in `src/github/model.ts`): one GraphQL query — `body`, `parent`, `blockedBy`, `blocking` (with the title and state of each), the first 100 comments (`author.login`). "Related" is always empty. No `ready`/`unready`: the backlog is the open issues without a required label. No attachments on the card: files of comments are links in their text.
- **Linear** (`toCard`, `readyState` in `src/linear/model.ts`): `blocks` both ways — `relations` (this task blocks) and `inverseRelations` (blocked by) — and `related` from either side; other relation types are dropped. Comments by `user.name`. `ready` moves a task in a `backlog`-type state to the team's first `unstarted` state by `position`; one in `triage` or any other state is left alone (`null`). `unready` (`backlogState`) moves an `unstarted` or `started` task to the first `backlog`-type state.
- **GitLab** (`GitlabUploads`, `src/gitlab/uploads.ts`): upload links in the description and human notes become attachments with `url: null` — relative `/uploads/<secret>/<filename>`, project URLs and `/-/project/<id>/uploads/…` of this project, an installation prefix included. The Markdown links are rewritten to the service's file route, and the card renders inline images and download links only for those. `file` checks that the task references the file, then streams the [REST download by secret and filename](https://docs.gitlab.com/api/project_markdown_uploads/#download-an-uploaded-file-by-secret-and-filename) with the profile token and redirects off. GitLab may answer `application/octet-stream` for media, so known image, audio, video and PDF extensions give the inline type.

## Questions in the tracker

`comment(id, body)` posts a Markdown comment and returns its id; `commentsAfter(id, after)` gives the comments posted after it, oldest first (`[]` once it is gone), each with its `files` as `file(id, file)` serves them (BTN-101, `src/tracker/questions.ts`).

### Posting the question

With both, `TrackerQuestions` polls every 15 s. When the session of a chain's current task waits on an `AskUserQuestion`, it posts the question with numbered options (`questionComment`) and remembers it in the state database (`questions`, `docs/storage.md`), so a restart does not post it twice.

A session that ended its turn without `AskUserQuestion` (a question in plain text, or just waiting) gets nothing posted and no comment read: it is answered from the page's chat or Remote Control. That is a decision (BTN-166): reading any comment as an answer would take a note to self or someone else's comment for one, and posting every end of a turn would flood the tracker.

### Reading the answer

- Every comment after the question counts as the user's: a waiting session does not comment, and Even Keel's token is often the user's own. On a public repository anyone can comment, so GitHub, GitLab and Forgejo take only members' comments ([`github.md`](github.md#outsiders-on-public-repositories)).
- The first comment answers by numbers (`2`, `1, 3`) or text, a line per question when there are several (`trackerAnswers`). The rest go along as text, and their files are downloaded into `.temp/inbox/` (a file the tracker will not give stays a link).
- A reply goes on only when a tick reads the same comments with the same files as the tick before (`seen`, in memory), so it waits 15–30 s. Huly writes a message and its attachments as separate documents, and a poll between them took the answer without its file (BTN-1020); a reply still being written waits again.
- The reply goes through `Dispatcher.answer` (`docs/chain/exceptions.md`, exception 6). `answer.busy`, `chain.launching`, `chain.limitSpent` and `chain.notCurrent` are retried on the next tick; any other refusal closes the question (`done`).
- A question the session left (answered through the page or Remote Control, a new session) is forgotten. One whose task is no longer current (BTN-120: the chain is led by the fix of a red main branch, the task is postponed or skipped) stays while its session lives and waits: its comments are read again once the chain takes the task back, from the same question comment, so a reply written meanwhile still arrives and the question is not posted twice.

### Comments' files, by tracker

- Huly: `chunter:class:ChatMessage` with the markup from `markdownToMarkup`; comments after by `createdOn`, files are their `attachment`s.
- GitHub, Linear and GitLab: a comment's files are the upload links in its body (`github.com/user-attachments/…`, `private-user-images.githubusercontent.com/…`; `uploads.linear.app/…`; GitLab's `/uploads/…`), and `file` fetches only those, with the token. GitLab collects files after checking the note author's membership.
- A fine-grained GitHub token never gets a private repository's upload (404). Then GitHub's `file` reads the issue's comments over REST with `Accept: application/vnd.github.html+json`, finds in `body_html` the signed `private-user-images…?jwt=` link of the same upload id (`src/github/uploads.ts`) and fetches it with no token. The signature lives minutes, so it is taken at each download and never stored. A file still unavailable is a log line naming the upload id, never the signed link. Both paths checked live ([verified](../verified/trackers.md)).

### Replies in a thread

An answer typed in the question's thread counts as a comment after it (BTN-897). Huly keeps such replies apart from the issue's comments and reads them separately ([`huly.md`](huly.md)). Linear gives them in `issue.comments` with the rest, each with its `parent` (checked live), so they are sorted in by time and the card lists them flat. GitLab's `/notes` lists every note, discussion replies included, by `created_at` (by the API's documentation, not checked live). GitHub, Forgejo and Jira have no threads under issue comments.

## `create`

`create(task: NewTask)` (BTN-103) makes a new task — project key, title, Markdown description, priority and the milestone of a given task (`milestoneOf`) — in the first ready status of the project and returns its ID. With the project's `ci.fixTask` on, the chain files the fix of a red main branch with it (`docs/chain/main-ci.md`, "The CI of main"), and without `create` a red main branch pauses the chain with `ci.cannotCreate`. With `ci.fixTask` off, the default, the fix is a session without a task.

- Huly: the number from the project's `sequence` (`$inc`), a rank after the last task (`makeRank`), the description through `uploadMarkup`, `addCollection` with `tracker.ids.NoParent`.
- GitHub: GraphQL `createIssue`; the priority is the `priority: <level>` label only if the repository has it.
- Linear: `issueCreate` in the team's first `unstarted` state, with the given task's project and project milestone.

## `closingRef`

`closingRef(id)` (BTN-295) says how a pull request names the task's issue; `null` for a task not of the tracker. GitHub gives `owner/repo#N` of the repository of the id's key, GitLab (BTN-414) the issue's address `<server>/<path>/-/issues/<iid>`, both with no request; the others have none. PR mode ends the body of a task's pull request on the same forge with `Closes <it>` (`closingOf`, `docs/chain/pr-mode.md`, "PR mode").

## Milestones

### `setMilestone`

`setMilestone(id, milestoneOf)` (BTN-107) puts a task without a milestone into the milestone of the task `milestoneOf`; `false` and no change when the task has one by now or `milestoneOf` has none. The chain fills the milestone of a task that entered without one (`fillMilestone`, `docs/chain/entry.md`, "Entry into the chain"). The milestone is named by a task that carries it, since the neutral model has no milestone ID.

- Huly: `milestone` of the issue; a task of another project gives none.
- GitHub: GraphQL `updateIssue` with `milestoneId`; a milestone belongs to a repository, so a task of another project gives none.
- Linear: `issueUpdate` with `projectMilestoneId`. A milestone belongs to a project, so an issue without a project gets the project with it, in the same `issueUpdate`; an issue of another project is left alone.

GitHub's and Linear's were checked live ([verified](../verified/trackers.md)).

### The milestone pick: `milestones` and `moveMilestone`

They come only as a pair (`trackerOf` drops one without the other): the milestone pick on the task card. `milestones` gives `MilestonePick`: the tracker's id of the task's milestone (`null` — none) and the choices, each with its id, label and target date, sorted as the chain sorts them (`compareMilestones`). `moveMilestone` puts the task into a choice's id, `null` into none. `POST /api/task/milestone` (`{task, milestone}`) calls it and then reads the project anew, since the milestone changes the chain order; without the pair it is `task.cannotMoveMilestone`.

- Huly: the milestones of the issue's project not Completed or Canceled, plus the issue's own when it is closed; a milestone of another project is refused.
- GitHub: the repository's open milestones (GraphQL `milestones(states: OPEN)`), plus the issue's own when it is closed; `updateIssue` with `milestoneId`, `null` clears it.
- Linear: every project milestone of the issue's project (Linear's have no closed state); an issue without a project has no choices. `issueUpdate` with `projectMilestoneId`, `null` clears it.

### `milestoneTasks`

`milestoneTasks(project, milestone)` (BTN-142) gives every task of a milestone named by its label, open and closed, each with the Markdown of its last comment (`MilestoneTask.lastComment`, as a rule the closing comment of its session); `[]` when the project has no such milestone. It feeds the changelog draft of a milestone (`src/changelog/`, `docs/sessions/chat.md`, "One-off turns"); without it the draft is `changelog.cannotList`.

- Huly: the project's milestones with that label, their issues and the newest `ChatMessage` of each (`latestMessages`), markup turned into Markdown.
- GitHub: the milestone's number by `milestones(query:)` over open and closed ones, then an exact title match; its issues with `comments(last: 10)`, of which the newest by a trusted author ([`github.md`](github.md#outsiders-on-public-repositories)).
- Linear: the team's project milestones of that name, their issues with both ends of `comments` (`newestBody` keeps the newer one). Linear's default order is by `createdAt`, newest first, and an edit does not move a comment (seen live), so `first: 1` is the newest.

Huly's and Linear's were checked live ([verified](../verified/trackers.md)).

## `vocabulary`

`vocabulary(project)` (EVK-1) gives `TrackerVocabulary`: the statuses with their categories (the rules' table places a status by its category until a list names it, BTN-334) and the labels a task of the project can have, carried or not. The settings suggest them in the chain rules together with what the loaded tasks carry, so a project with an empty chain still gets suggestions (`docs/web/project-settings.md`). `GET /api/projects/<id>/vocabulary` serves it by the project's id, 404 when the tracker is off or has no `vocabulary`. The service keeps an answer five minutes (`Vocabularies`, `src/tracker/vocabulary.ts`); a failure or a 404 is not kept.

- Huly: the statuses of the project's type in its order (every status when the type is unknown) and the workspace's issue labels — `tags:class:TagElement` with `targetClass` `tracker:class:Issue` (`vocabularyOf`).
- GitHub: its own four statuses (`GITHUB_STATUSES`) and every label of the repository (GraphQL `labels`, paged by 100).
- Linear: the team's workflow states and the labels of the team and of the workspace (`issueLabels` with the team, or none — a workspace label has no team), paged by 50; a label group is left out, since it cannot go on an issue.

Checked live on all three ([verified](../verified/trackers.md)).

## `closedPage` — the archive

`closedPage(project, open, { after, limit })` (BTN-1445) gives a page of the project's closed tasks of any milestone and age, the last closed first, in one request: `{ total, tasks, next }` with an opaque cursor; `limit: 1` doubles as the count. It feeds the archive's older pages and its count (`docs/chain/entry.md`, "Entry into the chain"); without it the archive holds only what `chainTasks` reads. `trackerOf` turns `open` from the reader's chain rules (`isTerminal`). A page's tasks carry their labels, so the "Outside the chain" archive (`outsideArchivePage`, BTN-1673) keeps the closed ones an excluding label kept out, but no `blockedBy`.

- The built-in tracker: one query (`readClosed`, `src/builtin/task-rows.ts`) with the count, ordered by the last status change in `builtin_history` (the task's `updated_at` when it never changed); the cursor is the offset.
- Huly has no closing time and no offset: the issues of the closed statuses go by `modifiedOn`, newest first, the cursor is the last row's `modifiedOn` (`$lt` it on the next page), and `total` comes from the find's `total`, so a later page counts only what is past its cursor. Issues changed in the same millisecond across a page's edge would be skipped ([unverified](../unverified/trackers.md#the-archives-older-pages-from-a-live-tracker-btn-1445)).
- GitHub: GraphQL `issues(states: CLOSED, orderBy: UPDATED_AT DESC)` with `totalCount` and `endCursor`, up to 100 a page; GitHub has no order by closing time either.
- Linear has none: its GraphQL gives no count of a filtered query. Jira, GitLab and Forgejo have none yet.

## `logTime`

`logTime(id, entry: TimeEntry)` with the adapter's `logsTime` (EKR-35) writes the agent's active time on a done task into the tracker's time tracking. Tally calls it once per task (`docs/tally.md`, "Task time"), through the profile of the task's project as `timeTrackers` gives it. `entryMinutes` makes whole minutes, at least one. `false` — the tracker refuses time in the project and the task needs no report; any other failure throws.

Only GitLab and Jira have it. Huly's report is Tally's own `TimeSpendReport`, not this operation; GitHub, Linear and Forgejo have no time tracking; the built-in tracker keeps no time spent: it stays the sessions' active time.

- GitLab: `POST /projects/:path/issues/:iid/add_spent_time` with `duration` `<n>m` and the `summary` label; a 403 (below Reporter, or the project's time tracking off) is `false`.
- Jira: `POST /issue/<key>/worklog?notifyUsers=false` with `timeSpentSeconds`, `started` — the last turn minus the time, as `…T10:13:00.000+0000` — and the label as an ADF `comment`. A 403, or a 400 whose `errors` name no field of the request (`JiraHttpError.fields`), is `false`: no "Work on issues" permission or tracking off. Jira words it in the account's language, so the text is never matched (EKR-91). A 400 naming a field is our request's fault and throws.
