# Changelog

All notable changes to Even Keel are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **The main branch field offers the repository's branches, and saving another branch switches the main checkout to it**, in a project's settings and in the wizard that adds one: a branch the repository lacks is created from where the checkout stands, one only on a remote is taken from there, and the line under the field says which before you save. The wizard fills in the checkout's current branch and no longer refuses a branch the repository lacks. A checkout switched by hand is shown in the settings and on the chain's card, with buttons to make its branch the main one or to put the folder back, instead of only when a task fails to start.

### Fixed

- The Forgejo plugin's `forgejo:task` skill loads again: its description is quoted, so the skill's frontmatter parses and chain sessions on Forgejo, Gitea and Codeberg projects get the skill (plugin 0.1.1). A test now parses the frontmatter of every bundled skill.

## [0.2.3] - 2026-11-07

### Fixed

- The GitLab plugin's `gitlab:task` skill loads again: its description is quoted, so the skill's frontmatter parses and chain sessions on GitLab projects get the skill (plugin 0.1.3).
- Right after a service restart a Claude chain no longer pauses on `agents --json --all timed out`. The session listing the chain waits on goes ahead of the account's other short calls and is tried again for up to five minutes.
- A cleanup after Done whose session stop timed out the same way tries the stop again and then removes the task's worktree folder, instead of warning that the session and the folder were left behind.

## [0.2.2] - 2026-11-06

### Added

- A done task's time is written to GitLab and Jira as it is to Huly. Sometimes Jira refuses the worklog for a reason that is not about a field, for example when the project does not take time. That is now read as a refusal by the project.

### Changed

- **Claude folder trust is written by Even Keel before every background session**, with the project's consent in the wizard, instead of a switch and a command to run by hand. If the write or the CLI still refuses, the pause shows one command to run, for the right CLI, account folder and user. On Windows under a service account it shows a `runas` line with a ready script.
- Checked CLI versions: Claude Code 2.1.319, codex-cli 0.167.0, OpenCode 1.19.5 and Copilot CLI 1.0.106.
- Pull request mode is no longer marked experimental.
- Setting up the Claude plugin marketplace by hand has moved to Accounts.

### Fixed

- Claude trust is written under the path the CLI checks. That is a forward-slash key on Windows and the real path of a symlinked folder or a Windows junction, so such folders no longer pause on "Workspace not trusted". The write keeps the account's `.claude.json` permissions (600 stays 600).
- Copilot: sign-in is checked in the session's own account folder, an unknown sign-in is shown as unknown, and a terminal login's token is kept apart from the accounts' own. Protection also catches a Copilot force push to the main branch written as a refspec.
- A fix session that finds nothing to fix ends with `NO CHANGES`.
- A chat reply sent to a session no longer repeats the session's instructions.
- Windows: environment variables such as `%USERPROFILE%` in a project's folder are expanded.
- Windows: uninstalling and installing over a running tray host no longer fails while the quitting host still holds its exe.
- Session account pills show the account of the session's own agent.
- New rows in settings tables are kept when switching tabs.
- Tips close when the page scrolls or the window is resized.
- The answer card's caret points at the question's first line.
- Download size estimates of the checked CLI copies are up to date.

## [0.2.1] - 2026-11-04

### Fixed

- **Windows: git or an agent CLI installed while Even Keel runs is found after Restart in the tray**, instead of only after a reboot: the tray host and the Windows service start Even Keel with the system and user `PATH` read anew.
- The setup's Git step offers the install command of the package manager the machine has (winget, brew, apt and the like) and always the download link from git-scm.com, the link alone where none is found, instead of a winget command on a Windows without winget. On Windows it says what makes Even Keel see a git installed since, by how it was started: Restart in the tray, a restart of the Windows service, or a start from a new terminal.
- Windows: the README and the guide say to run `npx even-keel` and `even-keel` from cmd, or as `npx.cmd`/`even-keel.cmd` in PowerShell, whose default policy blocks npm's `.ps1` shims; the trust warning in the project wizard and the project's settings says to run its command in cmd.
- The guide says to run `npx even-keel` from any folder but a clone of Even Keel, where npx looks for the package in the clone itself.
- A very long line in an OpenCode account log no longer stalls Even Keel for seconds while it reads the log for errors.
- The keyboard focus ring of a notification's link is drawn whole, a few pixels above its buttons, instead of a clipped line under them.
- An install from npm with a Huly profile no longer crashes on every start while the Huly client is not installed yet (Huly in `.env` at the first start, or a client folder removed): the service comes up and installs the client.

