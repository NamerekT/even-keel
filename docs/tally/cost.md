# Cost, limits, signs and tasks

What a session cost, the limit share, signs and the tasks read from the trackers.

## Cost

### The price

- **The view.** `message_costs` is `messages` × the model's price per million tokens: input, output, cache read, cache write for 5 min and for 1 h, each at its own price. The price is the longest matching prefix of `tally.config.json` (`claude-opus-5-5` before `claude-opus-5`), chosen once per model rather than per response, which makes `period` twice as fast on PGlite. Prices live in the view, not in rows: editing the config reprices the history too.
- **No price.** A model without a price has an empty `cost`, and the run logs it. Models with no public API price are listed in `unpriced` (exact names, BTN-243), so the run does not log them: `codex-auto-review` (Codex's hidden model that reviews approvals, a few thousand tokens a call), `gpt-reserve`, Copilot's `mai-code-1.1-flash` and `mai-code-2-flash`, and `probe` (the Protection bench's fake local provider). A name in `unpriced` that a price covers is a config error.
- **One key per model.** A new GPT model is a new key, never a shorter prefix such as `gpt-6`: it would silently give one price to every unlisted model of the family, whose prices differ 100×. The test of the shipped config (`src/config.test.ts`) checks each model has its own entry. Codex writes the model as the API names it, so a key is the plain model name.
- **Long prompts.** A price may have `longPrompt`: a threshold `over` and five rates of its own. A response whose prompt (input + cache read + both cache writes) is over it pays them on all its tokens, output included (`src/price-views.test.ts`).
- **Fast mode** (`speed = fast`, dearer for Opus) has not been met in the data: `speed` is stored, the price ignores it.
- **The catalogue** (BTN-859, `src/catalogue.ts`). A model the config neither prices nor names in `unpriced` takes its price from the models.dev catalogue: OpenCode's copy `<account>/cache/opencode/models.json`, the most recently written of every OpenCode account folder; with none, there are no catalogue prices. Tally never fetches the catalogue itself.
  - The catalogue prices `<provider>/<model>`, and one model costs differently at different providers, so a response keeps its provider (`messages.provider`): OpenCode's `providerID`, `anthropic` for Claude, `openai` for Codex, none for Copilot and the classifier, which therefore never take a catalogue price.
  - Each run asks the catalogue for the models no config prefix covers (`catalogueWanted`) and replaces the `catalogue` rows of `model_prices`; the config's sync touches only its own rows. A catalogue row is one exact model, never a prefix: `message_costs` takes the config's longest prefix first and only then the row of exactly the response's `<provider>/<model>` (`price_source` says which).
  - From an entry: `input`, `output`, `cache_read` (missing — as input), `cache_write` as the 5-minute write (missing — as input), the 1-hour write 0; the first `tiers` entry of type `context` is `longPrompt` over its `size`, else `context_over_200k` over 200k. The catalogue holds today's prices, so its rows reprice the history like a config edit.
  - A response still without a price is logged with both places named.

### The prices in the config

Per million tokens. A provider without a cache write price has the 5-minute write at the input rate and the 1-hour one at 0.

| Model or family | Source | Checked | Note |
| --- | --- | --- | --- |
| Claude | Anthropic API prices | 2026-09-25 | 5-minute write 1.25× input, 1 h 2×; Haiku 5.5 over 100k tokens 5× |
| `claude-fable-5-2` | the `tier_8_40_cache_read_0_20` entry of the model catalogue in Claude Code 2.1.321 | 2026-11-09 | before a public price page; a newer Fable falls to the `claude-fable-5` prefix, priced above it, so a new Fable is a new key |
| `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` | OpenAI's standard tier, `developers.openai.com/api/docs/pricing` (BTN-234) | 2026-10-19 | the models Codex lists and Even Keel's examples name; `longPrompt` over 272k |
| `gpt-6.2-astra`, `gpt-6.2-sol` | their OpenAI model pages (EKR-141) | 2026-11-17 | `longPrompt` over 272k |
| `gpt-6.1-terra` | [its OpenAI model page](https://developers.openai.com/api/docs/models/gpt-6.1-terra) (BTN-469) | 2026-10-27 | $1 input, $0.05 cached input, $5 output, $1.25 cache write; over 272k input and cache double, output 1.5× |
| `gpt-5.4-mini` | OpenAI | — | Codex's default in an old `config.toml`; no cache write price |
| `deepseek-v4.1-flash` | the off-peak rates of [DeepSeek's Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/) | 2026-10-28 | $0.15 input, $0.003 cache read, $0.60 output; the prefix also covers OpenCode Zen's free `deepseek-v4.1-flash-free`, priced at the API rate whatever OpenCode charges |
| `minimax/minimax-m3.1-flash` | the full rates of OpenRouter's public model list (`/api/v1/models`) | 2026-11-08 | $0.15 input, $0.015 cache read, $0.60 output; the model as OpenCode writes it |
| `big-pickle` | OpenCode Zen's free model | — | 0 |
| `google-gemini*`, `google-gemma*` | LiteLLM's free tier | — | 0 ([`time.md`](time.md#the-classifier-srcclassifyts)) |

Tally has no time-dependent price, so a provider whose rate changes over the day is priced at the rate in force most hours of it. DeepSeek doubles its rates for 7 hours on weekdays (01:00–04:00 and 06:00–10:00 UTC, excluding Chinese public holidays): the off-peak rate is taken, a lower estimate. OpenRouter halves MiniMax's for 10 hours (15:00–01:00 UTC): the full rate is taken, an upper estimate of a night run (BTN-844: the first task cost $0.185 on OpenRouter's activity page, all of it in the cheap window). Both stay config entries to update when the terms change.

### Real spend on a key (BTN-860)

The cost above is an estimate by price; an OpenRouter key tells what it has really spent (`usage` of `GET /api/v1/key`), which differs by OpenRouter's choice of provider and its discounts.

- **The reads.** For an OpenCode account folder on an OpenRouter key, Even Keel (`KeySpend`, the root's `src/account/spend.ts`) reads `usage` before each turn of a chain session (launch and resume, a 5 s timeout), at the end of each turn (the session monitor sees `busy` end) and then once a minute for 10 minutes after the account's last turn.
- **Whose growth.** The growth between two reads goes to the session that ran in between. When none ran, it goes to the account's last session while those 10 minutes last, so a late growth is not lost; after them it is nobody's (the key was used outside the chain). Two sessions in one interval, or busy at once on one key, are marked shared: their spend cannot be told apart, and they keep the estimate.
- **A restart.** The reads are kept only in memory, so a restart loses what the key spent up to the first read after it. A session busy before that first read (its turn went on through the restart, or the read before it failed) is marked shared and keeps the estimate, instead of a real spend that misses the turn's start (BTN-871). A session idle at the restart keeps what was read before it and loses only a late growth of its last turn.
- **In Tally.** The rows are Even Keel's `key_spends` (state step 35); the collector copies them whole into its own `key_spends` at each run (`syncKeySpends`; when the read fails, the copy stays). The view `message_paid` is `message_costs` with `paid`: a session's real spend laid over its responses in proportion to their cost, or evenly when none is priced; every other response pays its `cost`.
- **On `/stats`** the task table and a task's sessions show the paid sum and, where some of it is real spend, the estimate in a tip; the period's totals, the chart and the breakdowns stay on the estimate.

### Per task and milestone

`task_costs` — per task: responses, sessions, tokens, cost, limit shares, and the keep-warm pings. `milestone_costs` — per project and milestone (`tasks.milestone`): tasks, done ones, sessions, responses, cost, limit shares. The project is the key of the task id, so a release clone sharing a tracker project counts under it and the milestone tells the release apart (BTN-172); a task the trackers do not know, or without a milestone, is the row with an empty milestone.

An independent count from the transcripts matched `task_costs` and `message_costs` in every token kind and to the cent, and the page's `history` and `period` matched direct SQL ([`../verified/page.md`](../verified/page.md)). A response the CLI copies into a resumed session's file stays with the session that made it; responses of deleted account folders live only in the database.

## Limit share

- **The snapshots.** Limits come from Even Keel: `GET <evenKeelUrl>/api/state` (`EVEN_KEEL_URL` over the config), `account.accounts[].limits`, with both the statusline and the `/usage` poll for each account. If Even Keel does not answer — `state/rate-limits.json` (statusline only, the account by `configDir`). A snapshot with the same time is not duplicated. The collector never runs `claude -p /usage` itself: an extra poll gives a 429 on the shared token. On the maintainer's database snapshots exist since 2026-10-03 15:45: before, Even Keel kept only the latest value and the transcripts have no percentages, so earlier shares cannot be recovered.
- **`limit_steps`**: snapshots with a window number (`wnd`, a new one when the reset moved by more than 30 min from the previous snapshot: the sources round the reset differently) and the highest percentage of the window before the snapshot (`prev_max`).
- **`limit_intervals`**: neighbouring snapshots of one account's window give an interval and an increase, `max(0, current − prev_max)`. Not from the previous snapshot: `statusline` and `/usage` round differently and alternate in one series (21 → 22 → 21 → 22), and every zigzag would count anew (BTN-51). When the window changed, the increase is the current percentage, and the interval starts no earlier than the new window (`reset − 5 h` / `− 7 days`). The first snapshot of a window gives no interval.
- **`limit_windows`**: a window per account — reset, start, peak, the first and last snapshot; the "In weekly limits" tile takes its peaks.
- **`limit_shares`**: an interval's increase is divided among the account's responses in it (`since < at <= till`) in proportion to their cost at API prices. It is one pass, a sort rather than a product of responses and intervals: the intervals of one account and window never overlap and their ends are unique snapshot times, so responses and interval ends merge into one stream sorted by time descending, the running minimum of the ends gives each response its nearest end at or after it (an end sorts before a response at the same moment), and an equality join on that end with `at > since` keeps the response.
- **An estimate**: the percentage is an integer, snapshots come every few minutes, and the desktop app mixes its own sign-in into the `global` account.

### Keep-warm pings

A keep-warm ping (`docs/sessions/cache.md`) is a fork without a transcript, yet it takes from the account's limit. Even Keel keeps each answered ping in its state database (`warm_pings`, state step 70; a machine elsewhere sends it as the link record `warm.ping`), and each run copies the new ones (`warmPings` in `src/warm-pings.ts`, `syncWarmPings`; a ping Tally holds stays as it is). A machine's ping goes under the account its messages do (`<key>@<machine>`); the hub's has no machine.

- The pings are not rows of `messages`: a ping is no response of its session, and counting it as one would change the count of responses and the gaps between them.
- `warm_ping_costs` prices a ping as `message_costs` prices a response (the longest config prefix, the long prompt rates; a ping names no provider, so no catalogue price), and gives it `ping_id` (`warm:<session>:<epoch ms>`) and its task through `task_moves`.
- `limit_shares` takes the pings into its stream beside the responses, a ping's `ping_id` in `message_id`; `task_costs` counts their shares and adds `warm_pings` and `warm_cost` (its `cost` stays the responses').

### The stored shares

`limit_shares` is a window over every response of the history, ~2.4 s on the live database. `/stats` and the badge read `limit_shares_stored` instead (`seven` in the root's `src/stats/base-sql.ts`): a materialized view of the same columns, with the unique index `(message_id, span, till)` a concurrent refresh needs.

- **The refresh** is whole (`refresh materialized view concurrently`, `REFRESH_LIMIT_SHARES` in `src/limit-shares-stored.ts`): by the collector at the end of a run that read lines, added limit snapshots or copied new pings (`refreshShares`; the summary line says `limit shares refreshed in N s` or `kept`), and by the hub after a machine's post with responses. A full refresh takes in a late response by itself, which is why it is no table of shares the collector keeps (BTN-1351); a read during the refresh reads the previous rows.
- **The lag**: the shares lag the messages at most until the end of the run that brought them. A changed price or a moved task alone waits for the next run with rows; `/stats` takes the task from `message_costs`, not from the shares.
- `task_costs` keeps reading `limit_shares`: only ad-hoc SQL and the audit read it, they want the shares of this moment, and a few seconds are fine there. The reader role gets `select` through the writer's default privileges (`tally/deploy`).
- A later migration step that drops or changes the columns of `limit_shares` or a view under it (`message_costs`, `limit_intervals`, `warm_ping_costs`) drops and recreates `limit_shares_stored` too.

## Signs (`src/signs.ts`)

Where a session was marking time — without an LLM, from the projected rows in `session_activity`. A stream is the main session and each subagent separately (`src/stream.ts`). Kinds:

- `failures` — `failureRun` (3) failed calls in a row; `denied` — `deniedRun` (1) permission refusals in a row;
- `repeat` — one command (`Bash` and others — by the command text without extra spaces) `repeatRun` (2) times without an edit between them (`Edit`, `Write`, `MultiEdit`, `NotebookEdit` reset the count);
- `reread` — one file read with `Read` `rereadCount` (5) times in a stream between compactions (the path case-insensitive and with `/`; the count restarts after a compaction, as it does in a handoff's new session);
- `no_commit` — `noCommitReplies` (150) responses of the main session in a row without a successful `git commit`;
- `rewind` — several user prompts under one parent (`/rewind` or editing a message);
- `compact` — context compaction, `handoff` — the session was started by a handoff (`relay`/`checkpoint`/`restart` from Even Keel's log). These two are marks: they give no spans themselves, only get appended to the span they fall into.

Signs of one stream that overlap in time are merged into a span (`spans`, the id is the SHA-1 of the session, the agent and the edge `uuid`s). A session is recomputed when it has a new last row or the key changed — the SHA-1 of the signs version (`SIGNS_VERSION`), the rules and the launch reason.

The rules are `signs` in `tally.config.json` over the defaults, integers ≥ 1. Calibration on 2026-10-03 over all sessions: without a commit p95 is 102 responses, the threshold 150; files reread ≥ 5 times — 18; series of ≥ 3 failures — 16; refusals — 40; repeats ≥ 2 — 15; there was no `/rewind` in the data.

## Tasks from the trackers

Tally learns a task only after its first session, or as a related task of one that had sessions: such a neighbour has no sessions of its own, is not asked for by itself and is refreshed with the tasks it is related to; a task without sessions does not get into `task_repeats`. The tasks of the built-in tracker are the exception: all are read.

### Huly (`src/huly.ts`)

- **Credentials** come from the service, not the environment (BTN-200): the run gets `huly` (`HulyProfiles`, `src/huly-profiles.ts`), the Huly profile of each task's project, and `refreshTasks`/`reportTaskTimes` group the tasks by credentials, one connection per profile. The service builds it in the root's `src/stats/huly-profiles.ts` and leaves a turned-off profile (BTN-830) out of every part — its project, the fallback, `byId` — so a stopped Huly is not asked. `npm run tally` by hand has no service and uses the `HULY_*` of the environment.
- **Its own small client**; Even Keel's Huly adapter in the root's `src/huly/` is not used. By the task ids from `session_tasks` it reads the title, status, labels (no duplicates, case-insensitive) and `relations`, made symmetric. Related tasks outside the selection are fetched whole by id with a second query and written to `tasks` too, and the ids of their own relations with a third, so a neighbour's `related` is complete.
- **Fields** (BTN-55): `priority` (`urgent`, `high`, `medium`, `low`, `no-priority`), `estimate_h` (the `estimation` in hours; 0 — none), `component` (the name), `done` (a status of the `Won` category), `milestone` (the label, BTN-172), `created_at` (the issue's `createdOn`, BTN-362). A record taken before a field existed (a `title` and an empty `priority`) is asked again without waiting for the hour.
- **When asked**: a task not in `tasks` or with a record older than an hour. One Huly does not find is written with an empty title, so as not to be asked on every run. Huly unavailable — a line in the log, the run goes on. The api-client's noise on connecting ("no document found, failed to apply model transaction") is filtered out (`quietModelNoise`, the root's `src/huly/quiet.ts`).

### Where a task lives (BTN-66, BTN-1497, `src/task-homes.ts`)

A project's tasks may come from task feeds of other trackers and profiles, so the home is decided by the task, not by its project.

- **The built-in tracker's own.** A task it holds (read whole, below), or an old id `<source_key>-<N>` a switch off it left behind whose prefix no project or feed gives now (`HulyProfiles.prefixes`). The left-behind ids are `builtinLeftovers`: the closed tasks the copy skipped and the copied ones' old ids, by the keys of the `tracker_transfers` exports and, for a switch before them, of a finished `tracker_exports` copy whose target key the project carries now; a copy without a switch does not count.
  - Such a task takes nothing from the launch log but its title: `profile_id` is cleared and `url` is its card, `/p/<project id>?task=<KEY-N>`, or none for a left-behind id (`syncOwnedTasks`, which also clears an older run's values the log's `coalesce` would keep).
  - It is asked of no tracker, and its time is reported to none — neither Huly nor the GitLab or Jira project of the same prefix.
- **Every other task**, the feeds of a built-in project too, is where its launch read it. Each run copies from Even Keel's launch log (`taskSources`, the latest launch that recorded each field) the profile a task was read through (`profile_id`), its link (`url`) and, while the row has no title, its title (`syncTaskSources`); a new row is written as fetched at the epoch, so Huly is asked for its own tasks at once.
- **A Huly task** launched through a Huly profile is asked with that profile (`HulyProfiles.byId`), whatever its project runs on now; one whose profile is gone falls back to its project's.
- **Another tracker's.** `HulyProfiles.elsewhere` lists the id prefixes of projects and feeds on another tracker: Huly is not asked for them, nor through the default profile, and their title stays the log's. Their `status` and `done` come from Even Keel's archive of closed tasks (`closed_tasks`, read with the log; `closedStates` in `src/closed-tasks.ts`, `syncClosedTasks`, BTN-330): a task the chain saw closed is done with the status of its latest close, kept when the archive has none, and open without a status once the chain launched it again after that close; a GitHub or Linear task the chain never closed has neither.
- The `/stats` task table links a task by its `url`, else by the tracker's template.

### The built-in tracker (BTN-785, `src/builtin-tasks.ts`)

Its tasks live in Even Keel's state database, read with the log through `readStateDatabase`. Every run reads every task of the projects whose `tracker` is `builtin` now, named `<KEY>-<N>` as the chain names them, and writes them to `tasks` like Huly's records (`writeTasks`): title, status, labels, `relates` links both ways, priority (the neutral `none`…`urgent`), milestone, `created_at`, `done` (a status of the `Won` category), the estimate (`builtin_tasks.estimate` in minutes, as `estimate_h` in hours) and the component's name (BTN-1497). Tasks without sessions are written too, so a follow-up is in its original's `related` with its labels and date. A project that left the built-in tracker is skipped: its key names another tracker's tasks now. A task read so is left out of `closedStates`, so the archive does not put an older state over it.

### A project moved to another tracker (BTN-1076, `src/task-moves.ts`)

Once a built-in project has switched to the tracker its tasks were copied into (BTN-1074), each run reads its copied tasks of the stage `marked` from `tracker_export_tasks` and writes `<source_key>-<number>` → the new key into `task_moves`, so the task's statistics go on under the new key: every task view goes through `session_tasks`, so cost, times, the audit and the follow-ups count the old sessions for the new task. Before the switch the old task is the one the chain works, and no link is read. Links are only added or updated, never removed: a project Even Keel forgets keeps its tasks' links. The new task's `tasks` row, while no tracker gave it a title, takes the old task's.

### Follow-ups (BTN-362)

A task done badly is not reopened: a new task labelled `Bug` or `Переделка` (`Rework` on the built-in tracker) is filed over it and related to it. Huly records a relation on both tasks (checked on 2026-10-24), so a follow-up without sessions is in the original's `related`; Huly cannot be asked for the reverse (`relations._id` finds nothing). The view `task_followups` gives each task with a session the end of its last session (`max(sessions.last_at)`), `followups` and `followup_tasks` (by creation): its related tasks with either label (exact, as `rework`) created after that end. The time gives the pair its direction: of two related tasks the later one is the follow-up, and a bug the task's own session filed on the way does not count.
