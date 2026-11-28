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

The provider, its model and its account are set in **Settings** → **Providers and models**, for every project, and in a project's own settings, which win. Claude sessions run on Opus by default, whatever `/model` last saved in the CLI settings.

The model field of a provider's row takes any name and suggests the ones the row's account offers: OpenCode's own list, the models of the Codex account, Claude's aliases. When you switch the row to an OpenCode account whose list lacks the model, the field goes back to the inherited model, so a pair that cannot run is never saved.

### A task's own run

One task can run on something else. On the task card, **Runs on** has a provider pick, a model field and an effort pick; Even Keel keeps the choice, not the tracker.

- **As the project** — the first choice of the provider pick — leaves the provider to the project.
- A provider with an empty model takes the model set for that provider, shown greyed in the field. A provider with no account set runs the task on the project's provider and says so in a toast.
- The effort is Claude Code's `low`, `medium`, `high`, `xhigh` or `max` and Codex's `minimal`, `low`, `medium`, `high` or `xhigh`. OpenCode and Copilot offer `none` to `max`, but each model takes only some of them (in OpenCode, the model's variants), so pick one your model has. **Default** passes none and the CLI decides. An effort set without a provider goes to whatever the task runs on, when that provider has such a level.

For a task with a session at work, the card says that the change takes effect from its next session. A session that files tasks through the tasks server can set the run too.

A chain row, the chats and a session's **Model** fact show the run as the provider, the model's short name and the effort as five bars, from one for low to five for max: `claude-opus-5-5` with high effort reads `Claude | Opus 5.5` with three bars filled, an OpenCode model goes by its name in OpenCode's catalogue, and a free OpenRouter model (`:free`) gets a `free` badge. Where space is tight, only the model is cut with an ellipsis; the tip has the full name, the id and the effort's word.

## Prompts

Instructions for every session go into the **Prompt** of **Settings** → **Providers and models**, whatever project and agent it runs: Claude Code, Codex, OpenCode and Copilot each read their own global rules file, and Even Keel does not copy one into another.

A project's own **Prompt** comes after it and adds to it rather than replaces it. Both are off until you write something, are passed as written (Markdown is fine) and go into every new session — the first start and every handoff; a resumed session already has them.

### Model prompts

**Model prompts**, in the same settings tab, add instructions for sessions matching a provider and model: `Claude | sonnet*` covers Claude's Sonnet aliases, `* | *sonnet*` also covers full Sonnet ids through other agents.

- Only `*` is special (any string); case is ignored, and spaces around `|` are trimmed.
- A bare `Codex` covers every Codex session, the CLI's default model included. A pattern with a model matches only a session whose model is named.
- Every matching row adds its prompt, in table order, to each new session, a handoff and **New session** included. Chat replies and automatic resumes continue the same conversation without adding them again, even if the model has changed.

The field suggests names from the accounts' model catalogues, and each row lists its matches by provider: the first eight, with a toggle for the rest, or only their count when the pattern takes every model of the provider (`OpenCode | *`, a bare `OpenCode`). The Claude and Codex lists are incomplete, so a pattern with no known match only gets a warning and is saved: an id you typed by hand may still match.

## The project's instructions and skills

A project written for one agent keeps its rules when its tasks move to another: Even Keel gives an agent the instruction file it would not read by itself.

| Agent | Only `CLAUDE.md` | Only `AGENTS.md` | Both | Skill folders |
| --- | --- | --- | --- | --- |
| Claude Code | `CLAUDE.md` | `AGENTS.md` (given by Even Keel when a folder above holds a `CLAUDE.md`, `~/.claude/CLAUDE.md` included) | `CLAUDE.md` | `.claude/skills` |
| Codex | `CLAUDE.md`, given by Even Keel | `AGENTS.md` | `AGENTS.md` | `.agents/skills`, `.codex/skills` |
| OpenCode | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` | `.opencode/skills`, and `.claude/skills`, `.agents/skills` given by Even Keel |
| Copilot | `CLAUDE.md` | `AGENTS.md` | both | `.github/skills`, `.agents/skills`, `.claude/skills` |

To keep one set of rules for every agent, write them in `AGENTS.md` and make `CLAUDE.md` the single line `@AGENTS.md`: Claude Code reads the file it names, the others read `AGENTS.md`. Codex cannot see skills in `.claude/skills`; keep the ones it should see in `.agents/skills`, which Claude Code in turn does not read. Only what is committed on the main branch reaches a session.

A project's **Settings** → **Sessions** starts with a summary of what a session of its agent gets: the instruction file, the shared and the project's prompt, the project's skills (and the ones the agent misses because of their folder), and the skills of the project's packages. When none of it is there, it says the project has no rules. The project's session settings follow below it.

## Standards

A rule that matters only for some files — how the screens look, how the API is written — need not sit in every session's instructions. Make it a standard: **Settings** → **Sessions** → **Standards** of a project ties a document of the repository to the files it guards, as masks from the repository's root (`**/*.tsx, web/**/*.css`), with exceptions (`**/*.test.*`).

The document is picked from the Markdown files on the project's main branch; one that is not committed there is flagged, since sessions would not get it. **Add "Interface"** fills in the files a screen is made of — `.tsx`, `.jsx`, `.vue`, `.svelte`, `.css`, `.scss`, `.html`, tests excepted.

A session gets the document the first time it reads a guarded file. If it goes to edit one before that, the edit is refused once with the document, and the next one goes through. After a compaction of the context the document comes again.

**Shots and answers before the merge** holds the merge of a task branch that changed the standard's files (in pull request mode, the handover to its pull request) until both are there:

1. screenshots in `.temp/shot/`, taken after the last change;
2. answers written after them in `.temp/<name>-check.md`, where the name is the document's file name without `.md` (`design-check.md` for `docs/design.md`), to each question of the document's section "The check" — a list of questions under a heading of that name.

The session is told what is missing and goes on.

Standards work through Even Keel's own plugin for sessions, [agent-bridge](../../plugins/agent-bridge), which every chain session gets, and reach Claude Code, Codex, Copilot and OpenCode sessions; on OpenCode the pull request is not held back. A project has none until you add them.

## Handoffs

A handoff replaces a session with a fresh one in the same folder: the old session leaves a note, and the new one starts from it. It happens on a usage limit, on a full context and when you ask for it.

### On a usage limit

A session that hit the usage limit is resumed a minute after the reset if its prompt cache is still warm and it runs in the same account folder. Otherwise it is stopped and a new session in the same folder takes the task over with a handoff prompt. An account that is signed out waits until it is ready again.

What you see:

- The session panel groups the limit messages, newest first, with earlier ones folded below; it names the account and the provider and shows the reset in your local time.
- While the task's account has its limit used up, **New session** cannot be pressed: its tooltip names the account and the reset. The chain hands the task to a new session by itself once the limit frees up, and the button comes back as soon as a limits poll sees a free window.

What you can do:

- **Skip** the task: it works all along.
- Press the panel's settings button: it opens the project's **Settings** → **Sessions**, where you change that provider's account in the shared or the project's own pool. Or change the provider on the task's card.

Switching the account in the header does not move a task that runs on another provider than the header's one.

### On a full context, or when you ask

The same handoff happens when you press **New session** on the page, and when a session ends its turn with a `CHECKPOINT: <path to a note>` line. Even Keel's plugin asks for that note once the context grows past the handoff threshold (**Checkpoint threshold** on the page): 200k tokens until the project's statistics give a better one. A task already handed over three times is asked only from 300k.

**Checkpoint thresholds, % of the window** cap these numbers for a session with a small context window: the first ask comes at most at 72% of the window, later asks at 85%, the hard limit of a task with many handoffs at 95%. A share only lowers a threshold, never raises it. For Claude Code the later asks also stay before the point where it would compact its context by itself, about 32k tokens short of the window. A threshold set in tokens by hand ignores the shares.

To leave a long session to the agent's own compaction instead, turn off **Handoffs by context size** in **Settings** → **Sessions**, for every project or in one project's settings: the plugin then never asks for a note because of the context, while the handoffs on a usage limit, **New session** and a note the session writes by itself work as before.

If the session writes `.temp/handoff.md` near the end of its turn but forgets the line, the plugin asks it to add it. In a project without git, whose tasks share one folder, each task's note is its own `.temp/handoff-<task>.md`.

When the project's sessions have Even Keel's tasks package, the note is not a file: Even Keel keeps it in its database and puts it straight into the next session's prompt, and a late note from a session already replaced never overrides the newer one. A handoff without a note (a usage limit, **New session**, a crashed session) carries the last steps of the old session.

## A turn that writes nothing

While a working turn writes nothing, the session card and the **New session** tooltip show its last write and when you can replace it:

- after five quiet minutes, you can interrupt it, with a confirmation;
- after thirty, it is taken for hung: **New session** needs no confirmation, and a chat reply stops the hung turn before going on.

New output resets the timer and drops an open confirmation. Nothing stops a silent turn by itself. This holds for Claude Code, Codex, OpenCode and Copilot; a session waiting for your answer is not a silent turn.

A Claude session whose turn has ended while a command it started in the background still runs says so instead of "working": the card's line and the chat's turn line read "Waiting for its background command" with the command. The drawer's status, **waiting on background**, has a tooltip with the command and the time it will be taken for hung: an hour after the transcript's last line.

## Hands off a stopped session

A session that asks a question or has a permanent failure is left alone: you answer it or move the task in the tracker yourself.

A temporary model overload is retried in the same session after 15 minutes, the wait doubling up to four hours while it keeps failing and starting over after a successful answer. The page shows "waiting to retry" and the next attempt's time. A chat answer or **New session** cancels that attempt; pausing the chain holds the retries.

You can skip a task, and a session that files a blocker for its task gets the task postponed until the blocker is done. When the blocker closes, or you undo **Skip**, a resting session is replaced with a new one carrying its handoff, and the prompt names the closed blockers. A session that meanwhile went back to work, is waiting on its own question or got a message from you is left to go on.

## Keeping a waiting session warm

A session waiting for your answer keeps its prompt cache only for a while: a Claude Code chain session for five minutes (**Settings** → **Sessions** → **Prompt cache lifetime**, see [Which cache lifetime](#which-cache-lifetime)), a Codex session for half an hour. An answer after that pays for reading the whole context again, and the chain hands the session over to a new one rather than resume it cold.

**Keep the cache of a waiting session warm, hours** in **Settings** → **Sessions**, 2 by default, avoids that: shortly before the cache would expire, Even Keel asks a copy of the session for one word, so the next real turn reads the cache. 0 turns it off.

The copy writes nothing: the session, its transcript and its question stay as they were. The statistics count what the pings spent as part of the task's cost. The tip of the session's **Cache** shows until when it is warm, how many times it was renewed since the session's last answer and when last.

It covers the current session of each running chain that is not paused and not on a limit:

- a session waiting on a question, with answer buttons too;
- a session waiting to retry a temporary model error;
- the new session that took a task over after a usage limit;
- in pull-request mode, sessions waiting on their open pull requests;
- a Claude Code session mid-turn while it waits on a long command, or whose turn ended while a background command or agent still runs.

Never while the model is answering, never one whose cache has already gone cold, and never an OpenCode or Copilot session.

The pings stop after the hours you set, counted from the session's last answer, or once they would cost more than a cold start: after 20 pings on an hour cache, 12 on a half-hour or a five-minute one. A ping that misses the cache stops them for that session until the service restarts, and so do three failed pings in a row; an overloaded ping is just skipped. A restart picks the series up from the pings it recorded, so a session waiting across one stays warm. Each ping spends the account's limits.

### Which cache lifetime

**Prompt cache lifetime** is 5 minutes by default, and together with keep-warm it is cheaper than an hour at API prices. Most of the saving is the price of the cache write: on Opus a five-minute write costs $5 per million tokens, an hour-long one $8, and writes are about a third of what a chain session costs. Over 10,300 answers of chain sessions, five minutes with keep-warm cost $432 at API prices; the same answers on an hour-long cache would have cost about $490, some 12% more. The pings among them cost about $2, and the cold rebuilds after a pause the pings did not cover $6.

The hour-long cache costs about $0.58 more per task on average even when the chain asks nothing. On top of that, a late answer to a question costs, at about 108k tokens of context on Opus:

| You answer after | 5 minutes with keep-warm | 1 hour |
| --- | --- | --- |
| up to 3½ minutes | nothing | nothing |
| 3½–47 minutes | the pings, up to about $0.26 | nothing |
| 47–60 minutes | about $0.80: the 12 pings ran out and the cache is written again | nothing |
| over an hour | about $0.80 | about $0.86: it went cold too |

A ping goes out every 3½ minutes; the 12th leaves about 42 minutes after the question, and the cache it read lives 5 minutes more. So five minutes loses only on an answer 47–60 minutes after the question; an answer the next morning costs about the same either way. Pick an hour when keep-warm is off, or when you usually answer 47–60 minutes later.

The setting is for chain sessions only: a project chat always writes its cache for an hour, since nothing keeps a chat warm while you are away. Whether a subscription counts a five-minute and an hour-long cache differently against its usage limits is not published, so the saving above is in API prices, not a promise that a subscription's limit lasts longer.

## Lean sessions

**Trim the tools** in **Settings** → **Sessions** starts chain sessions without claude.ai skills and plugins, and gives the rarely used skills that come with Claude Code only through `/name` (the list is **Hidden skills**), so their skill listing does not eat the context. The project's own settings still win, and the settings files stay untouched.

**Tools**, in the gear menu of the header, shows what sessions get, for one project or several side by side: what will not reach them, settings by level, and the skills and tools the last session actually saw.

A chain session works in a worktree made from the project's branch, so it gets the `.claude/settings.json` committed there, and the page shows that version. A file kept in `.gitignore`, never committed, or edited without a commit in the main checkout does not reach the sessions; the page lists it among the problems with what to commit. A project without git runs its sessions in its own folder and reads the files there.