## [0.2.0] - 2026-11-03

0.2 brings two more agents (OpenCode and GitHub Copilot) and two more trackers (GitLab and Jira), an install with `npx even-keel` that updates from the page, a first-start setup wizard, and Protection and Standards to limit what sessions may do.

### Added

- **OpenCode and GitHub Copilot CLI (preview)** as chain agents, beside Claude Code and Codex. OpenCode signs in with ChatGPT, an API key or its free models; Copilot with the machine's sign-in or a token per account, and its card shows the monthly allowance. Handoffs, chat messages mid-turn, the merge check and the tracker plugins' hooks reach both.
- **Claude sessions through the Agent SDK:** "Execution" in Settings → Providers and models picks `Auto`, `CLI --bg` or `Agent SDK`. An SDK session survives a service restart with its question still open.
- **GitLab and Jira Cloud.** GitLab Issues, GitLab CI and merge requests in PR mode, on GitLab.com and self-managed servers; Jira with fix versions as milestones and `Blocks` links as the order. Both come with a plugin. A tracker's MCP server can be connected through OAuth with one button, and sessions never see the access.
- **Task feeds:** a project's chain can take tasks from several trackers or accounts. Labelled GitHub issues can be taken into your tracker as tasks; the issue gets a one-line summary when the task is done and reaches the session as information, not instructions.
- **Release branches:** several projects share one tracker project split by milestone, and a release project's fixes are carried into the main branch, with an agent to resolve a conflict.
- **Install with `npx even-keel`** as a service (on Windows at your sign-in with a tray icon, no administrator), and **Update** on the page with the release notes and **Revert**. If the new version does not come up, the old one comes back.
- A **first-start setup wizard**: language, agent and account, tracker, statistics, update checks and the first project.
- **Protection** (Settings → Sessions): deny rules for destructive actions for every agent, a switch per tracker that blocks deleting its records, and a warning about an unprotected main branch on GitHub and Forgejo.
- **Standards:** a document tied to the files it guards reaches a session when it first touches them; the merge can wait for screenshots and answers to its check.
- An Even Keel-wide **Prompt** and **Model prompts** matched by `provider | model` patterns. **My skills** turns your own skills into a package for every agent, and a project's `CLAUDE.md`/`AGENTS.md` and skills reach every agent.
- Sessions: a waiting Claude session's cache is kept warm; handoffs by context size can be turned off in favour of the agent's own compaction; `/handoff` in the chat; a Claude permission dialog comes to the page as a question; an overloaded model is retried with growing waits.
- Limits and accounts: extra usage and paid credits on account rows, and a chain session is stopped when paid usage is detected; an API key's spending cap holds the task until its date; **Replace key** for API accounts and Copilot tokens.
- Checked CLI versions for every agent, and **Check new CLI versions on this machine** tries each new release with a short live session.
- The `/status` page, a **?** legend tab on the project page, a mark for uncommitted or unmerged work, and task labels editable from Even Keel.
- Statistics count Codex turns and active time and follow-up tasks made on top of closed ones; the `tally:session-audit` skill proposes changes to your rules from them.

### Changed

