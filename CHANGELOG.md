# Changelog

All notable changes to Even Keel are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **OpenCode (preview)** as a chain agent. It signs in with ChatGPT, an API key or its free models. Each turn is one `opencode run`, and the transcript and context fill are read from OpenCode's own database. Through an OpenCode plugin of its own, the checkpoint plugin hands a full context over to a fresh session, delivers chat messages mid-turn and checks before a merge. The Huly plugin's hooks reach it too. A turn that writes nothing for 30 minutes is taken for hung. Pictures the model reads show in the chat. A model the account does not offer, including ChatGPT models outside the plan, is refused before the launch. OpenCode on GitHub Copilot is shown but cannot run sessions.
- **GitHub Copilot CLI (preview)** as a chain agent, on the machine's sign-in or a token per account. Each turn is one `copilot -p`. The card shows the monthly allowance, read with the sign-in's own token. A model Copilot refuses shows its reason and a button to the session settings.
- **Claude sessions through the Agent SDK.** "Execution" in Settings → Providers and models offers `Auto`, `CLI --bg` or `Agent SDK`; `Auto` runs API keys through the SDK and subscriptions on `--bg`. An SDK session outlives a restart of the service with its question still open. Chat messages and answers go straight into the running session. Limits refresh from each response. Choosing `Agent SDK` sets the CLI version to Checked.
- **GitLab:** GitLab Issues as a tracker, GitLab CI, and merge requests in PR mode, on GitLab.com and self-managed servers, with the `gitlab` plugin. Uploaded pictures and files show on the task card and reach the session.
- **Jira Cloud** as a tracker, with the `jira` plugin. Fix versions are its milestones and `Blocks` links set the order. Statuses go by category, also on localized sites. Pictures and attachments show on the task card. If a transition to Done is refused, the page says so.
- Tracker profiles can connect a tracker's MCP server through OAuth with one button. Even Keel keeps and refreshes the access, and sessions never see it. The Jira profile can use a separate Atlassian MCP token instead.
- **Task feeds.** A project's chain can take tasks from more than one tracker or account, for example a private Huly project plus the GitHub issues others file.
- **GitHub issues taken into your tracker.** Labelled issues become tasks with a link back. When the task is done, the issue gets a one-line summary and is closed at the release. In PR mode, a pull request for a GitHub issue ends with `Closes owner/repo#N`; on GitLab, a merge request ends with `Closes #N`.
- **Release branches.** Several Even Keel projects can share one tracker project and split its tasks by milestone; the "Add a project" wizard sets this up. A release project is carried forward into the main project's branch whenever the main chain stands. A carry conflict goes to an agent with **Resolve with the agent**, or automatically with **Resolve a conflict with the agent by itself**.
- **Install with `npx even-keel`:** it installs Even Keel globally and sets it up as a service. On Windows it starts at your sign-in with a tray icon and needs no administrator. A newer version of the package is the update.
- **Updating from the page:** release notes since your version and **Update**. If the new version does not come up, the old one comes back. **Revert** returns to the previous version.
- A first-start setup wizard covering language, agent and account, tracker, statistics, update checks and the first project.
- **Protection** (Settings → Sessions). Deny rules for destructive actions go to Claude Code, Codex, Copilot and OpenCode, for all projects or per project. A switch per tracker blocks deleting its records. The page shows the agents' own deny files and Codex rules. It also warns about missing or bypassable protection of the main branch on GitHub and Forgejo.
- **Standards.** A project ties a document to the files it guards. A session gets the document when it first touches those files. Optionally, the merge waits for screenshots and answers to the document's check.
- An Even Keel-wide **Prompt** for every project and agent, and **Model prompts** matched by `provider | model` patterns with `*`. Each row shows the models that match it.
- The model field suggests the models the account offers, and a model is checked before the launch.
- **Add a package → My skills** turns your own skills into one package, so every agent gets them. A project's `CLAUDE.md`/`AGENTS.md` and skills reach every agent. A project's Sessions settings show what a session will get.
- **Keep the cache of a waiting session warm:** Even Keel pings a copy of a waiting Claude session before its prompt cache expires. The warm-cache window is now per agent: 30 minutes for Codex and Copilot.
- **Handoffs by context size** can be turned off, leaving long sessions to the agent's own compaction. An auto-compact window for chain sessions can be set for all projects and per project. A task label picks a handoff or compaction for that task.
- A **Prompt cache lifetime** for Codex sessions.
- The `/handoff` command in the session chat, with a command menu on `/`.
- A Claude session's permission dialog comes to the page as a question with "Allow" and "Deny". In unattended mode the call is refused at once.
- A temporary model error ("at capacity", "overloaded") is retried after 15 minutes, doubling the wait up to four hours, and the cache is kept warm meanwhile.
- A mark for work that is not committed or not merged: a chip on the task's row, a dot on the **Backlog** tab and a callout on its card. A closed task whose folder was left behind stays in the chain instead of going to the archive.
- Labels can be added to or removed from a task in the tracker from Even Keel; a missing label is created.
- **Replace key** for an API account and a Copilot token. The account keeps its name, roles and history.
- **Extra usage** on account rows: credits and paid usage for Claude, Codex, Copilot and OpenCode Zen, plus an **on credits** chip. A chain session is stopped when paid subscription usage is detected, and the chain waits for the limit to reset.
- Accounts without a known limit show the tokens they used and their last refusal. After a refusal, OpenCode's free models are tried again with growing waits.
- An API key's spending cap holds the task until the date in the error, and the key is checked every five minutes; this also covers OpenCode on an Anthropic key.
- Checked CLI versions for OpenCode and Copilot. **Check new CLI versions on this machine** tries each new CLI release with a short live session and reports the result in a banner.
- The `/status` page: an overview of the service, limits, settings, statistics and every tracker account in use.
- A **?** tab on the project page with a legend of every mark and sign, grouped by where it appears.
- Codex shows the pictures it opens with `view_image` in the chat.
- Commands on the page appear as code blocks with a copy button. OpenCode and Codex sign-ins show the one-time code separately with **Copy**.
- The `tally:session-audit` skill reads the statistics and proposes changes to your rules.
- Statistics count Codex turns and active time, and price DeepSeek V4.1 Flash. They also show the status of GitHub and Linear tasks, and follow-up tasks made on top of closed ones.

