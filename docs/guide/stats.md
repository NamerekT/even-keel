# Statistics and the README badge

Both are optional, and a chain runs without either. The statistics show what your sessions cost and where they got stuck; the badge shows a project's chain in its README, the way a CI badge shows a build.

- [Statistics](#statistics)
- [README badge](#readme-badge)

## Statistics

A built-in collector (Tally) reads the session transcripts every five minutes into an embedded Postgres ([PGlite](https://pglite.dev)) or your own: spend by day and project, cost and time per task, where sessions got stuck, slow commands, estimates against actual time, and before/after comparisons of changes to your rule files. All of it on the `/stats` page.

### Turning it on

The last step of the first start's setup asks whether you want it — no stats, the local database or your own Postgres — and nothing is collected until you choose; the copy takes about a third of the transcripts' size.

Switch it on or off any time in Settings → Stats: it applies at once, and turning it off deletes no data.

Without stats the checkpoint threshold stays at 200k tokens.

Statistics include history from existing account folders, including the global Claude and Codex folders even if you have not added those accounts in Even Keel. A folder left out of a scan keeps its reading progress while its files still exist, so changing the scan does not force that history to reload.

### What is counted

Spend while stuck and task stuck counts exclude spans the classifier marked `normal` (a false alarm).

Spans without a reason, or marked `other`, still count. The span lists and weekly breakdown keep every span and its reason; reclassification updates the totals on the next uncached read.

"Where the spend goes", the task table and rule comparisons group models by tier: Opus, Sonnet, Haiku and Fable for Claude; Sol, Luna, Astra and Terra for OpenAI.

Versions within a tier count together; OpenAI models without a known tier appear as GPT. Other families, including DeepSeek, appear separately. Shares below 1% fold into "others".

Task time includes Codex, OpenCode and Copilot turns from their own session records, including older sessions whose records are still available, so their tasks get a time report too.

For Codex, visible synchronous question waits are excluded from active time; waits the session file does not show remain included. OpenCode and Copilot sessions ask in their final text rather than through a question tool, so their turns have no question waits to exclude.

### Rule changes

"Rule changes" starts open and remembers your choice.

Pick a chart mark to see "Before and after" and "By model" above the folded "What changed" details.

Each side has its own model selection, saved in the URL; without a mark, "Side by side" compares models over the same page period.

Account limit windows and checkpoint thresholds have separate folded sections; components show the 10 with most tasks, with "Show all" for the rest.

A comparison is easier to judge when you know why a rule changed: add the hook `tally/bin/rule-hook.mjs` to `~/.claude/settings.json` and a session that edits a `CLAUDE.md`, skill, hook, agent or settings file is asked to log the reason in `<state>/rule-history.jsonl` (`ruleHistory` in `tally/tally.config.json`), which `/stats` attaches to the change:

```json
"hooks": {
  "PostToolUse": [{ "matcher": "Edit|MultiEdit|Write", "hooks": [{ "type": "command", "command": "node \"/path/to/even-keel/tally/bin/rule-hook.mjs\"" }] }],
  "Stop": [{ "hooks": [{ "type": "command", "command": "node \"/path/to/even-keel/tally/bin/rule-hook.mjs\"" }] }]
}
```

### Time reports in the tracker

An hour after a done task's last turn, its active agent time goes into the tracker's own time tracking, once, signed "Tally: активное время агента по ходам транскриптов": a time report in Huly, spent time in GitLab, a worklog in Jira, in whole minutes.

GitHub and Linear have no time tracking and get none.

On GitLab the profile's account needs to be at least Reporter in the project; on Jira it needs the **Work on issues** right and time tracking switched on for the site.

Without them the task gets no time, the service log names the project, and the task is not tried again.

### Test projects

Mark a sandbox as **Test project** in its **Repository** settings.

Its card gets a small test tag, and its entire history disappears from the home launch chart and the default statistics. Collection and task chains continue.

Turn on **Show test projects** on the statistics page to see that history again; the choice stays in the page's link. Opening statistics from the project's own strip includes it automatically.

Removing the flag restores its history everywhere. If several projects share one key, marking any of them hides that key from aggregate statistics. Account usage and spending still show the real totals.

### The `tally` plugin

The page shows the numbers; the `tally` plugin draws conclusions from them.

Its `tally:session-audit` skill answers "tasks got more expensive — why?" or "what changed after I edited CLAUDE.md?" from any project: it compares the period since your last rule edit (or the one you name) with the span before it — task cost and time, context per request, entry context, sessions per task, stuck spans, estimates — always cut by model, lists the rule edits, models and outlier tasks between them, digs into the tasks that show the cause and into handoffs and context compactions (what the next session re-read, what the ramp-up cost), and ends with proposals, each with the metric it should move.

It only reads the database and changes no rule by itself.

Install it in Claude Code with `claude plugin install tally@even-keel` once the marketplace is added ([setup](setup.md#with-the-plugin)); it finds Even Keel through the running service, or `EVEN_KEEL_HOME` set to the checkout ([plugins/tally](../../plugins/tally/README.md)).

Estimates, statuses and components come from Huly: with another tracker the audit skips what needs them.

Money is at API prices (`prices` in `tally/tally.config.json`; a model it does not list takes its price from the models.dev catalogue an OpenCode account keeps, when there is one), a ruler for comparing, not your subscription's bill.

## README badge

A project can show its chain in its README the way a CI badge shows a build: the tasks in work and what the agent is doing, the context fill, the chain as chips with the time each done task was closed (by your machine's clock), the milestone and the last 30 days' numbers.

The milestone's card splits its tasks into done, queued for the agent and waiting for you, and says when the agent's part should be through at the chain's pace of the last week, next to the milestone's own date in the tracker.

Even Keel pushes the project's state to a small Cloudflare Worker you deploy once for all your projects ([`deploy/badge`](../../deploy/badge/README.md)); the README shows the Worker's picture, so the page itself stays private.

Set it up in the project's settings → **Repository** → **README badge**:

1. **Where to publish** — the Worker's address, the project's name on it (its key in lower case by default) and the push secret you gave the Worker, one for all projects. **Check** pushes the project's state and reads the picture back, and says what is wrong: the address, the secret, or a Worker that needs deploying again. Turn **Publish the badge** on.
2. **What to show** — a switch per part of the badge. The Worker receives only a task's English title, and the badge shows the key alone where there is none. With **Task titles in English** and publishing on, Even Keel sends only the current task's title to your LiteLLM proxy, using `TALLY_LLM_URL`, `TALLY_LLM_KEY` and `TALLY_LLM_MODEL`; descriptions, comments and questions are never sent. It uses the same free Gemini setup as the stats classifier. Translations are cached across restarts; a changed title is translated again. Missing settings or an error leave the key alone, with another attempt no sooner than 30 minutes later — or at once after you change the URL, key or model, while ready translations stay. With publishing off, the preview uses cached translations only.
3. **Preview** — the badge as it looks now, in the dark and the light theme. **Download PNG** saves a still picture of it in the theme shown, at twice its size, for a post on a site that takes no SVG or no picture by link (Reddit, LinkedIn). It needs no Worker.
4. **For the README** — the snippet to paste: the light picture for readers with a light theme, the dark one otherwise, linked to the repository's releases page (edit the link if it should lead elsewhere).

Before anything is published, the title and the action's text pass a filter of private data: a text that names your accounts, the machine or its user, a tracker or CI address or login, your git name or e-mail or another of your projects, or that looks like a secret, an e-mail, a phone number, an address, a host or an absolute path, is left out whole — the task shows its key alone, the action only its tool. The preview shows exactly what would be published, and the log says which text was left out and why, without the text. The filter cannot know the names of people or clients: the translation is asked to replace them in titles, but an action's description goes as the agent wrote it — turn **Tasks in work and the current action** off if that worries you.

While the badge publishes the action, a Claude Code session of the chain is asked every two minutes, through the `agent-bridge` package's hook, to add one line `status: …` to its next message — what it is doing, in plain English. The badge shows that line in place of the command's description for up to five minutes; a line the filter catches, or none at all, leaves the description. The line is hidden from the chat, and nothing is asked while the badge is off or its pushes fail.

Each change applies at once; turning the badge off publishes a stopped chain one last time. After Even Keel starts, the badge keeps its last picture until the tracker, the sessions and the numbers are read, two minutes at most.

The statistics cover the last 30 days and refresh at most every 15 minutes.

Projects with the same key share their statistics, as on the Stats page.

An empty period shows `0 sessions` without task medians; unavailable statistics are left out until a successful refresh.