- Chain sessions run on Claude Code 2.1.317, codex-cli 0.166.0, OpenCode 1.19.5 and Copilot CLI 1.0.105, the versions this release was checked against.
- The page follows one design system: settings in sections and rows with one way of inheriting values, reworked account, CI, status and stats pages, and loaders instead of text.
- Accounts appear only after **Add account**, grouped by provider. CLI copies are downloaded only when needed and with your consent, with progress in a banner.
- Chain rules are set per status and per label for Even Keel, a project and a task label; a project's milestones moved to its Tracker tab.
- A red main gives one notification per commit, only the CIs that count hold the chain, and projects of one remote share one red main.
- **New session** on a silent turn becomes available after five quiet minutes, with confirmation.
- Codex limits are read from ChatGPT every five minutes, and a plan change no longer shows as an expired token.
- The later handoff thresholds count from the compaction point.
- The npm package's dependencies went from 117 MB to about 34 MB; Huly's client is installed into the data folder once you add a Huly profile.

### Removed

- The shared **Default tracker** setting: every project has its own tracker, and older installs are migrated.

### Fixed

- Claude Ultra accounts without a five-hour limit and Team seats without an all-models week get their limits read.
- The chain no longer hangs on a postponed task after its blocker closes, and no longer puts the working session aside on a red main right after a start. A deleted Huly project no longer breaks the others of its profile.
- A process that reused a Claude session's pid is no longer taken for that session, nor stopped with it.
- Codex on Windows no longer pauses the chain with EPERM when writing a session file. Codex limits are no longer lost or wiped by themselves. Codex 0.164 recognizes an OpenAI key again, and a key without money shows as "no credit".
- Chat messages are no longer lost after a resume, on a Stop or on a mailbox hook timeout. The chat can answer a Codex session stopped by an API error, and shows `AskUserQuestion` cards and files sent with `SendUserFile`.
- A Claude session that calls a tracker's MCP tool before loading its schema is told to load it and repeat the call, instead of leaving the field out.
- **Start** after a profile change retries a pull request that could not be opened.
- The add-project wizard sees folder trust given in an account folder, expands `~` and refuses a missing or relative folder, and shows a tracker error under the right field.
- Changing the default profile no longer moves a running project to another profile. A plugin-only update no longer reinstalls the package's server.
- Two processes no longer open the state or statistics database at once. Cleanup after Done handles long paths in `git worktree remove`.
- Statistics no longer count some Codex responses twice.
- Smaller page fixes: the backlog no longer freezes the page, dragging a blocker's card no longer jumps, a chain order error shows once, and long names no longer break the layout.

### Security

- Tracker keys set in the `env` of an account's `settings.json` no longer reach chain sessions.

## [0.1.4] - 2026-10-27

### Fixed

- A chain on Codex no longer stands still for a day after a usage limit. Codex gives the reset rounded down to the minute, so a new session started right at that time was refused again, and the time it named, already past, was taken for the next day. Now a reset given without a date that has just passed counts as today. After any limit the chain waits one more minute past the reset before it starts the next session. If the next session is refused again with a reset more than a minute in the past, the chain retries 10 minutes later.

## [0.1.3] - 2026-10-26

### Fixed

- Stopping a Codex session no longer kills an unrelated program. When a turn has ended and the operating system has given its process number to a newer process, "Stop", "New session" and the cleanup after Done leave that process running; before, they ended it together with its child processes.

## [0.1.2] - 2026-10-25

### Changed

- Chain sessions run on Claude Code 2.1.310 and codex-cli 0.164.0, the versions this release was checked against.
- Tips no longer pop up when the mouse passes over them: a tip opens once the pointer rests on it for 700 ms, at once if another tip was just open, on focus or on a press. The "?" next to a setting opens and closes only on a press.
- The sessions list of a task says why a new session followed a cold cache: the limit, a fixed main branch, pull request feedback or a task that came back.

### Fixed

