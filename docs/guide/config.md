# Configuration

The settings are kept in the state database; the keys below are those of their file format, which [even-keel.config.example.json](../../even-keel.config.example.json) shows at work.

Everything can be edited on the page: projects are added by the wizard (**+ Add project** on the home page) and removed in their settings, a project's keys on its page (**Settings**), the shared ones on `/settings`, behind the gear in the header.

Once the chain has started a task of a project, the page no longer switches that project's tracker or tracker project; add the other tracker as a task feed instead (`projects[].feeds`).

Every key applies at once, a project added or removed included.

To edit them as a file, `npm run storage -- config-export <new file>` writes them out and `npm run storage -- config-import <file>` puts a file in their place, whole: a key the file lacks goes back to its default, a project it lacks is removed.

The file is checked before anything is written, and a running Even Keel applies it within seconds; a form open on the page keeps your edits of fields the import did not change and marks a field changed in both.

Settings tables include a started bottom row when you save; **+** or Enter adds it to the table so you can start another (Ctrl/Command+Enter in a multiline cell).

Missing required cells and repeated keys are marked when you leave the row or save, and must be corrected before saving.

Reverting a field or tab clears its started row.

Unsaved table input survives navigating away and back while the page remains open; reloading the page discards it.

The project wizard includes its started milestone row when adding the project.

## The page and the service

