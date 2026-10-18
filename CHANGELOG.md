# Changelog

All notable changes to Even Keel are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The chain.** Even Keel takes a project's open tasks from the tracker and runs one Claude Code session (`claude --bg`) at a time. When a task is done, the next one starts. The order is set by `blocks` links, then milestones (by the version in the name, then the target date), then priority and task number. Contradictions between blockers and milestones are reported as chain errors. Parent tasks never run themselves, and a task with an open blocker waits. A blocker still in the backlog shows in the chain as a locked row. If there is nothing to run, **Start** says why.
- Rules for which tasks enter the chain: active and terminal statuses, required labels, and excluded labels (`Manual` by default). Backlog tasks stay out of the chain.
- Drag tasks to reorder the chain on the project page, within the limits of their blockers and milestones. With `fillMilestone` on, a task that enters the chain without a milestone gets the active milestone.
- Several chains of different projects can run at once (`parallel`). The other projects wait in a queue, which you can reorder or trim from the header.
- **Task worktrees.** Even Keel prepares `.claude/worktrees/<key>-<number>` on the branch `<key>-<number>/task` before the launch. After Done it stops the task's sessions, removes the worktree and the branch, and syncs the main branch with every remote. It uses the `git sync` alias if there is one, otherwise its own fetch, merge and push. A project can use a pool of permanent slots instead, for repositories with heavy ignored caches. Anything it could not clean up is listed on the project page. The main branch is a project setting (`branch`, `main` by default).
- **Handoffs.**
  - A session that hit the usage limit is resumed after the reset while its prompt cache is still warm. Otherwise it is replaced by a new session with a handoff prompt.
  - A session that ends its turn with `CHECKPOINT: <path>` is handed over to a fresh session the same way.
  - The checkpoint plugin asks for a checkpoint from 200k tokens of context, or from a threshold calibrated from the project's statistics, and stops asking below 300k after three handoffs.
  - The **New session** button replaces a session by hand.
- **Skip** and **Return to chain** for a task. A task whose session filed a blocker for it is postponed until the blocker is done. **Stop** ends a running chain.
- **Unattended mode**, a switch in **Settings → Chain** for when nobody will answer. Sessions are told to ask nothing and to park a task a question holds: committed on its branch, unmerged, the question left in the task, the task moved to Backlog. A session that sits 10 minutes without the task done is skipped, so one stuck session does not stop the whole run.
- **Chat with the session.**
  - The **Chat** button opens the whole transcript with a reply box. It turns amber while the session waits.
  - Questions from `AskUserQuestion` show as a card with options, free text and "Other". Files can be attached with `+`, pasted with Ctrl+V or dropped on the window, and land in the task's `.temp/inbox/`.
  - Questions are also posted to the tracker as numbered comments, and the replies are read back.
  - A message to a session that is working is delivered by a hook of the checkpoint plugin, without stopping the session.
  - The feed reads like Claude Code: tool calls are folded into groups, images the session read show as thumbnails with a viewer, and a line at the bottom shows the current turn.
  - The question badges link straight to the session that asks.
- **Task cards.** A click on a task's title opens its card: the description and comments, labels with what each means to the chain, milestone, priority and related tasks. A backlog task moves to Todo from its card, and picking another milestone moves the task in the tracker at once.
- Tasks labelled `Question` (or `Вопрос`) are marked in the chain, and their count shows on the project card and in the project's header.
- **Web page**, for desktop and phone, in dark and light themes:
  - The home page has project cards and a chart of launches by day.
  - The project page shows the chain as a list with status lamps, milestone sections, the closed tasks folded into an archive, and a context gauge on the current task.
  - The session panel shows the time in work, context, tokens, cache, the session's account and its Remote Control link.
  - The header shows the limits, the tracker connection and the sessions waiting for an answer.
- The page and the session prompts are in English or Russian, set separately (`language`, `promptLanguage`).
- **Accounts.**
  - The `/accounts` page manages several Claude subscriptions, one config folder each: add, sign in again, switch and remove.
  - The shared configuration (MCP servers, folder trust, project memory) is carried over to every account folder.
  - An account can also be an Anthropic API key. It shows today's spend instead of limits, and a session whose key runs out of credit waits until the key is topped up.
  - Prompt cache lifetime setting: `cacheTtl`.