- Codex 0.164.0 runs the packages' hooks again. A launch whose hooks Codex does not trust now fails with a message naming the package, the CLI version and each hook, instead of a chain running silently without the merge check, reminders and chat mail.
- A Codex limit no longer wipes the spent monthly limit, so answers stay refused until it resets. The reset time is read from Codex's own refusal.
- On Codex, the checkpoint plugin's merge check now stops a merge run from code mode, and a handoff note written by a shell command is noticed when the session forgets the `CHECKPOINT:` line.
- On Codex, the Huly plugin now refuses a malformed description or comment instead of letting it reach Huly.
- A project's commands run in the environment of the task's own account. A Codex-only install without `~/.claude` no longer pauses the chain on `beforeStart`; `check` and `afterGreen` run the same way.
- A session whose turn ended on a question to you while its monitor still runs shows as waiting, not working.

## [0.1.1] - 2026-10-22

### Changed

- Chain sessions run on Claude Code 2.1.308, the version this release was checked against.
- The chat keeps a reply you have not sent yet, its text and files, for each session separately: it survives closing the chat window and reloading the page.

### Fixed

- A task postponed on an open blocker, or skipped, no longer stands above the running task on the project page, and dragging tasks after that no longer fails with "is running and stays first". The running task is drawn first even when the chain has no order of your own yet.
- A chain no longer pauses with "the active account folder … is gone" when the service has just started, for example after an update, and the next task is due in its first seconds. The chains now wait until the account folders have been read once.
- A dialog no longer closes when you select text in it and release the mouse outside, or press outside and release inside: only a click that both starts and ends on the backdrop closes it.
- The project wizard names the project that already uses a key instead of pointing at a config index. For Linear it says that in this version one team is one Even Keel project, and which project has the team.

### Security

- `markdown-it` is 14.3.3, which parses in linear time: an older one, which the Huly client pulls in, could be held up by crafted markdown. `vite`, used only to build the page and by `dev:fake`, is 8.3.5.
- An answer to a question that is a long run of digits, from a tracker comment or the page's chat, no longer holds the service up: the check for option numbers ran in exponential time on it.
- A notice whose code is an inherited member of an object, such as `constructor`, is shown as its code instead of calling that member.
- On GitHub, only comments by the repository's owner, organization members, collaborators and the token's own account reach a session: as an answer to a question, as the last comment in a changelog draft, and in PR mode as a review or a comment on a pull request. Anyone else's is skipped with a line in the service log. The project wizard warns that in a public repository without required labels anyone can put an issue into the chain.

## [0.1.0] - 2026-10-21

### Added

- **The chain.** Even Keel takes a project's open tasks from the tracker and runs one Claude Code session (`claude --bg`) at a time. When a task is done, the next one starts. The order is set by `blocks` links, then milestones (by the version in the name, then the target date), then priority and task number. Contradictions between blockers and milestones are reported as chain errors. Parent tasks never run themselves, and a task with an open blocker waits. A blocker still in the backlog shows in the chain as a locked row. If there is nothing to run, **Start** says why. When a project has no tasks left, the chain says so and has a button that opens the project in the tracker.
- Rules for which tasks enter the chain: active and terminal statuses, required labels, and excluded labels (`Manual` is always excluded). Backlog tasks stay out of the chain.
- Drag tasks to reorder the chain on the project page, within the limits of their blockers and milestones. With `fillMilestone` on, a task that enters the chain without a milestone gets the active milestone.
- Several chains of different projects can run at once (`parallel`). The other projects wait in a queue, which you can reorder or trim from the header.
- **Task worktrees.** Even Keel prepares `.claude/worktrees/<key>-<number>` on the branch `<key>-<number>/task` before the launch. After Done it stops the task's sessions, removes the worktree and the branch, and syncs the main branch with every remote. It uses the `git sync` alias if there is one, otherwise its own fetch, merge and push. A project can use a pool of permanent slots instead, for repositories with heavy ignored caches. Anything it could not clean up is listed on the project page. The main branch is a project setting (`branch`, `main` by default). A session that is only running a background command does not hold up Done, and stopping a session also ends its background commands. No session is launched while the main checkout is on a branch other than the project's.
- Some tasks need no change in the repository, such as research or an answer. Their session ends its turn with `NO CHANGES: <why>`. If the worktree has no commits beyond the main branch and nothing uncommitted, Even Keel moves the task to Done, posts the line as a comment, cleans up and goes on with the chain.
- **Handoffs.**
  - A session that hit the usage limit is resumed after the reset while its prompt cache is still warm. Otherwise it is replaced by a new session with a handoff prompt.
  - A session that ends its turn with `CHECKPOINT: <path>` is handed over to a fresh session the same way.
  - The checkpoint plugin asks for a checkpoint from 200k tokens of context, or from a threshold calibrated from the project's statistics, and stops asking below 300k after three handoffs. Its thresholds stay within 72, 85 and 95 % of the session's context window (`stats.checkpointShares`, for all projects and per project). The window size comes from the agent and is applied live.
  - The **New session** button replaces a session by hand. It shows for every open task. When **New session** or **Skip** is greyed out, a tip says why and when it becomes available.
  - If the service restarts in the middle of a handoff, an answer or a **New session**, it finishes the step after the restart.