| Key | Default | What it does |
| --- | --- | --- |
| `allowedHosts` | `[]` | host names the page may be opened by besides `localhost`, `127.0.0.1`, `[::1]` and `EVEN_KEEL_HOST`, such as a proxy's name; any other `Host` gets 403 |
| `machinesAddress` | `null` | "Hub address for machines": the name or IP other machines reach this one by, `:port` after it when a router or proxy forwards another; set, the hub listens on `EVEN_KEEL_MACHINES_PORT`. A proxy's name works only if the proxy passes that port too |
| `language` | the browser's | language of the page: `en` or `ru` |
| `updates.check` | `true` | ask GitHub for the Even Keel releases at start and every 12 hours, without a token, though not before the first start's setup is through (it asks this); `false` — never go there, and the update window has nothing to offer ([Updating](updating.md#updating)) |
| `updates.notify` | `true` | a newer release gets a notification in the corner of the page; `false` — only the mark next to the version in the gear menu |
| `notices` | `{}` | warnings turned off, by kind: `{ "protection.remote": false }`. Even Keel's may name `protection.noRules`, `protection.remote`, `branch.drift`, `cli.versions`, `cli.check`, `usage.unread`, `unattended`; a project's own only the first three, over Even Keel's. `cli.versions` is still accepted but turns nothing off: unchecked CLI versions are only in the event log now. Written by **Don't show again** and **Settings → Notices** ([Closing warnings](page.md#closing-warnings)) |
| `homeShowTests` | `false` | the flask button on the home page: `true` — the cards of test projects are shown there |
| `statsShowTests` | `false` | **Show test projects** on the statistics page: `true` — their history is in the statistics |
| `attachmentLimit` | `25` | megabytes, 1–1024: the largest file a task of the built-in tracker takes and the largest a session attaches to a task of any tracker; **Attachment size limit, MB** in **Settings** → **Interface** |
| `backup.dir` | `null` | absolute path of the folder the automatic copies of the state database go into ([Stored state](updating.md#stored-state)); `null` — `backups/` in the state folder. **Copies folder** in **Settings** → **Backups** |
| `backup.keep` | `14` | how many of the newest checked copies stay, 1–365; **Copies to keep** in **Settings** → **Backups** |
| `memoryMirror` | `null` | a git address the projects' memory is pushed to, a branch per project ([Stored state](updating.md#stored-state)); must be private, no password in it. **Mirror repository** in **Settings** → **Backups** |
| `version` | — | version of the file's format; `config-export` writes it, and an older file is migrated as it is imported. A file newer than the code is refused |

## The chain

| Key | Default | What it does |
| --- | --- | --- |
| `parallel` | `1` | how many chains on different projects run at once; the rest wait in the queue. Lowered, it stops nothing: no new chain starts until fewer run |
| `unattended` | `false` | [unattended mode](chain.md#unattended-mode), the switch in **Settings → Chain** |
| `defaultGit` | `null` | what the project wizard starts on for a new project: `true` — in a git repository, `false` — without git; `null` — git if it is installed. Written by the setup's Git step and **Settings → Chain** → **New projects** |
| `chain.active` | ready and in-progress categories | status names that enter the chain |
| `chain.terminal` | done and canceled categories | status names that close a task |
| `chain.requiredLabels` | `[]` | a task needs at least one of them; empty — no label needed |
| `chain.excludedLabels` | `[]` | a task with one of them never enters the chain: you run it yourself; while open, it still holds the tasks it blocks. Empty by default: name the label you mark such tasks with. A level's list replaces the inherited one whole. An installation upgraded from an earlier version keeps `Manual` (and, from 0.2, `Вручную`) in the lists it had or relied on |
| tracker profile's chain rules | none | `chain.active`, `chain.terminal`, `chain.requiredLabels` and `chain.excludedLabels` set on a tracker profile, in its tab of **Chain rules** on `/settings`: they go for the projects and feeds on that profile over the shared ones, a project's or a feed's own still winning; a project saved with the profile's value keeps none of its own, so a later change of the profile reaches it. Kept with the profile, so `config-export` leaves them out; a save that would put a status or label of a project on it on both sides is refused |
| `chain.requiredMilestones` | `[]` | a task belongs to the project only in one of these milestones; empty — in any. A task left out is not the project's at all: not read, shown or closed by it. On the page: **Project tasks** → "Only milestones" (this key) or "All except" (the next one) |
| `chain.excludedMilestones` | `[]` | a task in one of these milestones is not the project's. Two projects on one tracker project must split it with these two keys, so that no task is both's: say, a release project requires `v0.1` and the main one excludes it |
| `fillMilestone` | `false` | shared and per project (`projects[].fillMilestone`): `true` — a task that enters the chain without a milestone gets, in the tracker, the milestone of the current task, or the earliest one in the chain; once, so a milestone you change or clear afterwards stays |
| `landingHold` | `true` | shared and per project (`projects[].landingHold`): while a task's session resolves the conflict or the red check of its landing, the project starts no new task; tasks already running go on. `false` — the next task starts anyway |

Statuses are matched by name, case-insensitively.

Without `active` and `terminal` the chain goes by status category, so the backlog stays out and a task enters the chain when you move it to a ready status.

Status names differ between trackers: if you set them at the top level, a project on another tracker needs its own (GitHub's are `Open`, `Completed`, `Not planned`, `Duplicate`; GitLab's are `Opened` and `Closed`; Jira's are the project's workflow statuses; Linear's are the team's workflow states), as in the example.

On localized Jira sites, use the displayed workflow names in explicit status lists.

The default rules recognize a translated Backlog by its original name.

Automatically created Jira tasks use the standard Task type by its original name, or the first available standard type; epics and subtasks are excluded.

## Projects

| Key | Default | What it does |
| --- | --- | --- |
| `projects` | — | an array of projects, each an object with the keys below |
| `projects[].key` | — | the project's key in Even Keel (a letter, then up to four letters, digits or `_`): the prefix of its branches and the label the page shows. Two projects may share a key — a release clone keeps the main project's — and the page then adds the name (or the branch) in brackets, `ABC (Release)`. Not on GitHub with two different repositories: their task ids would clash. On Huly it is the Huly project's identifier unless `huly` names another |
| `projects[].id` | given by Even Keel | the project's own id, a GUID that never changes; Even Keel, its state and the page's links name the project by it. An imported project without one gets one |
| `projects[].repo` | — | path to the main checkout |
| `projects[].name` | none | display name shown next to the key; the page edits it in the project head |
| `projects[].branch` | `main` | the project's main branch: tasks branch off it and merge into it, the CI and the check judge it. The field offers the repository's branches, local and remote. Saving another branch on the page switches the main checkout to it — a branch the repository lacks is created from where the checkout stands, uncommitted changes going along, one only on a remote is taken from there — and nothing is saved when git refuses the switch or while the project has a task in work. The project's folders on the other machines of its pool switch first, the same way; a machine that is offline or cannot switch (uncommitted changes in its way) stops the save with its name, and the machines already switched go back. A checkout switched by hand keeps the setting: the settings and the chain's card say so, with **Make … the main branch** and **Put the folder back on …**; a machine's folder switched by hand shows the same on the machine's page and in the project's **Machines** tab, and that machine takes none of the project's tasks until it is back. Set by hand in the config, a branch missing from the repository pauses the chain |
| `projects[].git` | `true` | `false` — [a project without git](chain.md#a-project-without-git): its folder is no repository, sessions work in the folder itself, and it has no PR mode, no carry and no guard of the main branch, whatever the other keys say |
| `projects[].slot` | off | `true` or a number: a pool of permanent worktrees instead of one per task |
| `projects[].slotCleanup.clean` | `[".temp/**"]` | `.gitignore`-style patterns from a slot's root: the ignored files they match are deleted after each Done in the slot; `[]` turns the cleanup off. Tracked files are never touched, `!` is not supported |
| `projects[].slotCleanup.keep` | `[]` | patterns kept even when `clean` matches them, such as `[".temp/notes/", ".temp/**/*.md"]` |
| `projects[].mergeInto` | none | the `id` of a main project, or its key while no other project but this one has it, which makes this one a release project: its branch is merged into the main project's branch when that project's chain stands (stopped, empty or paused) or on **Carry now** on the project's page, and pushed. A conflict is aborted, the main checkout stays clean, and the carry waits for you: **Resolve with the agent** on the project's page gives it to a session of the main project, or merge by hand and it goes on. The main project must merge into none and be of the same repository: the two checkouts share a remote, or one is a clone of the other's folder |
| `projects[].carryAgent` | `false` | on a release project: a carry that conflicts goes to the agent's session at once, as **Resolve with the agent** would. Unattended mode does the same with it off. A session that did not land the carry gets no successor until the release branch moves |
| `projects[].color` | the first free one | 1–8: the project's colour on the home cards, the queue, the launch chart and `/stats`; a new project gets the first one no other project has |
| `projects[].testProject` | `false` | marks a sandbox: hides its card from the home page and its full history from the home launch chart and default aggregate statistics, without stopping collection or chains; `homeShowTests` and `statsShowTests` show them again |
| `projects[].changelog` | `CHANGELOG.md` | the file the [changelog drafts](ci.md#changelog-drafts) are written into, relative to the repository's root, such as `docs/CHANGELOG.md` |
| `projects[].badge` | `null` | the project's README badge: `{ "on": true, "url": "https://badge.example.com", "slug": "my-project", "fields": [...] }` — the Worker's address, the project's name on it and what the badge shows (`title`, `agent`, `model`, `time`, `action`, `context`, `chain`, `milestone`, `sessions`, `medianCost`, `medianMinutes`; left out — all). Set in the project's settings → **Repository** → **README badge**; `null` — no badge. The Worker and how to deploy it: [`deploy/badge`](../../deploy/badge/README.md) |

## A project's tracker

| Key | Default | What it does |
| --- | --- | --- |
| `projects[].tracker` | `github` | the project's tracker: `huly`, `github`, `linear`, `gitlab`, `jira` or `forgejo` (Jira Cloud: the key is the Jira project key, task ids are the issue keys). The page and `config-export` always write it; a project of a file without it runs on GitHub. A file of an older Even Keel gives each project the tracker it ran on |
| `projects[].github` | — | `owner/name` of the repository, for a project on GitHub |
| `projects[].forgejo` | — | `owner/name` of the repository, for a project on Forgejo (Gitea, Codeberg); issue ids use the Even Keel key and the issue's number |
| `projects[].gitlab` | — | full project path, including subgroups (`group/subgroup/project`), for a project on GitLab; issue ids use the Even Keel key and the project's issue `iid` |
| `projects[].huly` | the key | identifier of the Huly project the project reads, when it is not the key; task ids stay Huly's (`ABC-12`) |
| `projects[].linear` | the whole team | for a project on Linear: the name of the Linear project the team is narrowed down to, and the key is the team key; or `TEAM/Project` (`TEAM/` for the whole team), and the key is only Even Keel's, so several projects can work on one team. Task ids stay the team's (`TEAM-12`) |
| `projects[].feeds` | `[]` | extra task feeds whose tasks join the project's chain ([Several trackers for one project](trackers.md#several-trackers-for-one-project)): each `{ "id": "<GUID>", "tracker": "github", "key": "ABCGH", "github": "owner/name" }` — a tracker, a key and the tracker's place by the same keys as a project's (`github`, `huly`, `linear`, `gitlab`). The ids of a feed's tasks must not start like another project's or feed's, and no two may read one place. A feed's account is chosen on the page (the tracker's default without one) and is kept with the profiles, outside the file. `chain` — the feed's own chain rules, by the keys of `chain` (`active`, `terminal`, `requiredLabels`, `excludedLabels`, `requiredMilestones`, `excludedMilestones`), over its profile's and the shared ones; the project's rules do not reach a feed's tasks. `moves` — the feed's own statuses on actions, as `projects[].statusMoves` |
| `projects[].statusMoves` | `{}` | Huly, Linear and Jira only: the statuses Even Keel moves the project's own tracker's tasks into ([Statuses on actions](chain.md#statuses-on-actions)). `start` — when it starts a task, `review` — when it opens the task's pull request: a status name, or `null` to leave the status; `done` — the done status a merged task is closed into. A key left out takes the tracker profile's value, set in its tab of **Chain rules** and kept with the profile, outside the file; none anywhere — nothing moves and a merged task closes into the tracker's first done status |
| `projects[].milestoneOrder` | `[]` | milestone names in the order the project's chain goes by ([Milestone order](chain.md#milestone-order)); empty — the automatic order. The page writes it from **Tracker** → **Configure** → **Milestones** → **Milestone order**; a milestone not in the list takes its automatic place, a name no task carries is ignored |
| `projects[].intakeLabel` | `null` | a GitHub label: the open issues of the project's GitHub remote with it become tasks of the project's tracker; collaborators' comments are copied as they are, the issue author's as information, nobody else's; when the task is done the issue gets the line "Fixed; it ships in vX.Y.Z" and is closed when that release is published ([GitHub issues taken into your tracker](trackers.md#github-issues-taken-into-your-tracker)). Not for a project whose tracker is GitHub. The token of the GitHub profile the remote takes needs Issues: Read and write |
| `projects[].remoteProfiles` | `{}` | `{ "github": "<profile id>", "forgejo": "<profile id>", "gitlab": "<profile id>" }` — the profile the remote's CI and pull requests take, per kind; a missing one, or one that does not fit the remote (another kind, another Forgejo host or GitLab installation, removed), is the automatic choice ([CI and pull requests](tracker-several.md#ci-and-pull-requests)) |
| `projects[].brief`, `.chain` | the shared ones | per project; a project's `chain` key replaces the shared key whole; `null` for `active` or `terminal` goes back to the status categories over a shared list |