### Changed

- The page follows one design system: settings in sections and rows with one way of inheriting values, toggles and hints in tips. The account, CI, status and stats pages are reworked, and folds animate.
- Accounts appear only after you add them with **Add account**. The add dialog opens over the current page and keeps what you entered. Accounts are grouped by provider, one row each, with readable names.
- The way Claude sessions run is the shared "Execution" setting instead of a button on each account card; earlier per-account choices are carried over.
- The header's account chip shows the account of the current task and, on hover, up to three levels: task, project and Even Keel.
- Chain rules are set per status and per label on all three levels; which milestones a project takes moved to its Tracker tab.
- A project's Tracker settings use the same fields and hints as the add-project wizard. The wizard shows its steps as cards with their state and ends with a summary.
- A task's row shows the current action and context as one block, with the title on the whole first line and a counter of context resets that includes compactions.
- Errors above the chain stay open; warnings fold into one row. Limit banners name the account and what to change, and group together.
- Messages on the page use the page's own words and say what to do, with a button where the page has one.
- **Check and save** is one button wherever saving needed a check first.
- Codex limits are read from ChatGPT every five minutes, not only from Codex's session files. A ChatGPT plan change no longer shows as an expired token: Codex's sign-in is renewed without a model turn.
- The later handoff thresholds now count from the compaction point instead of from shares of the window, and the first threshold is capped the same way.
- In the chat, Enter sends and Shift+Enter starts a new line.
- A red main gives one notification per commit, naming the failed CI. Only the CIs that count, and only runs of the project's branch, hold the chain.
- Projects of one remote on one machine share a red main and one CI watch, so one break gets one fix.
- A branch sync after Done is retried after a network error before it turns into a warning.
- **New session** on a silent turn says when it becomes available, and after five quiet minutes the turn can be interrupted with confirmation. "No new output since …" no longer shows from the first second.
- Run labels show the model without the router prefix; the full name is in the tip.
- CLI copies are downloaded only when needed and with your consent, with progress in banners. The CLI version banner is one foldable row.
- `/usage` is no longer polled for a folder without a sign-in.
- The statistics group OpenAI models by tier (Sol, Luna, Astra, Terra). The `/stats` page has a new section order, with "What changed" folded and a model choice for each side of a comparison.
- Projects are identified by their id, so two projects of one key are told apart by name everywhere.
- The service log records when a session hits a usage limit and when the chain continues. Tracker timeouts are logged with the call, its duration and the number of requests. The same tracker error is no longer logged every 5 seconds.

### Removed

- The shared **Default tracker** setting: every project has its own tracker, and older installs are migrated.

### Fixed