- **Skip** and **Return to chain** for a task. A task whose session filed a blocker for it is postponed until the blocker is done. **Stop** ends a running chain, and **Stop after this task** ends it once the current task is done.
- **Unattended mode**, a switch in **Settings → Chain** for when nobody will answer. Sessions are told to ask nothing and to park a task a question holds: committed on its branch, unmerged, the question left in the task, the task moved to Backlog. When such a task is moved back to Todo, it gets a new session with a handoff that points to the answer. A session that sits 10 minutes without the task done is skipped, so one stuck session does not stop the whole run.
- **Chat with the session.**
  - The **Chat** button opens the whole transcript with a reply box. It turns amber while the session waits.
  - Questions from `AskUserQuestion` show as a card with options, free text and "Other". Files can be attached with `+`, pasted with Ctrl+V or dropped on the window, and land in the task's `.temp/inbox/`.
  - Questions are also posted to the tracker as numbered comments, and the replies are read back.
  - A message to a session that is working is delivered by a hook of the checkpoint plugin, without stopping the session.
  - The feed reads like Claude Code: tool calls are folded into groups, images the session read show as thumbnails with a viewer, and a line at the bottom shows the current turn.
  - The question badges link straight to the session that asks.
- **Task cards.** A click on a task's title opens its card: the description and comments (newest first), labels with what each means to the chain, milestone, priority and related tasks. A backlog task moves to Todo from its card, and picking another milestone moves the task in the tracker at once.
- Tasks labelled `Question` (or `Вопрос`) are marked in the chain, and their count shows on the project card and in the project's header.
- **Web page**, for desktop and phone, in dark and light themes:
  - The home page has project cards and a chart of launches by day. Cards can be grouped by remote and tracker (**No groups** by default) and are sorted into zones by state. Quiet projects shrink to a strip, and each project has its own colour (`color`).
  - The project page shows the chain as a list with status lamps, milestone sections, the closed tasks folded into an archive, and a context gauge on the current task.
  - The session panel shows the time in work, context, tokens, cache, the session's model and account, and its Remote Control link. If a session asks a question before its first reply, the panel still shows its model, taken from the launch, and the cache clock runs from the question.
  - The header shows the limits, the tracker connection and the sessions waiting for an answer.
  - Hints without buttons close as soon as the cursor leaves their icon.
- The page and the session prompts are in English or Russian, set separately (`language`, `promptLanguage`).
- **Accounts.**
  - The `/accounts` page manages several Claude subscriptions, one config folder each: add, sign in again, switch and remove. An account that a run profile names cannot be removed, and the page lists the projects that use it.
  - The shared configuration (MCP servers, folder trust, project memory) is carried over to every account folder.
  - An account can also be an Anthropic API key. It shows today's spend instead of limits, and a session whose key runs out of credit waits until the key is topped up.
  - Prompt cache lifetime setting: `cacheTtl`.
  - Even Keel calls the CLI on an account folder one call at a time and never cuts a call off while it renews the sign-in token, so accounts stay signed in across reboots; it also clears the lock files the CLI leaves behind.
