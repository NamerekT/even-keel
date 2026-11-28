# Configuration: CI, sessions and statistics

The rest of the settings by key, as on [Configuration](config.md): the bold name in a row is where the page has the same setting.

A project can set its own value of the `ci` keys, its commands, `pullRequests`, `provider`, `models`, `accounts`, `brief`, `prompt`, `promptLanguage`, `standards`, `protection`, `contextHandoffs`, `stats.checkpointTokens`, `stats.checkpointShares`, `cacheTtl` and the three auto-compaction windows, as `projects[].<key>` in the file and under the same name in its settings; the project's value wins. The other keys are shared only. A project's `null` for a key is its own value, not "as shared". A change applies to new sessions; running ones keep what they started with, unless the row says otherwise.

## CI, checks and pull requests

All of them are in **Settings** → **Check and CI** and on a project's **Check and CI** tab; each `ci` key is set per project on its own (`projects[].ci`). What they do together is in [CI, pull requests and releases](ci.md).

| Key | Default | What it does |
| --- | --- | --- |
| `ci.guard` | `true` | **Keep main green**: the next task waits for a green main branch, and a red one is fixed first. `false` — the chain does not watch the main branch: no wait for a CI, no check, no fix; CI itself still runs and reports. The other `ci` keys are kept for when it is back on |
| `ci.kinds` | `["forgejo", "github", "gitlab"]` | **CI of main**: the CIs whose verdict on a pushed main branch the next task waits for; empty — none. A CI not named here still shows its runs in the CI panel, but a push it takes no run for is not called stuck |
| `ci.waitMinutes` | none | **Longest wait for CI, min**; none — as long as it takes, `0` — not at all (faster, but a task may start on a broken main branch) |
| `ci.recheckMain` | `true` | **Check main again if it moved**: `false` — do not run the check again on a main branch that moved during the task |
| `ci.fixTask` | `false` | **Create a task when CI fails**. `false` — a session without a tracker task fixes a red main branch; the session of the current task is stopped meanwhile and then continued with its work and context, with a note to merge the fix. `true` — a high-priority task in the tracker, taken after the current one |
| `ci.rerunFailed` | `true` | **Rerun failed CI jobs once** before fixing, waiting up to an hour for them: green on the rerun — no fix. Only GitHub Actions and GitLab CI can be rerun (a GitHub token needs `actions: write`); with Forgejo Actions the fix starts at once |
| `projects[].commands.beforeStart` | `[]` | **Commands before start**: shell commands run in the task's folder before a new session starts, such as `npm ci` ([Commands before start and after a green main](ci.md#commands-before-start-and-after-a-green-main)) |
| `projects[].commands.check` | `[]` | **Check commands**: the project's own check, for when no counted CI judges the main branch (none counted, or one not answering). A session's merge waits until they pass in its worktree ([A check without CI](ci.md#a-check-without-ci)) |
| `projects[].commands.afterGreen` | `[]` | **Commands after a green main**: shell commands run in the main checkout once a pushed main branch is green, such as a build and a restart of the project's service ([Commands before start and after a green main](ci.md#commands-before-start-and-after-a-green-main)) |
| `projects[].pullRequests` | `false` | **Pull requests instead of merging**: a session does not merge its branch; Even Keel pushes it and opens a pull request ([Pull requests](ci.md#pull-requests)) |

## Sessions and agents

Most of these are in **Settings** → **Providers and models**; the project's own are on its **Sessions** tab.

| Key | Default | What it does |
| --- | --- | --- |
| `provider` | `claude` | **Provider**: what sessions run on — `claude`, `codex`, `opencode` or `copilot` ([Agents](agents.md#what-each-agent-has)). A task's own run, set on its card, can override it |
| `models` | `{ "claude": "opus" }` | **Model**, by provider, as the CLI takes it: `{ "claude": "sonnet", "codex": "gpt-5.6-luna", "copilot": "gpt-6-luna" }`. A provider without one — the CLI's own default (for Codex the model of its `config.toml`, for Copilot `auto`). OpenCode's model is `<provider>/<model>` and is kept per service its account signs in to: `{ "opencode/anthropic": "anthropic/claude-sonnet-5-5" }`; the keys are `opencode/openai`, `opencode/anthropic`, `opencode/openrouter`, `opencode/github-copilot`, `opencode/opencode-go` and `opencode/opencode` (no sign-in). A project's entry overrides the shared one of that provider only |
| `accounts` | `{ "claude": "global", "codex": "codex" }` | **Account**, by provider, named by its folder (shown in the tip of the account's icons on `/accounts`), not by its name. This account is the one the header shows and switches first; the header also shows the limits of every other account a project runs on. An account named here or in a project cannot be removed. OpenCode and Copilot have no default account: add one on `/accounts` ([Accounts](accounts.md)) |
| `cli.<provider>` | `system` | **CLI version** per provider ([CLI copies](agents.md#cli-copies)): `system` — **Yours**, your installed CLI; `checked` — **Checked**, Even Keel's copy of the version it was checked against, downloaded after you agree; `latest` — **Latest**, its copy of the newest release, offered only where you cannot install the CLI (Docker, an npm global folder you cannot write to). A failed download goes back to `system`, except for Claude on the Agent SDK, which needs a copy and stays on `checked` |
| `execution` | `{}` | **Execution**, shared only. `claude`: `auto` (the default), `bg` or `sdk` — [Two ways to run a session](agents.md#two-ways-to-run-a-session); `sdk` with `cli.claude` `system` is an error. `codex`: `bypass` — **Without the sandbox**, no sandbox and no automatic reviewer, needed under the Windows service ([Codex](agents.md#codex-preview)) |
| `cliCheck` | `false` | **Check new CLI versions on this machine**: a short live check of a new CLI version, and weekly of the checked one, in the account folder your projects use. It holds that account's chains for a few minutes and spends its limits ([Checking a new CLI version](agents.md#checking-a-new-cli-version)) |
| `switchOnLimit` | `false` | **Go on where a limit is left** in **Settings** → **Chain**, shown while the hub has more than one machine: a task not started yet goes to another machine whose account has limit left, instead of waiting for the reset; a started task stays. Running chains on several of your own paid accounts may be read as getting around a usage limit, so the page turns it on only after a warning, and the risk is yours |
| `brief` | `null` | **Task description in the prompt** in **Settings** → **Chain**: the session gets the task's title and description in its first message. `null` — automatic: only when the session cannot read the task itself (no package of the project brings its tracker's MCP server). With `false` and nothing to read the task with, the chain pauses with buttons to turn one of them on |
| `prompt` | none | **Prompt**: text added to every new session's prompt, whatever agent runs it ([Prompts](sessions.md#prompts)); a project's own `prompt` comes after the shared one |
| `modelPrompts` | `{}` | **Model prompts**: ordered prompts by `provider \| model` pattern, such as `{ "Claude \| haiku*": "Keep answers short.", "* \| *sonnet*": "Check the tests." }` ([Model prompts](sessions.md#model-prompts)) |
| `promptLanguage` | `language`, then `en` | **Language of session prompts**: the language of the prompts Even Keel sends to sessions |
| `projects[].standards` | `[]` | **Standards** on the project's **Sessions** tab ([Standards](sessions.md#standards)): each `{ "doc": "docs/design.md", "files": ["**/*.tsx"], "except": ["**/*.test.*"], "shots": true }` — a document in the repository, the masks of the files it guards and of those it leaves alone, and whether a branch that changed them waits for screenshots and answers before its merge; each document once |
| `protection` | every built-in group on | **Protection** in **Settings** → **Sessions** ([Protection setting](reference.md#protection-setting)) |
| `trimTools` | `true` | **Trim the tools** in **Settings** → **Sessions**: chain sessions start without claude.ai's skills and plugins, and get the hidden skills only when named ([Lean sessions](sessions.md#lean-sessions)) |
| `hiddenSkills` | `update-config`, `loop`, `schedule`, `init` and other built-in skills a chain session has no use for | **Hidden skills**: bundled skills that sessions under **Trim the tools** get only by `/name` |

## Context, cache and handoffs

All of them are in **Settings** → **Sessions**, except the windows, which are in **Providers and models**.

| Key | Default | What it does |
| --- | --- | --- |
| `context` | `{ "warn": 50, "danger": 80 }` | **Context scale**, **Warning, %** and **Danger, %**: the colours of a session's context bar, in percent of its context window; the bar shows the token count alone until the agent reports a window |
| `contextHandoffs` | `true` | **Handoffs by context size**: `false` — a chain session is never asked for a handoff because of its context size, and the agent compacts its context by itself; handoffs on a usage limit stay ([Handoffs](sessions.md#on-a-full-context-or-when-you-ask)). Applies to running sessions at their next tool call |
| `stats.checkpointTokens` | `null` | **Checkpoint threshold, tokens**: the context size, from 100000, at which a chain session is first asked for a handoff; `null` — the calibration shown on `/stats`. The task label `Break \| compaction` turns it off for one task; `Break \| handoff` or no label uses the project's threshold |
| `stats.checkpointShares` | `{ "first": 72, "late": 85, "hard": 95 }` | **Checkpoint thresholds, % of the window**: the most of a session's window, `first < late < hard`, its first handoff ask, later asks and the hard limit may come at. Lower them only for small windows ([On a full context](sessions.md#on-a-full-context-or-when-you-ask)) |
| `cacheTtl` | `"5m"` | **Prompt cache lifetime** of chain sessions, `"5m"` or `"1h"`; `null` leaves it to Claude Code (1 hour on a subscription, 5 minutes on an API key). With `keepWarm` on, 5 minutes is the cheaper one ([Which cache lifetime](sessions.md#which-cache-lifetime)). Project chats always use 1 hour |
| `keepWarm` | `2` | **Keep the cache of a waiting session warm, hours**, 0–24: how long the cache of a Claude Code or Codex chain session waiting for your reply is kept warm, from its last answer; `0` — off. It spends the account's limits ([Keeping a waiting session warm](sessions.md#keeping-a-waiting-session-warm)) |
| `chatSessions` | `3` | **Live project chat sessions per machine**. A chat's session also stops once its prompt cache has expired; the chat stays in the list, and your next message resumes it with the same context. A chat starting past this number stops the longest idle chat on its machine, never one that works or waits for you; when all are busy it starts anyway |
| `autoCompactWindow` | `null` | **Auto-compaction window** in the Claude Code block, whole tokens: the window Claude chain sessions compact their context against. `null` — the account's own window. Hand sessions keep the account's window |
| `codexAutoCompactWindow` | `null` | **Auto-compaction window** in the Codex block: the context window of Codex chain sessions, which compact about 32k before it; `null` — the model's own. Hand sessions and `config.toml` are left alone |
| `openCodeAutoCompactWindow` | `null` | **Auto-compaction window** in the OpenCode block: the same for OpenCode chain sessions, as a ceiling — a model whose own window is smaller keeps its own. Copilot has no such setting |

## Statistics

All of them are in **Settings** → **Stats** ([Statistics](stats.md#statistics)).

| Key | Default | What it does |
| --- | --- | --- |
| `tally` | `null` | where the statistics go: `off`, `local` (the embedded database) or `server` (your Postgres from `TALLY_DB_*`); `null` — not chosen yet, the page asks and nothing is collected |
| `stats.compare` | `{ "minTasks": 5, "minSessions": 10, "days": 7 }` | **Before/after comparisons**: the fewest **Tasks** and **Sessions**, and the **Days**, on each side of a comparison on `/stats` |
| `stats.moves` | `{}` | **Moved folders**, `{ "old path": "new path" }`: sessions in the old folder count under the new one |
| `stats.otherBelow` | `0` | **Into Other when cheaper than, $**: folder groups that cost less than this, all time, are shown as one Other row on `/stats` |
