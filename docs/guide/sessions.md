# Sessions

A session is one run of an agent on one task, in the task's own folder. This page covers what a session runs on, the instructions it gets, how a long or interrupted session is handed over to a fresh one, and what Even Keel does — and does not do — with a session that has stopped.

- [What a session runs on](#what-a-session-runs-on)
- [Prompts](#prompts)
- [The project's instructions and skills](#the-projects-instructions-and-skills)
- [Standards](#standards)
- [Handoffs](#handoffs)
- [A turn that writes nothing](#a-turn-that-writes-nothing)
- [Hands off a stopped session](#hands-off-a-stopped-session)
- [Keeping a waiting session warm](#keeping-a-waiting-session-warm)
- [Lean sessions](#lean-sessions)

## What a session runs on

What a session runs on — the provider, its model and its account — is set in the config, shared and per project; Claude sessions run on Opus by default, whatever `/model` last saved in the CLI settings.

The model field takes any name and suggests the ones the row's account offers: OpenCode's own list, the models of the Codex account, Claude's aliases. Switching a row to an OpenCode account whose list lacks the model clears the model field back to the inherited value, so a pair that cannot run is not saved.

One task can run on something else: its run — a provider, a model and an effort — is set on the task's card and kept by Even Keel, not by the tracker. A run on a provider with no account set runs the task on the project's provider and says so in a toast.

### A task's own run

On the task card, **Runs on** has a provider pick, a model field and an effort pick. "As the project" leaves the provider to the project; a provider with an empty model takes the model set for that provider.

The effort is Claude Code's `low`, `medium`, `high`, `xhigh` or `max` and Codex's `minimal`, `low`, `medium`, `high` or `xhigh`; OpenCode and Copilot offer `none`, `minimal`, `low`, `medium`, `high`, `xhigh` and `max`, but each model takes only some of them (in OpenCode, the model's variants), so pick one your model has.

"Default" passes none and the CLI decides. An effort set without a provider goes to whatever the task runs on, when that provider has such a level.

For a task with a session at work the card says that the change takes effect from its next session. A session that files tasks through the tasks server can set the run too.

A task's run on a chain row shows the provider, only the model name after the last `/` and then the effort: `opencode/deepseek-v4.1-flash-free` on OpenCode appears as `OpenCode | deepseek-v4.1-flash-free`, a Claude task on Sonnet with high effort as `Claude | sonnet · high`.

Hover for the full text. If space is tight, only the model is shortened with an ellipsis.

The session panel's Model fact shows the model the same way, `OpenCode · minimax-m3.1-flash` for `openrouter/minimax/minimax-m3.1-flash`; its tip has the full name.

Tracker labels `<Provider> | <model>` are no longer read. When Even Keel is updated from a version that read them, the run label of each open task moves into its run once, in the projects that had run labels on; the labels stay in the tracker as plain labels and can be taken off by hand.

## Prompts

Instructions for every session go into the **Prompt** of **Settings** → **Providers and models**, whatever project and agent it runs: Claude Code, Codex, OpenCode and Copilot each read their own global rules file, and Even Keel does not copy one into another.

A project's own **Prompt** comes after it and adds to it rather than replaces it. Both are off until you write something, are passed as written (Markdown is fine) and go into every new session — the first start and every handoff; a resumed session already has them.

### Model prompts

**Model prompts**, in the same settings tab, add instructions for sessions matching a provider and model: `Claude | sonnet*` covers Claude's Sonnet aliases, `* | *sonnet*` also covers full Sonnet ids through other agents.

Only `*` is special (any string); case is ignored, and spaces around `|` are trimmed. A bare `Codex` covers every Codex session, including the CLI's default; an explicit model pattern needs a known model.

Every matching row adds its prompt in table order to each new session, including a handoff or **New session**. Chat replies and automatic resumes continue the same conversation without adding these instructions again, even if the model has changed.

The field suggests names from the accounts' model catalogues, and each row lists its matches by provider: the first eight, with a toggle for the rest, or only their count when the pattern takes every model of the provider (`OpenCode | *`, a bare `OpenCode`).

Claude and Codex lists are incomplete: a manually entered id may match too. No known matches is a warning and still allows saving.

Older model-only keys are upgraded automatically, preserving their exact model match for every provider.

## The project's instructions and skills

A project written for one agent keeps its rules when its tasks move to another. A lone instruction file reaches every agent: Even Keel tells Codex to read a `CLAUDE.md`, which it does not read by itself, while Claude Code reads a lone `AGENTS.md` by itself — unless a folder above the checkout holds a `CLAUDE.md` (`~/.claude/CLAUDE.md` included), and then Even Keel gives it the file. With both files, each agent reads its own one, and Copilot reads both:

| Agent | Only `CLAUDE.md` | Only `AGENTS.md` | Both | Skill folders |
| --- | --- | --- | --- | --- |
| Claude Code | `CLAUDE.md` | `AGENTS.md` | `CLAUDE.md` | `.claude/skills` |
| Codex | `CLAUDE.md`, given by Even Keel | `AGENTS.md` | `AGENTS.md` | `.agents/skills`, `.codex/skills` |
| OpenCode | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` | `.opencode/skills`, and `.claude/skills`, `.agents/skills` given by Even Keel |
| Copilot | `CLAUDE.md` | `AGENTS.md` | both | `.github/skills`, `.agents/skills`, `.claude/skills` |

To keep one set of rules for every agent, write them in `AGENTS.md` and make `CLAUDE.md` the single line `@AGENTS.md`: Claude Code reads the file it names, the others read `AGENTS.md`. Codex has no way to skills in `.claude/skills`; keep the ones it should see in `.agents/skills`, which Claude Code in turn does not read. Only what is committed on the main branch reaches a session.

**Settings** → **Sessions** of a project shows what a session of its agent gets: the instruction file, the shared and the project's prompt, the project's skills (and the ones the agent misses because of their folder), and the skills of the project's packages. When none of it is there, it says the project has no rules. The same table is under it.

## Standards

A rule that matters only for some files — how the screens look, how the API is written — need not sit in every session's instructions. Make it a standard: **Settings** → **Sessions** → **Standards** of a project ties a document of the repository to the files it guards, as masks from the repository's root (`**/*.tsx, web/**/*.css`), with exceptions (`**/*.test.*`).

The document is picked from the Markdown files on the project's main branch; one that is not committed there is flagged, since sessions would not get it.

**Add "Interface"** fills in the files a screen is made of — `.tsx`, `.jsx`, `.vue`, `.svelte`, `.css`, `.scss`, `.html`, tests excepted.

A session gets the document the first time it reads a guarded file. If it goes to edit one before that, the edit is refused once with the document, and the next one goes through. After a compaction of the context the document comes again.

With **Shots and answers before the merge** on, a task branch that changed the standard's files is not merged (in pull request mode, not handed to its pull request) until `.temp/shot/` holds screenshots taken after the last change and `.temp/<document>-check.md`, written after them, answers each question of the document's section "The check" — a list of questions under a heading of that name. The session is told what is missing and goes on.

Standards come with the [agent-bridge](../../plugins/agent-bridge) plugin and reach Claude Code, Codex, Copilot and OpenCode sessions; on OpenCode the pull request is not held back. A project has none until you add them.

## Handoffs

A handoff replaces a session with a fresh one in the same folder: the old session leaves a note, and the new one starts from it. It happens on a usage limit, on a full context and when you ask for it.

### On a usage limit

A session that hit the usage limit is resumed a minute after the reset if its prompt cache is still warm, otherwise stopped and replaced by a new session in the same worktree with a handoff prompt.

The service log records the task, account folder, reset time (or that it is unknown) and planned continuation once per limit, any update to the reset, and the successful resume or handoff with its session id.

The session panel groups the limit messages together, newest first, with earlier messages folded below. It names the affected account and provider and shows the reset in local time.

Its settings button opens **Project settings → Sessions**: change that provider's account in the shared or own pool, or change the provider on the task's card.

A task on a different provider from the active one does not change accounts when you switch the header's account.

OpenCode and Copilot accounts on the machine's sign-in can continue without an e-mail address.

Continuing the same session requires the same account folder and a warm cache; a changed folder starts a new session with a handoff.

An account that is signed out waits until it is ready again.

### On a full context, or when you ask

The same handoff happens when a session ends its turn with a `CHECKPOINT: <path to a note>` line — the [agent-bridge](../../plugins/agent-bridge) plugin asks for it once the context grows past a threshold, 200k tokens until the project's own statistics give a better one, and stops asking below 300k after three handoffs of a task — and when you press **New session** on the page.

To leave a long session to the agent's own compaction instead, turn off **Handoffs by context size** in **Settings** → **Sessions**, for every project or in one project's settings: the plugin then never asks for a note because of the context, while the handoffs on a usage limit, **New session** and a note the session writes by itself work as before.

If the session writes `.temp/handoff.md` near the end of its turn but forgets the line, the plugin asks it to add it.

This also covers Codex writing the note through a shell command with a literal file path. A path built in a variable or a write hidden inside another script still needs the session to add the line itself.

In a project without git, whose tasks share one folder, each task's note is its own `.temp/handoff-<task>.md`.

## A turn that writes nothing

While a working turn writes nothing, the session card and **New session** tooltip show its last write and the times when replacement becomes available.

After five quiet minutes you can interrupt it with confirmation.

After thirty quiet minutes it is treated as hung: the session waits and **New session** needs no confirmation; a chat reply stops that hung turn before continuing, too.

This applies to Claude Code (both transports), Codex, OpenCode and Copilot.

New output resets the timer and invalidates an open confirmation. Streaming output counts even while Windows leaves a transcript's modification time unchanged.

Nothing stops a silent turn automatically. A session waiting for an answer is not a silent working turn; Claude's background commands keep their separate one-hour check.

A Claude session whose turn has ended while a command it started in the background still runs says so instead of "working": the card's line and the chat's turn line read "Waiting for its background command" with the command, and the drawer's status, **waiting on background**, has a tooltip with the command and the time it will be taken for hung, an hour after the transcript's last line.

## Hands off a stopped session

A session that asks a question or has a permanent failure is left alone: you answer it or move the task in the tracker yourself.

A temporary model overload is retried automatically in the same session after 15 minutes, doubling up to four hours while it keeps failing and starting over after a successful answer. The page shows “waiting to retry” and the next attempt time. A chat answer or **New session** cancels that attempt; pausing the chain holds automatic retries.

The provider variants and recovery through a real outage are [not yet verified](../unverified/sessions.md#temporary-model-errors-btn-498).

You can skip a task, and a session that files a blocker for its task gets the task postponed until the blocker is done.

When the blocker closes, or you undo Skip, a resting session is replaced with a new one carrying its handoff; the prompt names the closed blockers. A session working again, waiting on its own question, or given a message since the release is adopted and left to continue.

## Keeping a waiting session warm

Off by default. A Claude Code session that waits for your reply keeps its prompt cache for an hour on a subscription, five minutes on an API key, a Codex session for half an hour; an answer after that pays for reading the whole context again, and the chain hands a session over to a new one rather than resume it cold.

With **Settings → Sessions → Keep the cache of a waiting session warm, hours** above 0, Even Keel asks a copy of the session for one word shortly before its cache would expire, so the next real turn reads it from the cache.

The copy writes nothing: the session, its transcript and its question stay as they were, and the page and the statistics do not see the pings — the service log has a line for each.

It covers the current session of each running chain that is not paused and not on a limit, including a session waiting to retry a temporary model error, and in pull-request mode the sessions waiting on their open pull requests; a session waiting on a question with answer buttons too; never a session mid-turn or one whose cache has already gone cold.

The pings stop after the hours you set, counted from the session's last answer, or once they would cost more than a cold start: 20 on an hour cache, 12 on a half-hour or a five-minute one.

OpenCode and Copilot sessions are not kept warm. An overloaded ping is skipped and can be tried again while the cache remains warm.

A ping that misses the cache or fails for another reason stops the pings for that session until the service restarts, and a restart forgets the pings, so a session waiting across one is let go cold.

Each ping spends the account's limits.

## Lean sessions

Chain sessions start without claude.ai skills and plugins, and with niche bundled skills reachable only through `/name`, so their skill listing does not eat the context; the project's own settings still win. It is a switch in **Settings → Sessions**, and the settings files stay untouched.

The `/tools` page shows what sessions get, for one project or several side by side: what will not reach them, settings by level, and the skills and tools the last session actually saw.