- **Limits.** The 5-hour and weekly windows of every account are read with the CLI's `/usage` command. While a window is exhausted, the next task waits for its reset. The header shows rings for every account a project uses.
- **Run profiles.** The provider, model and account are set for all projects and per project. With `modelLabels` on, a task label `Provider | model` (for example `Claude | sonnet`) picks them for that task. If the label names a provider with no account, the task runs on the project's provider and the page says so. A project can add its own prompt and run its own commands before each session starts.
- **Codex (preview).** Sessions can run on the OpenAI Codex CLI (`codex exec --json` per turn):
  - The transcript, context and limits are read from Codex's own files.
  - The project's MCP servers, plugin skills and hooks are passed on every turn.
  - Accounts can be several subscriptions (at most one on the free plan) or an OpenAI API key. A session whose key runs out of quota waits until the key is topped up, as with Claude. The built-in `codex` and `global` accounts show only when their folder exists, the first account added from the page becomes the shared one, and without the Codex CLI the page says so.
  - `execution.codex: bypass` turns the Codex sandbox off, which the Windows service needs.
- **Checked CLI versions.** Chain sessions run on the Claude Code and Codex versions this release was checked on, not on whatever the installed CLI has updated itself to. Even Keel downloads them into `state/cli/` and keeps the auto-updater off for those sessions. **Settings → Models**, "CLI version", `Installed` switches a provider back to your own CLI, and a banner shows while sessions would run on an unchecked version. The checked versions are Claude Code 2.1.306 and codex-cli 0.163.0.
- **Trackers.**
  - There are adapters for Huly, GitHub Issues and Linear. Each project chooses its own tracker.
  - Even Keel puts the task's title and description into the prompt (`brief`) and closes the task when its branch is merged. Without the tracker's plugin among the project's packages, `brief` turns on by itself and the prompt carries the merge rule. A button beside **Task description in the prompt** takes you to `/tools`, where you can add the tracker's package in a couple of clicks.
  - Tracker connections are profiles on **Settings → Access**: saved only after a successful check, several per tracker, one default each. A Huly profile signs in with an e-mail and password by default. Field hints in the profile dialog explain each field, not just name its environment variable. The dialog also lists the token permissions each use needs, and the setup guide collects them in one table.
  - Claude Code plugins `huly`, `github` and `linear` come from the `even-keel` marketplace: the tracker's MCP server and a skill for working a task. The Huly plugin also shows estimate calibration from the statistics.
- **Packages.** Plugins and MCP servers are a set per project:
  - Each is installed at a pinned version and given to chain sessions by launch flags.
  - **Add a package** lists Even Keel's own plugins without a marketplace. A button on `/tools` adds the marketplace for sessions you start by hand.
  - MCP servers run behind a local gateway on 127.0.0.1.
  - The chain does not launch while a package is missing, lacks a key or does not answer. An MCP server that is still starting shows as starting.
- The `/tools` page shows what sessions get and what does not reach them, with a fix for each problem. The "trim the tools" switch starts chain sessions without claude.ai skills and plugins.
- **CI.**
  - A badge and panel show Forgejo Actions and GitHub Actions runs, with their jobs, steps and tasks.
  - After a push to the main branch, the next task waits for the CI's verdict.
  - A red main branch is fixed first: by a fix session without a tracker task (the interrupted session continues afterwards), or by a high-priority fix task (`ci.fixTask`). A finished fix stays in the chain's archive.
  - Projects without CI can name check commands that run before a merge and again on the main branch.
  - `commands.afterGreen` runs commands after the main branch goes green.
  - CI tokens come from tracker profiles and Forgejo profiles. Each project picks the GitHub or Forgejo profile of its remote, for CI and pull requests.
