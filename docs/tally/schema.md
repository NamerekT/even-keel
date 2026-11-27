# The schema

`src/schema.sql` is version 1; every later change is a migration step, listed in [`migrations.md`](migrations.md). "Migration step N" here is Tally's; "state step N" is one of Even Keel's own database (`docs/storage/steps.md`).

## Tables

- `lines` — rows with a `uuid`: session, agent, type, time. Service rows without a `uuid` (`ai-title`, `custom-title`, `queue-operation`, `file-history-*` …) are not stored; only session titles are taken from them.
- `line_raws` — the compressed raw row `raw jsonb` of each `lines` row, by its `uuid` (migration step 22; how it is compressed: [`collector.md`](collector.md#compressing-raw-rows-srccompactts)). It is apart so that a read of the narrow columns does not pull the JSON into the cache, and Postgres does with 512 MB of `shared_buffers` (`tally/deploy/README.md`). Only reparsing reads it: the one-time backfills (`MESSAGE_EFFORTS`, the `session_activity` projection) and the audit's deeper queries, joined by `uuid`. A batch writes both tables in one statement, the raw only for a row `lines` took; a machine's batch keeps `raw` in `LineRow`, and the hub splits it.
- `session_activity` (migration step 21) — the ordered inputs of Claude's signs, turns, steps and classifier excerpts: prompt candidates, short text, tool commands, result outcomes, background job ids. A batch writes them only for newly inserted `uuid`s, in the transaction that writes `lines`. `compaction_nodes`, filled by an insert trigger on `line_raws`, keeps boundary counters, summary lengths and attachment parents, so a summary and its boundary may come in different batches or out of order.
- `messages` — one API response (`message.id`). The CLI writes a response as several `assistant` rows, one block per row with a repeated `usage`, and the final `output_tokens` is in the last; merging takes the larger value of each kind of token and the earlier time. Columns:
  - session, agent, account (the file's account folder), project and its folder (`cwd` without the `.claude/worktrees/…` tail), task, branch, `entrypoint`, model, `speed`, `provider`, `machine`;
  - tokens `input`, `cache_write_5m`, `cache_write_1h`, `cache_read`, `output`; a cache write without a `cache_creation` breakdown counts as 5-minute;
  - `effort` — the row's top-level `effort` (`low` … `max`), the level the request went with; `perTurnEffort` is `null` in about a fifth of rows and is not taken. Rows loaded before `effort` was parsed got it once from their raw rows (`MESSAGE_EFFORTS` in `src/db-backfills.ts`, the mark `efforts` in `tally_meta`); transcripts older than the CLI's recording of it have none.
  - `<synthetic>` and `isApiErrorMessage` responses are no API responses and are not stored.
- `tool_calls` — a call (`tool_use`: name, the SHA-1 of the input for finding repeats, a short description as in Even Keel's feed) and its result (`tool_result`: time, `is_error`, error kind, the first 500 characters of the text). Kinds: `denied` — a permission refusal (the user or the auto-mode classifier), `hook` — `PreToolUse:…`/`PostToolUse:… hook error`, `error` — everything else. The call and the result write different columns of one row, so the load order does not matter.
- `sessions` — one row a session:
  - account, project, `machine`, the titles `custom_title` (set by the user) and `ai_title`, the task and reason from Even Keel's launch log, the first and last row;
  - `project_dir` — the folder of the first response; each run fills in the empty ones (`SESSION_FOLDERS` in `src/db-backfills.ts`);
  - `prompt` — the first human prompt of the main thread, up to 2000 characters, without slash commands and IDE context blocks (`src/prompt.ts`). An empty one is filled from the earliest candidate in `session_activity` by time and `uuid`, and is `''` when a session has none a day after its last row.
- `handoffs` — what each handoff gave the new session (`session_id`): `previous`, task, reason, the whole prompt, the note's path and text.
  - Even Keel saves a snapshot at every handoff (the `handoffs` table of its database, `src/chain/snapshots.ts`), and each run loads the new ones (`source = 'even-keel'`).
  - A handoff of the launch log without a snapshot is rebuilt from transcripts while they last (the CLI deletes them after 30 days): the prompt from the new session's first prompt, the note from the old session's last `Write` of the note's path and the `Edit`s after it (`source = 'transcript'`, `src/handoffs.ts`; a note that was only edited stays empty). A snapshot replaces a rebuilt row.
- `limit_snapshots` — snapshots of the `5h`/`7d` windows per account: percentage, reset, source, snapshot time ([`cost.md`](cost.md#limit-share)).
- `model_prices` — prices, rewritten on every run; `source` is `config` for a prefix of `tally.config.json` or `catalogue` for one exact `<provider>/<model>` of the models.dev catalogue; `long_*` — the long prompt rates, empty for a model without them ([`cost.md`](cost.md#the-price)).
- `key_spends` — Even Keel's real spends of sessions on their keys, copied whole at each run ([`cost.md`](cost.md#real-spend-on-a-key-btn-860)).
- `warm_pings` — Even Keel's keep-warm pings: session, time, machine, account, task, project, model and the tokens by kind ([`cost.md`](cost.md#keep-warm-pings)).
- `chat_sessions` — a project chat's session (`session_id`) and its chat's id, upserted from Even Keel's `chats` at each run (`chatSessions` in `src/chat-sessions.ts`). A chat keeps only its latest session there, so a link Tally holds is never dropped.
- `task_moves` — an old task id and the new one of a project moved to another tracker ([`cost.md`](cost.md#a-project-moved-to-another-tracker-btn-1076-srctask-movests)).
- `tasks` — the trackers' tasks ([`cost.md`](cost.md#tasks-from-the-trackers)).
- `files` — the incremental loading state ([`collector.md`](collector.md#what-is-read)).
- `signs`, `spans`, `sign_sessions` — signs, spans, and with which rules and up to which row a session was computed; `span_reasons` — a span's reason from the classifier ([`cost.md`](cost.md#signs-srcsignsts), [`time.md`](time.md#the-classifier-srcclassifyts)).
- `turns`, `turn_sessions` — turns of the main session, and with which key and up to which row a session was computed ([`time.md`](time.md#task-time-btn-55-srcturnsts)).
- `step_runs`, `step_sessions` — runs of long commands, and with which key a session was computed ([`time.md`](time.md#long-commands-btn-56)).
- The rule tables (`rule_*`) — [`rules.md`](rules.md).

## Views

The `audit_*` columns never change: the audit skill's queries rely on them, and `create or replace view` does not take a new column in the middle, so new things go into a view of their own.

- **Tasks.** `session_tasks` — a session's task ("A response's task" below). `message_costs` — a response's price and its session's task. `task_costs`, `milestone_costs`, `warm_ping_costs`, `message_paid` — [`cost.md`](cost.md). `task_followups` — a task's follow-ups ([`cost.md`](cost.md#follow-ups-btn-362)).
- **Spans.** `stuck_spans` — spans with a task and a reason. `task_repeats` — per task: sessions, handoffs by kind (`relay`, `checkpoint`, `restart`), spans, title, status, labels, `rework` (the label `Переделка` or `Rework`), related tasks.
- **The audit** ([`rules.md`](rules.md#session-audit-btn-53)): `audit_sessions` (a session: folder, task, launch reason, active minutes, request context and its peak, the share over 150k, cost, stuck spans and call errors), `audit_tasks` (the same sums per task, counted in the period of its first response), `audit_rules` (rule changes with a place and `undone`, a false pair of changes within a day).
- **Time.** `session_times` (per session: turns, active time, waiting), `task_times` (per task: sessions, turns, active, waiting, total), `task_estimates` (`audit_tasks` with time, estimate, `fact_ratio` — actual / estimate, priority, component, `done`, the recorded report and `model_family`, the most frequent model family by `familyOf`). `session_efforts` — a session's effort level, the most frequent of its main thread or `mixed` when it changed midway; join it to `audit_sessions` to compare levels.
- **Steps.** `step_runs_x`, `step_weeks`, `step_growth` ([`time.md`](time.md#long-commands-btn-56)).
- **Handoffs and compactions.** `handoff_notes` adds a handoff's sizes and the note's Markdown headings. `compactions` — one row per context compaction, to compare with a handoff:
  - session, agent, the boundary's `uuid` and time, from its `compactMetadata` the `trigger` (`auto`/`manual`), `pre_tokens`, `post_tokens`, `duration_ms`;
  - `summary_chars` — the summary's length, whole (the `…[+N]` cut added back);
  - `seq` — the n-th compaction of the stream, `next_at` — the next one's time or empty, so a session splits into segments and the one after a boundary is a virtual successor.
  - A compaction keeps the session and the file: the CLI writes a `system` row `compact_boundary`, then a `user` row with `isCompactSummary`, the boundary's child or, since about 2026-10, below the attachments written after the boundary with an earlier timestamp (the summary is prepared in the background, `duration_ms` drops to tens of ms). The summarizing call is not in the transcript: a compaction has no response, tokens or price here.

## A response's task

`messages.task` is the response's own task; `message_costs.task` is its session's (`session_tasks`, BTN-79). `/stats`, `task_costs`, the limit shares and the audit all count by the session's, so the start of a manual session before its branch is not lost and a session over two tasks goes wholly to the first; `message_costs` keeps a response's own task only for a session Tally does not know.

A response's own task comes from its branch `<key>-<number>/…`, else from its folder `.claude/worktrees/<key>-<number>`. A session's task (`session_tasks`) is decided in this order:

1. **A project chat's session** (`chat_sessions`) has no task at all, whatever the rest names.
2. **The launch** in Even Keel's log (`launches` of its database, except `postpone`/`skip` and the outcome of a fix of main, `landed`/`dropped`) wins over everything below, for older sessions too (`sessions.launch_task`).
3. **Its responses' tasks.** A task counts when a response's branch named it, when it is the task of the session's first response, or when more than half of the responses have it (migration step 23); the earliest such task is the session's. So a folder alone gives its task only to a session that started there or spent most of its responses there: a manual session in the main checkout that ran a few commands in a task's worktree gets no task from it, and its responses there count for no task either.
4. **A task named in the titles** replaces that one when the session's custom title, generated title or `prompt` (looked at in that order) names tasks of the same project but not that task: the first one named wins. A manual session in a checkout left on a task branch often works on another task (CBL-157 had 23 sessions of ten other tasks, $406, on its branch).
5. **A moved task**: an old id of `task_moves` gives the new one.
