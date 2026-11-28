# Configuration

This page lists every setting by its key in the exported file; the bold name in a row is where the page has the same setting. The settings of sessions, models and limits are in [Session settings](config-sessions.md), the environment variables in [Reference](reference.md).

Everything is edited on the page: projects are added by the wizard (**+ Add project** on the home page) and removed in their settings, a project's settings are on its page (**Settings**), the shared ones on `/settings`, behind the gear in the header. Every change applies at once, a project added or removed included. How the lists in the settings take input is in [Settings tables](page.md#settings-tables).

To edit the settings as a file:

- `npm run storage -- config-export <new file>` writes them out; [even-keel.config.example.json](../../even-keel.config.example.json) shows such a file.
- `npm run storage -- config-import <file>` puts a file in their place, whole: a key the file lacks goes back to its default, a project it lacks is removed. The file is checked before anything is written, and a running Even Keel applies it within seconds.

## The page and the service

| Key | Default | What it does |
| --- | --- | --- |
| `allowedHosts` | `[]` | host names the page may be opened by besides `localhost`, `127.0.0.1`, `[::1]` and `EVEN_KEEL_HOST`, such as a proxy's name; any other `Host` gets 403. **Other names of the page** in **Settings** → **Sign-in and devices** |
| `language` | the browser's | language of the page: `en` or `ru` ([Languages](page.md#languages)) |
| `updates.check` | `true` | ask GitHub for Even Keel's releases at start and every 12 hours, without a token; the first start asks about it during setup and checks nothing before. `false` — never ask, and the update window has nothing to offer ([Updating](updating.md#updating)) |
| `updates.notify` | `true` | a newer release gets a notification in the corner of the page; `false` — only the mark next to the version in the gear menu |
| `notices` | `{}` | warnings turned off, by kind: `{ "protection.remote": false }`. The shared settings may name `protection.noRules`, `protection.remote`, `branch.drift`, `cli.check`, `usage.unread`, `unattended`, `config.conflict`; a project's own only the first three, over the shared ones. Written by **Don't show again** and **Settings** → **Notices** ([Closing warnings](page.md#closing-warnings)) |
| `homeShowTests` | `false` | the flask button on the home page: `true` — the cards of test projects are shown there |
| `statsShowTests` | `false` | **Show test projects** on the statistics page: `true` — their history is in the statistics |
| `attachmentLimit` | `25` | megabytes, 1–1024: the largest file a task of the built-in tracker takes and the largest a session attaches to a task of any tracker. **Attachment size limit, MB** in **Settings** → **Interface** |
| `backup.dir` | `null` | absolute path of the folder the automatic copies of the state database go into ([Backups](updating.md#backups)); `null` — `backups/` in the state folder. **Copies folder** in **Settings** → **Backups** |
| `backup.keep` | `14` | how many of the newest checked copies stay, 1–365. **Copies to keep** in **Settings** → **Backups** |
| `memoryMirror` | `null` | a git address the projects' memory is pushed to, a branch per project ([Memory mirror](updating.md#memory-mirror)); must be private, no password in it. **Mirror repository** in **Settings** → **Backups** |
| `version` | — | version of the file's format; `config-export` writes it, and an older file is migrated as it is imported. A file newer than the code is refused |

## Machines

| Key | Default | What it does |
| --- | --- | --- |
| `machinesAddress` | `null` | the name or IP other machines reach this hub by, with `:port` after it when a router or proxy forwards another port; set, the hub listens on `EVEN_KEEL_MACHINES_PORT`. A proxy's name works only if the proxy passes that port too ([Hub and machines](hub-machine.md)). **Hub address for machines** in **Settings** → **Machines** |

## The chain

| Key | Default | What it does |
| --- | --- | --- |
| `parallel` | `1` | how many chains on different projects run at once; the rest wait in the queue. Lowered, it stops nothing: no new chain starts until fewer run. **Chains at once** in **Settings** → **Chain** |
| `unattended` | `false` | [unattended mode](chain.md#unattended-mode). **Unattended** in **Settings** → **Chain** |
| `defaultGit` | `null` | what the project wizard starts on for a new project: `true` — in a git repository, `false` — without git; `null` — git if it is installed. Written by the setup's Git step and **Settings** → **Chain** → **New projects** |
| `chain.active` | ready and in-progress categories | status names that enter the chain. **Statuses in work** ([Chain rules](chain.md#chain-rules)) |
| `chain.terminal` | done and canceled categories | status names that close a task. **Closed statuses** |
| `chain.requiredLabels` | `[]` | a task needs at least one of them; empty — no label needed. **Only tasks with labels** |
| `chain.excludedLabels` | `[]` | a task with one of them never enters the chain: you run it yourself; while open, it still holds the tasks it blocks. Empty by default: name the label you mark such tasks with. A level's list replaces the inherited one whole. **No tasks with labels** |
| `chain.requiredMilestones` | `[]` | a task belongs to the project only in one of these milestones; empty — in any. A task left out is not the project's at all: not read, shown or closed by it. **Project tasks** → "Only milestones" |
| `chain.excludedMilestones` | `[]` | a task in one of these milestones is not the project's. Two projects on one tracker project must split it with these two keys, so that no task is both's ([Release branches](ci.md#release-branches)). **Project tasks** → "All except" |
| `fillMilestone` | `false` | shared and per project (`projects[].fillMilestone`): `true` — a task that enters the chain without a milestone gets, in the tracker, the milestone of the current task, or the earliest one in the chain; once, so a milestone you change or clear afterwards stays. **Give the active milestone to tasks without one** in **Settings** → **Chain** and the project's **Tracker** tab |
| `landingHold` | `true` | shared and per project (`projects[].landingHold`): while a task's session resolves the conflict or the red check of its landing, the project starts no new task; tasks already running go on. `false` — the next task starts anyway. **Wait while a task resolves its landing** in **Settings** → **Check and CI** and the project's CI tab |

The `chain` rules are set in **Settings** → **Chain rules** for all projects, and also on two narrower levels:

- **A tracker profile**, in its tab of **Chain rules**: its `chain.active`, `chain.terminal`, `chain.requiredLabels` and `chain.excludedLabels` go for the projects and feeds on that profile over the shared ones. They are kept with the profile, so `config-export` leaves them out.
- **A project**, as `projects[].chain` (its **Tracker** tab → **Configure**): a key set there replaces the same shared key whole; `null` for `active` or `terminal` goes back to the status categories even when the shared settings list statuses.

The narrowest level that sets a rule wins. A project saved with the profile's value keeps no value of its own, so a later change of the profile reaches it. A save that would put one status or label on both sides of a rule is refused.

How statuses are matched:

- By name, case-insensitively.
- Without `active` and `terminal`, by status category: the backlog stays out, and a task enters the chain when you move it to a ready status. The default rules recognize a translated Backlog by its original name.
- Status names differ between trackers: if you set them at the top level, a project on another tracker needs its own. GitHub's are `Open`, `Completed`, `Not planned`, `Duplicate`; GitLab's are `Opened` and `Closed`; Jira's are the project's workflow statuses, by the names a localized site displays; Linear's are the team's workflow states.

## Projects

| Key | Default | What it does |
| --- | --- | --- |
| `projects` | — | an array of projects, each an object with the keys below |
| `projects[].key` | — | the project's key in Even Keel (a letter, then up to four letters, digits or `_`): the prefix of its branches and the label the page shows. Two projects may share a key — a release clone keeps the main project's — and the page then adds the name (or the branch) in brackets, `ABC (Release)`. Not on GitHub with two different repositories: their task ids would clash. On Huly it is the Huly project's identifier unless `huly` names another |
| `projects[].id` | given by Even Keel | the project's own id, a GUID that never changes; Even Keel, its state and the page's links name the project by it. An imported project without one gets one |
| `projects[].repo` | — | path to the main checkout |
| `projects[].name` | none | display name shown next to the key; the page edits it in the project head |
| `projects[].branch` | `main` | the project's main branch: tasks branch off it and merge into it, the CI and the check judge it. Changing it on the page switches the checkout ([The main branch](projects.md#the-main-branch)). **Main branch** on the **Repository** tab |
| `projects[].git` | `true` | `false` — [a project without git](chain.md#a-project-without-git): its folder is no repository, sessions work in the folder itself, and it has no pull requests, no [carrying of fixes](ci.md#carrying-fixes-forward) and no guard of the main branch, whatever the other keys say |
| `projects[].slot` | off | `true` or a number: [slots](chain.md#slots), permanent folders a task switches the branch in, so only the difference is rebuilt — worth it with heavy builds. **Slots** on the **Repository** tab: 0 — a worktree of its own per task |
| `projects[].slotCleanup.clean` | `[".temp/**"]` | `.gitignore`-style patterns from a slot's root: the ignored files they match are deleted after each Done in the slot; `[]` turns the cleanup off. Tracked files are never touched, `!` is not supported. Only in the file: the page has no field for it |
| `projects[].slotCleanup.keep` | `[]` | patterns kept even when `clean` matches them, such as `[".temp/notes/", ".temp/**/*.md"]`. Only in the file |
| `projects[].mergeInto` | none | makes this project a release project, whose fixes are carried into a main project's branch ([Carrying fixes forward](ci.md#carrying-fixes-forward)). The value is the main project's `id`; its key works too while no other project has that key. The main project must merge into none and be of the same repository. **Merges into** on the **Repository** tab, "Nothing — a main project" for none |
| `projects[].carryAgent` | `false` | on a release project: a carry that conflicts goes to the agent's session at once, as **Resolve with the agent** would. **Resolve a conflict with the agent by itself** |
| `projects[].color` | the first free one | 1–8: the project's colour on the home cards, the queue, the launch chart and `/stats`; a new project gets the first one no other project has. **Color** |
| `projects[].testProject` | `false` | marks a sandbox: hides its card from the home page and its history from the home launch chart and the default statistics, without stopping collection or chains; `homeShowTests` and `statsShowTests` show them again. **Test project** |
| `projects[].changelog` | `CHANGELOG.md` | the file the [changelog drafts](ci.md#changelog-drafts) are written into, relative to the repository's root, such as `docs/CHANGELOG.md`. **Changelog file** |
| `projects[].badge` | `null` | the project's README badge: `{ "on": true, "url": "https://badge.example.com", "slug": "my-project", "fields": [...] }` — the Worker's address, the project's name on it and what the badge shows (`title`, `agent`, `model`, `time`, `action`, `context`, `chain`, `milestone`, `sessions`, `medianCost`, `medianMinutes`; left out — all). `null` — no badge. **README badge** on the **Repository** tab; the Worker and how to deploy it: [`deploy/badge`](../../deploy/badge/README.md) |

## A project's tracker

Once the chain has started a task of a project, the page no longer switches that project's tracker or tracker project; add the other one as a [task feed](tracker-several.md#task-feeds) instead.

| Key | Default | What it does |
| --- | --- | --- |
| `projects[].tracker` | `github` | the project's tracker: `huly`, `github`, `linear`, `gitlab`, `jira` or `forgejo` (Jira Cloud: the key is the Jira project key, task ids are the issue keys). The page and `config-export` always write it; a project of a file without it runs on GitHub |
| `projects[].github` | — | `owner/name` of the repository, for a project on GitHub |
| `projects[].forgejo` | — | `owner/name` of the repository, for a project on Forgejo (Gitea, Codeberg); issue ids use the Even Keel key and the issue's number |
| `projects[].gitlab` | — | full project path, including subgroups (`group/subgroup/project`), for a project on GitLab; issue ids use the Even Keel key and the project's issue `iid` |
| `projects[].huly` | the key | identifier of the Huly project the project reads, when it is not the key; task ids stay Huly's (`ABC-12`) |
| `projects[].linear` | the whole team | for a project on Linear: the name of the Linear project the team is narrowed down to, and the key is the team key; or `TEAM/Project` (`TEAM/` for the whole team), and the key is only Even Keel's, so several projects can work on one team. Task ids stay the team's (`TEAM-12`) |
| `projects[].feeds` | `[]` | extra task feeds whose tasks join the project's chain ([Task feeds](tracker-several.md#task-feeds)). **Task sources** on the **Tracker** tab. Each is `{ "id": "<GUID>", "tracker": "github", "key": "ABCGH", "github": "owner/name" }`, with the place by the same keys as a project's, plus optional `chain` (its own chain rules) and `moves` (its own statuses on actions, as `statusMoves`). A feed's account is kept with the profiles, outside the file |
| `projects[].statusMoves` | `{}` | Huly, Linear and Jira: the statuses Even Keel moves the project's tasks into ([Statuses on actions](chain.md#statuses-on-actions)). `start` — when it starts a task, `review` — when it opens the task's pull request: a status name, or `null` to leave the status; `done` — the done status a merged task is closed into. A key left out takes the tracker profile's value. **Statuses on actions** in the **Configure** window of the **Tracker** tab |
| `projects[].milestoneOrder` | `[]` | milestone names in the order the project's chain goes by ([Milestone order](chain.md#milestone-order)); empty — the automatic order. A milestone not in the list takes its automatic place, a name no task carries is ignored. **Milestone order** in **Tracker** → **Configure** → **Milestones** |
| `projects[].intakeLabel` | `null` | a GitHub label: the open issues of the project's GitHub remote with it become tasks of the project's tracker ([GitHub issues taken into your tracker](trackers.md#github-issues-taken-into-your-tracker)). Not for a project whose tracker is GitHub. The token of the GitHub profile the remote takes needs Issues: Read and write. **Take in GitHub issues with the label** |
| `projects[].remoteProfiles` | `{}` | `{ "github": "<profile id>", "forgejo": "<profile id>", "gitlab": "<profile id>" }` — the profile the remote's CI and pull requests take, per kind; a missing one, or one that does not fit the remote (another kind, another Forgejo host or GitLab installation, removed), is the automatic choice ([CI and pull requests](tracker-several.md#ci-and-pull-requests)) |
| `projects[].chain` | the shared rules | the project's own chain rules, by the keys of `chain` (see [The chain](#the-chain)) |
| `projects[].brief` | the shared one | the project's own `brief` ([Session settings](config-sessions.md)) |