- **Pull request mode** (`pullRequests`). A session does not merge its branch: Even Keel pushes it, opens a pull request on GitHub or Forgejo and takes the next task, and a person merges.
  - Reviews, comments, failed runs and conflicts on the pull request go back to the task's session.
  - A branch with nothing to merge opens no empty pull request, and the page says why.
  - When a pull request is closed without a merge, the task's next run gets the pull request's link and comments.
  - A pull request button sits in the task panel and the chat window, and **Refresh** polls pull requests too.
  - The switch is unavailable until the project has a remote and a profile for it. An **Add profile** button sits beside the switch and in the pause banner. A remote on neither GitHub nor Forgejo is shown as an unsupported host instead of a request for a Forgejo profile.
  - Without a remote and a profile to open pull requests with, the chain pauses before the launch and goes on by itself once one is added or the mode is turned off.
- **Statistics (Tally).**
  - Statistics are optional: the page asks at the first start, and a switch in the settings (`tally`) turns them off or points them at the embedded database or your own Postgres.
  - A built-in collector reads session transcripts, Claude Code and Codex, into an embedded Postgres (PGlite) every five minutes. An external Postgres is optional. Codex models are priced too.
  - The `/stats` page shows spend by day and project, cost and time per task, a breakdown by model and entry point, stuck sessions, durations of long commands, estimates against actual time, the share of weekly limits, and before/after comparisons of changes to rule files.
  - The project page has a 30-day strip.
  - Optional extras: a hook that asks sessions to log why a rule changed, the agent's active time written back to Huly as a time report, and `tally/bin/sql.mjs` for read-only queries.
- **Settings on the page.**
  - `/settings` and each project's settings are split into tabs, with save and revert per group and "was: …" markers. A file edited under an open form is no longer overwritten. **Prompt cache lifetime** is in the Claude Code group, and the introduction to a project's settings is in a hint.
  - CI, `promptLanguage`, `checkpointTokens`, `cacheTtl` and `fillMilestone` can be set for all projects and per project.
  - Settings and `.env` apply live, without a restart.
  - The add-project wizard checks the repository, the branch, the tracker and Claude Code's trust in the folder. For a folder that is not trusted yet, it gives a ready command to run in a terminal and checks again when you come back to the page.
  - A project is removed from its settings.
- **Storage.**
  - The chain state, settings and projects are in an embedded database in `state/even-keel/`.
  - An existing `even-keel.config.json` is imported once on the first start.
  - `npm run storage -- backup|export|config-export|config-import`.
  - The schemas are versioned and migrate on update. A database newer than the code shows a page with the reason instead of starting.
- Runs as a service: the Windows service (`service/install.ps1`), a `systemd --user` unit on Linux and a launchd agent on macOS (`service/install.sh`).
- The page shows Even Keel's version and announces a new GitHub release with a toast.
- **Changelog drafts.** A button on a milestone's head has the agent draft the milestone's changelog section from its done tasks.
  - The draft starts from the milestone's section in the repository's changelog file (the project setting `changelog`, `CHANGELOG.md` by default), so hand edits are kept.
  - **Add N** works in only the tasks closed since the last version, an edit can be asked for in words, and the changes against the previous version are highlighted.
  - **Write** puts the section into the file and commits only that file to the main branch. A released section (one with a tag) stays frozen, and new tasks go into the next one.
  - The milestone's head counts the tasks done since the section was written, and the drafts survive a restart.
  - Each version shows what its turn cost, on which account and model, and the milestone's total.

### Security

- The page listens on `127.0.0.1` by default and checks `Host` and `Origin` on every request. Listening on another address requires `EVEN_KEEL_TOKEN`; extra names go in `allowedHosts`.
- Tracker, CI and package keys never reach the sessions' environment. MCP servers get them through the local gateway, and the page never shows a saved token or password again.
