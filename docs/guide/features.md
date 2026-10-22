# What Even Keel does

The [README](../../README.md) has the short version. This is every feature in full; the keys named here are in the [reference](reference.md).

## The chain

Tasks enter the chain by status (by default: ready and in-progress tasks — not the backlog, not closed ones) and by labels you choose; a task labelled `Manual` or `Вручную` never enters it, it is yours to run. Order: open blockers first, then the order you set by dragging on the page, then milestone, priority, task number. A task with an open blocker waits; a task with subtasks never runs itself — its subtasks do, and on Huly Even Keel closes it once they are all closed. A project with nothing to run says so and opens the project in its tracker, where you file or ready the next tasks.

Sequential within a project, not across them: `parallel` lets that many chains on different projects run at once (one by default). Other projects wait in a queue and start as soon as a chain ends. The usage limit stays shared: every running chain takes tasks until the window is used up, then they all wait for the reset.

## Sessions

Each task gets a background session (`claude --bg`) in its own git worktree `.claude/worktrees/<key>-<number>` on a branch `<key>-<number>/task`, made from `main` (or the project's `branch`; `main` below means that branch). The session does the task and merges its branch into `main`; Even Keel sees the merge, closes the task in the tracker, stops the session, removes the worktree and the branch, and syncs `main` with the remote.

A task that needs no change in the repository — done in `main` already, research, an answer — has nothing to merge. Its session ends the turn with the last line `NO CHANGES: <one line — why>`, and Even Keel checks the worktree: with no commits beyond `main` and nothing uncommitted it moves the task to Done, puts the line in a comment on it and cleans up as after a merge. With commits or uncommitted changes the session is told to merge them or drop them and mark again. In PR mode the `PULL REQUEST:` mark does the same.

What a session runs on — the provider, its model and its account — is set in the config, shared and per project; Claude sessions run on Opus by default, whatever `/model` last saved in the CLI settings. With `modelLabels` on, a task's label `Claude | sonnet`, `Codex | gpt-6.1-sol` or a bare `Codex` picks it for that task; a label of a provider with no account set runs the task on the project's provider and says so in a toast.

## Release branches

Fixes of a released version can run in a chain of their own while the next version goes on in another. Clone the repository a second time, check out the release branch there and add it as a project with its own key on the same tracker project (`huly` names it; on Linear, `TEAM/Project`). The two split the tracker's tasks by milestone: the release project requires the release's milestone (`chain.requiredMilestones`), the main one excludes it (`chain.excludedMilestones`), and Even Keel refuses a pair that would both take one task. They read the tracker once between them.

With `mergeInto` naming the main project, the release project is carried forward: Even Keel merges its branch into the main project's branch in the main project's checkout and pushes it, in batches, whenever the main chain stands — stopped, empty or paused — so a fix never lands in the middle of a task's merge. **Carry now** on the release project's page does it at once. A conflict is aborted and the carry waits: resolve it by merging by hand, or press **Carry now** to try again. Nothing is ever merged into `main` of a released version; that moves by your release.

## Codex (preview)

The shared or a project's `provider` key (the shared one is also moved by giving the Even Keel role to the Codex account on the accounts page), or a `Codex` label on a task, runs the task's sessions on the OpenAI Codex CLI instead: one `codex exec --json` per turn, the transcript, context fill and limits (5-hour and weekly, or the free plan's 30-day one) read from Codex's own session files, the project's packages passed on every turn. Codex has no question tool, so a turn that ends without the task done waits for your reply in the chat window.

Run it as a chain only on short test tasks. From the Windows service the Codex sandbox does not start (a Codex bug), so on Windows it needs `execution.codex` set to `bypass`, which runs Codex sessions with no sandbox at all ([What has not been verified](../unverified.md#codex)).

## OpenCode (preview)

`provider` set to `opencode`, or a label such as `OpenCode | opencode/big-pickle`, runs the task's sessions on [OpenCode](https://opencode.ai): one `opencode run` per turn, the transcript and context fill read from OpenCode's own database, the project's packages passed on every turn. The model is OpenCode's `<provider>/<model>` (`opencode/big-pickle`, `anthropic/claude-sonnet-4-5`, `openai/gpt-6.1-sol`); without one, OpenCode's default. The session reads the project's `AGENTS.md`, else its `CLAUDE.md`, but not your global `~/.claude/CLAUDE.md` or skills. Like Codex, it has no question tool: a turn that ends without the task done waits for your reply in the chat window.

What it does not have yet: limits (OpenCode shows none for ChatGPT or Copilot, so a spent limit stops the session), the handoff on a full context, chat messages delivered mid-turn. It was checked on the free model only and never as a chain under the service ([What has not been verified](../unverified.md#opencode)): run it on test tasks first.

## Slots

For repositories with heavy ignored caches (Unity's `Library`, big `node_modules`) a project can use a pool of permanent worktrees instead of a fresh one per task, so the next task rebuilds only the difference.

## Handoffs

A session that hit the usage limit is resumed after the reset if its prompt cache is still warm, otherwise stopped and replaced by a new session in the same worktree with a handoff prompt.

The same handoff happens when a session ends its turn with a `CHECKPOINT: <path to a note>` line — the [checkpoint](../../plugins/checkpoint) plugin asks for it once the context grows past a threshold, 200k tokens until the project's own statistics give a better one, and stops asking below 300k after three handoffs of a task — and when you press **New session** on the page.

## Chat with the session

The **Chat** button of the current session opens its whole transcript with a reply box: the session's questions one at a time as a card with radio buttons or checkboxes, free text and files — picked with `+`, pasted with Ctrl+V (a screenshot straight from the clipboard) or dropped on the window — which land in the task's `.temp/inbox/`. Pictures the session read and the ones you sent show as thumbnails that open full-window, with a pager through all of them. The button turns amber while the session waits for you. Even Keel stops the session and resumes it with your answer.

You can also write to a session while it works ("not there", "mind X too"): a hook of the [checkpoint](../../plugins/checkpoint) plugin hands the message over at its next tool call or at the end of the turn, without stopping it, and the chat shows whether it waits, was delivered, or came back because the session asked a question meanwhile.

A question with options is also posted to the tracker as a numbered comment; reply with `2`, `1, 3` or text. Remote Control still works for Claude sessions: the page links each one's Remote Control ([setup](setup.md#answering-from-the-phone)).

## Task cards

A click on a task's title opens its card: the description and comments rendered from Markdown, labels with what each means to the chain, milestone, priority, and the tasks it blocks, waits for or relates to. A backlog task moves to Todo from its card, straight from the backlog panel or, when it holds a chain task, from its locked row in the chain, so the phone rarely needs the tracker's own page. On GitHub there is no backlog, so no Todo button.

The milestone on the card is a pick: choosing another one moves the task there in the tracker at once, and the chain reorders. Tracker changes reach the page on the next poll, every 30 seconds; the refresh button in the project head reads the tracker now.

## Changelog drafts

A button on a milestone's head in the chain has the agent write that milestone's changelog section in the Keep a Changelog format, from the titles and closing comments of its done tasks, in the language of your `CHANGELOG.md` (or `README.md`). It runs read-only, on the account and model the project's next session would get, and starts from the section already in your changelog file, so your own edits there stay.

You ask for changes in words and see them highlighted, with what each turn cost and on which account; "Write" puts the section into the file (the project setting `changelog`, `CHANGELOG.md` by default) and commits it to the main branch of your checkout; tasks closed later are added to the section with one button, and a released version's section is left alone.

## Hands off a stopped session

A session that asks a question or fails is left alone: you answer it or move the task in the tracker yourself. Even Keel never writes into a session that stopped on its own — only your own answer goes in, and only while the session waits for it. You can skip a task, and a session that files a blocker for its task gets the task postponed until the blocker is done.

## Unattended mode

For when nobody will answer — a switch in **Settings → Chain** (the gear in the header). Sessions are told to ask nothing, to do everything a question does not hold, and to park a task held by one: committed on its branch, unmerged, the question left in the task, the task moved to Backlog. A session that sits 10 minutes without the task done is skipped, and the session of a done task that stays busy for 10 quiet minutes is no longer waited for, so one stuck session does not stop the whole run.

## Lean sessions

Chain sessions start without claude.ai skills and plugins, and with niche bundled skills reachable only through `/name`, so their skill listing does not eat the context; the project's own settings still win. It is a switch in **Settings → Sessions**, and the settings files stay untouched. The `/tools` page shows what sessions get, for one project or several side by side: what will not reach them, settings by level, and the skills and tools the last session actually saw.

## Packages

Plugins and MCP servers are a set per project, kept by Even Keel and given to chain sessions by flags at every launch: a pinned version installed with one button, updated with another, while a running task stays on the version it started with. MCP servers run behind a local gateway, so the keys stay in Even Keel's `.env`.

Codex sessions get the same set: the MCP servers, and of a plugin its skills and hooks (not its commands and agents), installed into each Codex folder on its first turn there and kept off for your own Codex sessions. OpenCode sessions get the MCP servers and a plugin's skills, not its hooks. The chain does not start a task while a package of its project is not installed, lacks a key or does not answer.

## Accounts

Your own Claude and Codex subscriptions — a personal and a work one, say — one config folder each. At most one Codex account may be on the free plan: OpenAI's terms do not allow several free accounts to get round the limits, so Even Keel refuses a second one ([docs/accounts.md](../accounts.md#the-codex-folders-btn-168-btn-176)).

OpenCode accounts are folders of their own too, signed in with ChatGPT or GitHub Copilot (a link and a one-time code), on an Anthropic or OpenAI API key, or with no sign-in for OpenCode's free models. There is no Claude subscription for OpenCode: Anthropic allows it only in Claude Code, so Claude in OpenCode is an API key ([docs/accounts.md](../accounts.md#the-opencode-folders-btn-214)).

The `/accounts` page lists them in a section per provider (Claude Code, Codex, OpenCode), as cards with their connection, limits and what runs on each now (VS Code chats by their tab titles); a section's "Add" asks for the connection (CLI or API key), then shows that kind's own sign-in; a provider whose CLI is not installed cannot be added, and the page says where to get it. Without the CLI's own folder (`~/.claude`, `~/.codex`), the first account of a provider you add is the one its sessions run on. Renew and remove accounts there, and move Even Keel's chain to an account from that account's card. The same field moves the Claude Code extension in VS Code; the Claude desktop app is not switched, but can be launched on an account folder by hand ([docs/accounts.md](../accounts.md#the-claude-desktop-app)).

An account can also be an Anthropic API key, checked with Anthropic when added and then hourly: its sessions pay from the key, the page shows its spend today instead of limits (with statistics on), and it has no Remote Control and no waiting out a limit; a session whose key runs out of credit is held, the key is checked every 5 minutes, and the chain goes on once it is topped up ([docs/accounts.md](../accounts.md#api-accounts-btn-99)). A Codex account can be an OpenAI API key the same way, checked with OpenAI; a Codex session whose key runs out of money is held the same way.

## Limits

The 5-hour and weekly windows of every account, read with the CLI's own `/usage` command (no quota spent). Even Keel stays inside them: while a window is exhausted the next task waits for its reset.

## Statistics (optional)

A built-in collector (Tally) reads the session transcripts every five minutes into an embedded Postgres ([PGlite](https://pglite.dev)) or your own: spend by day and project, cost and time per task, where sessions got stuck, slow commands, estimates against actual time, and before/after comparisons of changes to your rule files. All of it on the `/stats` page.

On the first start the page asks whether you want it — no stats, the local database or your own Postgres — and nothing is collected until you choose; the copy takes about a third of the transcripts' size. Switch it on or off any time in Settings → Stats: it applies at once, and turning it off deletes no data. Without stats the checkpoint threshold stays at 200k tokens.

A comparison is easier to judge when you know why a rule changed: add the hook `tally/bin/rule-hook.mjs` to `~/.claude/settings.json` and a session that edits a `CLAUDE.md`, skill, hook, agent or settings file is asked to log the reason in `<state>/rule-history.jsonl` (`ruleHistory` in `tally/tally.config.json`), which `/stats` attaches to the change:

```json
"hooks": {
  "PostToolUse": [{ "matcher": "Edit|MultiEdit|Write", "hooks": [{ "type": "command", "command": "node \"/path/to/even-keel/tally/bin/rule-hook.mjs\"" }] }],
  "Stop": [{ "hooks": [{ "type": "command", "command": "node \"/path/to/even-keel/tally/bin/rule-hook.mjs\"" }] }]
}
```

## CI

A badge in the project's head shows the CI of each remote — Forgejo Actions or GitHub Actions, found from `git remote` and the workflow folders: whether the API answers and a runner takes the runs, the current run with its tasks, jobs and steps against the usual length, and the recent runs. The API is polled only while a run is unfinished or after a push.

After a task is merged and `main` is pushed, the next task waits for the CI's verdict (as long as the project allows) while its worktree is prepared. A red `main` is fixed first: Even Keel stops the session working on the current task, starts a session to fix `main` — with the failed jobs and the commits of the push in its prompt, without a task in the tracker — and, once the fix is merged, continues the stopped session with a note to merge `main` into its branch. A project can ask for a high-priority fix task in the tracker instead (`ci.fixTask`). If the fix is red too, the chain pauses instead of starting another.

## A check without CI

A project with no CI, or whose CI does not answer, can name its own check commands, such as `npm run typecheck && npm test`. A session's merge into `main` waits until they pass in the task's worktree (a hook of the [checkpoint](../../plugins/checkpoint) plugin), and a failure goes back to the session to fix. If `main` moved while the task ran, Even Keel runs the check again on `main` in the next task's worktree before that task starts; a failure there is handled like a red CI.

## Pull requests (experimental)

With `pullRequests` on, a session does not merge its branch: Even Keel pushes it, opens a pull request on GitHub or Forgejo and takes the next task; review feedback and failed checks go back to the task's session. Use it at your own risk: only opening, closing and merging on GitHub ran live. In full — the `projects[].pullRequests` row of the [reference](reference.md#configuration).

## Updating from the page

A newer release gets a mark next to the version in the gear menu and a notification. Both open the update window: the notes of every release since yours, a mark on a release that takes back part of an earlier one, and **Update**. Even Keel waits for the chains to settle, checks out the release, builds it and restarts the service; if the new version does not come up, the old one comes back, and the page says what failed. After an update, **Revert** goes back to the previous version the same way, unless the update changed the format of the stored state. The button needs Even Keel running as a service from a clean clone; otherwise the window says why and you update by hand. In full — [Updating](setup.md#updating).

## Languages

The page is in English or Russian; the prompts Even Keel sends to sessions can be in either, separately.
