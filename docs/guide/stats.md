# Statistics and the README badge

Both are optional, and a chain runs without either. The statistics show what your sessions cost and where they got stuck; the badge shows a project's chain in its README, the way a CI badge shows a build.

- [Statistics](#statistics)
- [README badge](#readme-badge)

## Statistics

Even Keel's built-in collector, Tally, reads the session transcripts every five minutes into a database: an embedded Postgres ([PGlite](https://pglite.dev)) or your own. The `/stats` page shows spend by day and project, cost and time per task, where sessions got stuck, slow commands, estimates against actual time, and before/after comparisons of changes to your rule files.

### Turning it on

The last step of the first start's setup asks whether you want it — no stats, the local database or your own Postgres — and nothing is collected until you choose. The local database takes about a third of the transcripts' size on disk.

- Switch it on or off any time in **Settings** → **Stats**: it applies at once, and turning it off deletes no data.
- The history includes the existing account folders, the global Claude Code and Codex folders too, even if you have not added those accounts in Even Keel.
- Without stats the handoff threshold (**Checkpoint threshold** in the settings) stays at 200k tokens instead of being calibrated ([Handoffs](sessions.md#handoffs)).

### What is counted

- **Stuck spans.** A span where a session got stuck gets a reason: with `TALLY_LLM_URL`, `TALLY_LLM_KEY` and `TALLY_LLM_MODEL` set ([Reference](reference.md)), a model behind your LiteLLM proxy — by default Gemini on its free tier — classifies it. Spend while stuck and the stuck tasks leave out the spans it marked `normal` (a false alarm); spans without a reason or marked `other` still count. The span lists keep every span with its reason.
- **Models by tier.** "Where the spend goes", the task table and rule comparisons group models by tier: Opus, Sonnet, Haiku and Fable for Claude; Sol, Luna, Astra and Terra for OpenAI. Versions within a tier count together; OpenAI models without a known tier appear as GPT. Other families, DeepSeek among them, appear separately. Shares below 1% fold into "others".
- **Task time** includes Codex, OpenCode and Copilot turns from their own session records, so their tasks get a time report too. Time a Codex session visibly waited for your answer is left out; OpenCode and Copilot ask in their final text, so their turns have no such waits.
- **Money** is at API prices — a ruler for comparing, not your subscription's bill. The prices are `prices` in `tally/tally.config.json` of Even Keel's own folder; a model it does not list takes its price from the models.dev catalogue an OpenCode account keeps, when there is one.

### Rule changes

"Rule changes" marks every edit of a `CLAUDE.md`, skill, hook, agent or settings file on a chart. Pick a mark to see "Before and after" and "By model"; each side has its own model selection. Without a mark, "Side by side" compares models over the page's period.

A comparison is easier to judge when you know why a rule changed. Add the hook `tally/bin/rule-hook.mjs` of Even Keel's own folder (a clone, or where npm installed the package) to `~/.claude/settings.json`, and a session that edits such a file is asked to log the reason; `/stats` attaches it to the change:

```json
"hooks": {
  "PostToolUse": [{ "matcher": "Edit|MultiEdit|Write", "hooks": [{ "type": "command", "command": "node \"/path/to/even-keel/tally/bin/rule-hook.mjs\"" }] }],
  "Stop": [{ "hooks": [{ "type": "command", "command": "node \"/path/to/even-keel/tally/bin/rule-hook.mjs\"" }] }]
}
```

The reasons go into `rule-history.jsonl` in the state folder.

### Time reports in the tracker

An hour after a done task's last turn, its active agent time goes into the tracker's own time tracking, once, in whole minutes: a time report in Huly, spent time in GitLab, a worklog in Jira. The report carries a fixed signature, in Russian: "Tally: активное время агента по ходам транскриптов".

- GitHub and Linear have no time tracking and get none.
- On GitLab the profile's account needs to be at least Reporter in the project; on Jira it needs the **Work on issues** right and time tracking switched on for the site. Without them the task gets no time, the service log names the project, and the task is not tried again.

### Test projects

Mark a sandbox as **Test project** in its **Repository** settings. Its card gets a small test tag and is hidden from the home page, and its history from the home launch chart and the default statistics. Collection and chains go on.

- **The flask button** next to the grouping icons on the home page shows the test projects' cards again, and says how many are hidden while they are.
- **Show test projects** on the statistics page shows their history again. Both switches are kept across reloads and restarts. Opening the statistics from the project's own strip includes its tests for that visit, without changing the switch.
- Removing the mark restores the history everywhere. If several projects share one key, marking any of them hides that key from the aggregate statistics. Account usage and spending still show the real totals.

### The `tally` plugin

The page shows the numbers; the `tally` plugin draws conclusions from them. Its skill `tally:session-audit` answers "tasks got more expensive — why?" or "what changed after I edited CLAUDE.md?" from any project:

- it compares the period since your last rule edit (or the one you name) with the span before it: task cost and time, context per request, sessions per task, stuck spans, estimates — always by model;
- it lists the rule edits, models and outlier tasks between them, and digs into the tasks that show the cause, handoffs and context compactions included;
- it ends with proposals, each with the metric it should move. It only reads the database and changes no rule by itself.

Install it in Claude Code with `claude plugin install tally@even-keel` once the marketplace is added ([setup](tracker-connect.md#with-the-plugin)); it finds Even Keel through the running service, or through `EVEN_KEEL_HOME` set to the checkout ([plugins/tally](../../plugins/tally/README.md)).

Estimates, statuses and components reach the audit only from Huly: for a project on another tracker it skips what needs them.

## README badge

A project can show its chain in its README the way a CI badge shows a build: the tasks in work and what the agent is doing, the context fill, the chain as chips with the time each done task was closed (by your machine's clock), the milestone and the last 30 days' numbers. The milestone's card splits its tasks into done, queued for the agent and waiting for you; it shows no release date, since a milestone grows as work goes on.

Even Keel pushes the project's state to a small Cloudflare Worker you deploy once for all your projects ([`deploy/badge`](../../deploy/badge/README.md)); the README shows the Worker's picture, so the page itself stays private.

Set it up in the project's settings → **Repository** → **README badge**:

1. **Where to publish** — the Worker's address, the project's name on it (its key in lower case by default) and the push secret you gave the Worker, one for all projects. **Check** pushes the project's state and reads the picture back, and says what is wrong: the address, the secret, or a Worker that needs deploying again. Turn **Publish the badge** on.
2. **What to show** — a switch per part of the badge. Task titles: see below.
3. **Preview** — the badge as it looks now, in the dark and the light theme. **Download PNG** saves a still picture of it in the theme shown, at twice its size, for a site that takes no SVG or no picture by link. It needs no Worker.
4. **For the README** — the snippet to paste: the light picture for readers with a light theme, the dark one otherwise, linked to the repository's releases page (edit the link if it should lead elsewhere).

Each change applies at once; turning the badge off publishes a stopped chain one last time. After Even Keel starts, the badge keeps its last picture until the tracker, the sessions and the numbers are read, two minutes at most.

### Task titles in English

The Worker receives only a task's English title; without one the badge shows the key alone.

- **Task titles in English** translates the current task's title through the same LiteLLM proxy as the stuck-span classifier (`TALLY_LLM_URL`, `TALLY_LLM_KEY`, `TALLY_LLM_MODEL`). Only the title is sent, never descriptions, comments or questions.
- Translations are kept across restarts; a changed title is translated again. Missing settings or an error leave the key alone and try again no sooner than 30 minutes later, or at once after you change the URL, key or model. With publishing off, the preview uses kept translations only.
- A fix of the red main branch and a release carry have no tracker task: the badge titles them itself ("Fixing the red dev", "Carrying release v0.3 into dev"), with no proxy.

### What is never published

Before anything is published, the title and the action's text pass a filter of private data. A text is left out whole — the task shows its key alone, the action only its tool — when it names:

- your accounts, the machine or its user, a tracker or CI address or login, your git name or e-mail, or another of your projects;
- or looks like a secret, an e-mail, a phone number, an address, a host or an absolute path.

The preview shows exactly what would be published, and the log says which text was left out and why, without the text. The filter cannot know the names of people or clients: the translation is asked to replace them in titles, but an action's description goes as the agent wrote it — turn **Tasks in work and the current action** off if that worries you.

While the badge publishes the action, a Claude Code session of the chain is asked every two minutes, through the `agent-bridge` package's hook, to add one line `status: …` to its next message — what it is doing, in plain English. The badge shows that line in place of the command's description for up to five minutes; a line the filter catches, or none at all, leaves the description. The line is hidden from the chat, and nothing is asked while the badge is off or its pushes fail.

### The numbers

- They cover the last 30 days and refresh at most every 15 minutes.
- Projects with the same key share their numbers, as on the statistics page.
- An empty period shows `0 sessions` without task medians; numbers that cannot be read are left out until a refresh succeeds.