- **Limits.** The 5-hour and weekly windows of every account are read with the CLI's `/usage` command. While a window is exhausted, the next task waits for its reset. The header shows rings for every account a project uses.
- **Run profiles.** The provider, model and account are set for all projects and per project. With `modelLabels` on, a task label `Provider | model` (for example `Claude | sonnet`) picks them for that task. A project can add its own prompt and run its own commands before each session starts.
- **Codex (preview).** Sessions can run on the OpenAI Codex CLI (`codex exec --json` per turn):
  - The transcript, context and limits are read from Codex's own files.
  - The project's MCP servers, plugin skills and hooks are passed on every turn.
  - Accounts can be several subscriptions (at most one on the free plan) or an OpenAI API key.
  - `execution.codex: bypass` turns the Codex sandbox off, which the Windows service needs.
- **Trackers.**
  - There are adapters for Huly, GitHub Issues and Linear. Each project chooses its own tracker.
  - Even Keel puts the task's title and description into the prompt (`brief`) and closes the task when its branch is merged.
  - Tracker connections are profiles on **Settings → Access**: saved only after a successful check, several per tracker, one default each.
  - Claude Code plugins `huly`, `github` and `linear` come from the `even-keel` marketplace: the tracker's MCP server and a skill for working a task. The Huly plugin also shows estimate calibration from the statistics.
- **Packages.** Plugins and MCP servers are a set per project:
  - Each is installed at a pinned version and given to chain sessions by launch flags.
  - MCP servers run behind a local gateway on 127.0.0.1.
  - The chain does not launch while a package is missing, lacks a key or does not answer.
- The `/tools` page shows what sessions get and what does not reach them, with a fix for each problem. The "trim the tools" switch starts chain sessions without claude.ai skills and plugins.
- **CI.**
  - A badge and panel show Forgejo Actions and GitHub Actions runs, with their jobs, steps and tasks.
  - After a push to the main branch, the next task waits for the CI's verdict.
  - A red main branch is fixed first: by a fix session without a tracker task (the interrupted session continues afterwards), or by a high-priority fix task (`ci.fixTask`). A finished fix stays in the chain's archive.
  - Projects without CI can name check commands that run before a merge and again on the main branch.
  - `commands.afterGreen` runs commands after the main branch goes green.
  - CI tokens come from tracker profiles and Forgejo profiles.
- **Statistics (Tally).**
  - A built-in collector reads session transcripts, Claude Code and Codex, into an embedded Postgres (PGlite) every five minutes. An external Postgres is optional.
  - The `/stats` page shows spend by day and project, cost and time per task, a breakdown by model and entry point, stuck sessions, durations of long commands, estimates against actual time, the share of weekly limits, and before/after comparisons of changes to rule files.
  - The project page has a 30-day strip.
  - Optional extras: a hook that asks sessions to log why a rule changed, the agent's active time written back to Huly as a time report, and `tally/bin/sql.mjs` for read-only queries.
- **Settings on the page.**
  - `/settings` and each project's settings are split into tabs, with save and revert per group and "was: …" markers. A file edited under an open form is no longer overwritten.
  - Settings and `.env` apply live, without a restart.
  - The add-project wizard checks the repository, the branch, the tracker and Claude Code's trust in the folder.
  - A project is removed from its settings.
- **Storage.**
  - The chain state, settings and projects are in an embedded database in `state/even-keel/`.
  - An existing `even-keel.config.json` is imported once on the first start.
  - `npm run storage -- backup|export|config-export|config-import`.
  - The schemas are versioned and migrate on update. A database newer than the code shows a page with the reason instead of starting.
- Runs as a service: the Windows service (`service/install.ps1`), a `systemd --user` unit on Linux and a launchd agent on macOS (`service/install.sh`).
- The page shows Even Keel's version and announces a new GitHub release with a toast.
- **Changelog drafts.** A button on a milestone's head has the agent draft the milestone's changelog section from its done tasks.

### Security

- The page listens on `127.0.0.1` by default and checks `Host` and `Origin` on every request. Listening on another address requires `EVEN_KEEL_TOKEN`; extra names go in `allowedHosts`.
- Tracker, CI and package keys never reach the sessions' environment. MCP servers get them through the local gateway, and the page never shows a saved token or password again.