- Two processes no longer open the state database or the local statistics database at the same time.
- A Huly project that no longer exists no longer breaks reading the other projects of the same profile.
- A chain no longer hangs on a postponed task after its blocker closes.
- A red main right after a start no longer puts the working session aside before the first poll.
- OpenCode and Copilot sessions continue after a main fix without needing an e-mail address.
- The chain no longer pauses with EPERM when writing a Codex session file on Windows, and no longer loses a turn that had already started.
- A Codex turn on Windows no longer always looks silent.
- A process that reused a session's pid is no longer taken for a live Codex, Copilot, OpenCode or Claude session.
- A Codex limit is no longer lost when an interrupted command finishes after the end of the turn. A command cut off by the end of a turn shows where it started and is not marked "failed".
- Codex limits no longer disappear by themselves.
- Codex 0.164 recognizes an OpenAI key again. A Codex or OpenCode key without money shows as "no credit", not as a limit or an unknown reset. OpenCode on an Anthropic key now holds its spending cap.
- A refused second free Codex account no longer reads as "account added".
- Chat messages are no longer lost:
  - when sent right after a resume (the message also no longer stops the working session);
  - when sent on a Stop (the end-of-turn mark survives, and Codex shows the bubble);
  - when the turn ends while the chain waits to stop after it;
  - when the mailbox hook times out.
- The chat can answer a Codex, OpenCode or Copilot session stopped by an API error.
- Copilot sessions receive the hooks' additional context again, including the mail, context reminders and standards.
- The chat shows a non-empty `AskUserQuestion` card and files sent with `SendUserFile`.
- PR mode on GitLab no longer reports a false conflict right after a push.
- A session's own note on its merge request is no longer taken as feedback.
- GitLab under a path prefix uses the right profile for CI and merge requests.
- GitLab.com reads no longer time out and flood the log.
- The `gitlab` package can read issues on GitLab CE.
- Jira:
  - Markdown converted from Jira text keeps `<…>` and no longer gains stray formatting;
  - creating a task on a localized site no longer makes an epic;
  - the `jira:task` skill works with Rovo MCP v2.
- The OAuth MCP connection takes the authorization server from the resource's metadata. Its callback works on direct network access, and a failure reason reaches the log.
- **Start** after a profile change retries a pull request that could not be opened. The refusal text for an unready PR mode no longer promises that the chain will go on by itself.
- Release carries:
  - "Merges into" offers only projects of the same repository;
  - a failed merge without a conflict shows git's message;
  - a carry session no longer raises "main is red";
  - "push failed" clears once main is pushed;
  - messages no longer start with `forward:`;
  - no conflict notification is sent while an agent is already resolving it.
- Cleanup after Done handles long paths in `git worktree remove` and no longer blames a process.
- The add-project wizard:
  - sees folder trust given in an account folder;
  - checks the folder;
  - shows a tracker error under the right field;
  - can add a second project on the same tracker project;
  - no longer widens on long profile names.
- A chain paused on an untrusted folder offers the same hint and button as the wizard.
- MCP keys left blank in a project's profile come from the default profile. Package settings nobody changed follow a new default after an update. A plugin-only update no longer reinstalls the package's server.
- Changing the default profile no longer moves a running project to another profile.
- "Give the active milestone to tasks without one" shows the milestone at once, both in the preview and after reading the tracker.
- A chain order error shows once, not twice.
- The empty chain's "Open in …" button also covers task feeds.
- Dragging an external blocker's card no longer jumps.
- Tasks coming from the backlog no longer freeze the page.
- The uncommitted-work chip no longer shows on a task whose session is working.
- The queue button shows the project's name instead of its GUID. A long project name no longer covers the queue.
- Narrow settings no longer break labels mid-word, and the project settings card no longer slides off screen under banners.
- The account row menu opens where you clicked.
- The sign-in dialog no longer highlights its steps by itself. Choosing Copilot in the add-account dialog no longer loses the dialog. The download banner is no longer too wide and no longer flickers when the download ends.
- The unchecked-CLI banner no longer shows when "CLI version" is Checked.
- The "Problems" block on `/tools` shows settings of disabled packages and accounts without projects.
- Project colours on `/stats` are no longer grey. The stats strip on the project page shows its loading and keeps one height.
- Statistics:
  - see the global `~/.claude` and `~/.codex` folders again without reloading their history;
  - no longer record false deletions of rules;
  - count an edit of a skill or memory through its store path as a rule change;
  - leave code-block lines out of handoff titles.
- A changelog draft with no entries no longer shows as "the agent did not write the draft".
- The service log no longer has an empty `claude daemon status` error after each start, or GitHub Actions 404s.
- Hints that were outdated, wrong or shared between different fields are fixed, and Protection's fields each have their own hint.

### Security

- Tracker keys set in the `env` of an account's `settings.json` no longer reach chain sessions.
- Protection rules no longer leak through:
  - Copilot rules use Copilot's own syntax;
  - Codex rules cover more spellings of the main branch refspec and of `rm` targets;
  - OpenCode's build agent permissions no longer override the denies.
- A GitHub issue taken into the tracker reaches the session as information, not instructions; only collaborators' comments go in as they are, and the issue gets only a one-line summary in public.

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
