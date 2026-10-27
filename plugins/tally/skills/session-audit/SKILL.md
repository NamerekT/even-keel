---
name: session-audit
description: Audit of Claude Code (and Codex) sessions from Even Keel's Tally database — compares a recent period with an earlier one (before and after a rule edit, a model, a checkpoint threshold) and finds what got slower or more expensive and what to change; includes a review of handoffs and context compactions. Use when the user says tasks got slower or more expensive, sessions eat tokens, the limit burns faster, asks why task X cost so much, asks for a session audit or a weekly audit, what changed after a rule edit, or what a handoff cost. Works from any project. Not for collecting data — the collector is not run from here.
---

# Session audit from the Tally database

Tally, the collector built into Even Keel, has the numbers ready: it reads the session transcripts into Postgres every five minutes (the embedded PGlite or your own server). An audit only reads them: it writes nothing to the database and does not run the collector. Go to raw transcripts only if the database lacks what is needed (`lines.raw` rows are cut to 2000 characters), and say so in the report.

## Query script

The launcher is `bin/sql.mjs` of this plugin: two folders above this skill's base directory (the «Base directory for this skill» line at the top). Below it is `$TALLY_SQL`:

```bash
TALLY_SQL="<plugin folder>/bin/sql.mjs"
node "$TALLY_SQL" <<'SQL'
select …;
SQL
```

- The launcher runs Tally's own `tally/bin/sql.mjs` from Even Keel's checkout, which it finds by `EVEN_KEEL_HOME`, else in the folders above the plugin, else by asking the running Even Keel (`EVEN_KEEL_URL`, by default `http://127.0.0.1:4747`). If it says the checkout is not found, ask the user for the folder and pass it as `EVEN_KEEL_HOME=<folder> node "$TALLY_SQL" …`.
- SQL as an argument, `-f file` or through stdin (as above: a heredoc writes nothing to disk). Several queries separated by `;` — several tables. Long queries go into the session's scratch folder and run with `-f`.
- `-n 40` — rows per table (40 by default, `0` — all), `-w 60` — cell width (`0` — no cap), `--csv`. Line breaks in cells print as `⏎`.
- The transaction is read-only: `insert` and the like are refused. Times print in UTC.
- The database is the one Even Keel's stats use: with `TALLY_DB_HOST` in Even Keel's `.env` — that Postgres as the `tally_reader` role; otherwise the embedded one, reached through the Even Keel service's port. If the service is down the script says so — do not run the collector instead.
- Run it from a shell with heredocs (bash, zsh; Git Bash on Windows), not PowerShell.
- `relation "…" does not exist` — the collector has not migrated the schema yet (it runs every 5 min). Wait, do not run it.

## Audit views

- `audit_sessions` — a session: `dir` (the folder without the drive letter, lowercase, `/`, without `.claude/worktrees/…`), `task`, `key` (the task prefix), `launch_reason` (`relay`/`checkpoint`/`restart`/… — Even Keel's launch log; empty for a session started by hand), `first_at`, `last_at`, `active_min` (active time by transcript turns, without waits on questions and, for Even Keel sessions, on permissions), `model` (of the first answer), `requests`, `ctx_sum`, `ctx_peak`, `over150`, `entry_ctx` (the context of the first answer), `cost` (with subagents), `main_cost`, `unpriced`, `stuck_cost` (answers inside stuck spans), `tool_calls`, `tool_errors`, `tool_denied`, `title`. A request's context is the whole prompt (input + cache read and write), main thread only; money includes subagents.
- `audit_tasks` — a task over all its sessions, assigned to the period of its first answer: the same sums plus `sessions`, `relays`, `checkpoints`, `restarts`, `models`, `spans`, `rework`, `title`, `status`, `labels`, `related`.
- `audit_rules` — rule changes: `at`, `display`, `kind` (`claude_md`, `skill`, `hook`, `settings`, `agent`, `memory`), `source`, `added`/`removed`, `place` (`global` or the project folder), `undone` (the same file went back to its earlier text within a day — a false pair, not an edit).
- `task_estimates` — `audit_tasks` (`task`, `key`, `dir`, `first_at`, `last_at`, `sessions`, `cost`) plus time and estimate: `active_min`, `wait_min` (waiting for the user), `total_min` (first turn to last), `estimate_h`, `fact_ratio` (actual / estimate), `priority`, `component`, `done`, `reported_h`, `model_family` (`opus`/`sonnet`/`haiku`/`gpt`, the most frequent over the sessions). `session_times` — the same per session: `turns`, `active_s`, `wait_s`.
- Steps — the agent's long commands (tests, builds, merges): `step_runs_x` — a run (`step`, empty — no rule, then `signature`; `started_at`, `seconds`, `mode`, `end_by`, `outcome` — `fail`/`timeout`/`killed`, `cold` — the first in its worktree and branch, `task`, `project`), `step_weeks` — by project, step and UTC week: `n`, `p50`, `p90`, `max`, `cold`, `failed`; `step_growth` — a week against the previous week with runs: `prev_p50`/`prev_p90` and `grew_p50`/`grew_p90` (grew ≥ 1.5× and by ≥ 10 s with ≥ 5 runs on both sides).
- The rest: `rule_imports` (the reasons logged for rule edits: target, purpose, reason, task — only if the user installed Tally's rule hook), `stuck_spans` (spans with the classifier's cause and note — only if the classifier is configured), `tool_calls`, `signs`, `limit_shares`, `handoffs` and `handoff_notes`, `compactions` (section 8).

The schema in full is in `docs/tally.md` of Even Keel's checkout; read its section only when a column here is not enough.

**What comes from the tracker.** `title`, `status`, `labels`, `related`, `rework` (the label `Переделка`), `estimate_h`, `priority`, `component` and `done` are fetched from Huly, hourly; a task from another tracker has only the title Even Keel's launch log gave. Check first what the project has:

```sql
select count(*) as tasks, count(*) filter (where estimate_h > 0) as estimated, count(*) filter (where done) as done,
  count(component) as with_component
from task_estimates where key = 'ACME';
```

No `done` — the "closed tasks" columns and the estimate accuracy below are empty: drop them from the report and say the tracker gives no statuses, rather than reading zeros as a result.

## 1. The project

`dir` — the root of the current project's main checkout: `/src/acme-shop` for `C:\src\acme-shop` or `/home/me/src/acme-shop` for `/home/me/src/acme-shop`. `key` — the project's task key (in its `CLAUDE.md`, its Even Keel settings or its branch names); if there is none — the most frequent key of this folder's sessions:

```sql
select key, count(*) as sessions, round(sum(cost)) as usd, max(last_at) as last
from audit_sessions where dir = '/src/acme-shop' or starts_with(dir, '/src/acme-shop/')
group by 1 order by 2 desc;
```

A project's session is one with a task of its key, and without a task — by folder (`coalesce(key = …, dir …)` in the queries below). If the user asked about all projects — drop the project filter.

## 2. The period

- The user named a period or tasks ("these three went slowly") — take what was named. For tasks — their sessions and dates; the "base" — similar tasks before them (as many days before the first one).
- Not named — "now" runs from the project's last rule edit (global or its own), the "base" is a span of the same length before it. Memory edits (`memory`) and `undone` are not a starting point: sessions write memory all the time. Candidates and the sample after each:

```sql
with p(dir, key) as (values ('/src/acme-shop', 'ACME')),
s as (select a.* from audit_sessions a cross join p
  where a.requests > 0 and coalesce(a.key = p.key, a.dir = p.dir or starts_with(a.dir, p.dir || '/'))),
r as (select r.* from audit_rules r cross join p
  where not r.undone and r.kind <> 'memory' and (r.place = 'global' or r.place = p.dir or starts_with(r.place, p.dir || '/')))
select r.at, r.kind, r.source, r.added, r.removed, r.display,
  (select count(*) from s where s.first_at >= r.at) as sessions_after,
  (select count(*) from audit_tasks t, p where t.key = p.key and t.first_at >= r.at) as tasks_after
from r order by r.at desc limit 15;
```

  and the logged reasons: `select at, precision, purpose, reason, task, files from rule_imports order by at desc limit 10;` (empty without the rule hook).
- The sample threshold is the one of the before/after comparisons on Even Keel's `/stats` page (the setting `stats.compare`, by default 5 tasks, 10 sessions, 7 days): at least 5 tasks and 10 sessions on each side. Fewer after the last edit — "now" is the last 7 days, the "base" the 7 days before them, and the report says why. Name the edits after which there is enough data — the user may pick one of them.
- A side below the threshold — "too little data" instead of conclusions about it; the numbers may be shown but not interpreted.

## 3. Symptom → metrics

| Complaint | Look at |
|---|---|
| more expensive, "eats tokens" | median task cost, $ per request, mean context, share > 150k, entry context |
| the limit runs out faster | the same plus `limit_shares` by project |
| slower | tasks' `active_min`, median time of a closed task and actual / estimate, waiting, sessions per task, handoffs, stuck spans; steps got longer — `step_growth`, `step_weeks`, share of cold and failed runs |
| estimates off | share of closed tasks within ×1.5 of the estimate, median actual / estimate, breakdown by model and component (`task_estimates`) |
| "goes in circles", redoes work | share of spend in stuck spans, tool errors and denials, `rework`, re-read files |
| lots of talk outside tasks | share of spend of sessions without a task |
| handoffs or compactions cost too much | section 8 |

## 4. "Now" against the "base"

There may be more than two periods (A/B/C). `skip` — outlier tasks, empty at first:

```sql
with p(dir, key, skip) as (values ('/src/acme-shop', 'ACME', array[]::text[])),
periods(side, lo, hi) as (values
  ('base', '2026-09-20'::timestamptz, '2026-09-27 19:00'::timestamptz),
  ('now', '2026-09-27 19:00', now())),
s as (select x.side, a.* from audit_sessions a join periods x on a.first_at >= x.lo and a.first_at < x.hi cross join p
  where a.requests > 0 and coalesce(a.key = p.key, a.dir = p.dir or starts_with(a.dir, p.dir || '/'))
    and coalesce(a.task <> all(p.skip), true)),
t as (select x.side, a.* from audit_tasks a join periods x on a.first_at >= x.lo and a.first_at < x.hi cross join p
  where a.key = p.key and a.task <> all(p.skip)),
ss as (select side, count(*) as sessions, round(sum(cost)) as usd,
    round(sum(ctx_sum)::numeric / nullif(sum(requests), 0) / 1000) as ctx_k,
    round(100.0 * sum(over150) / nullif(sum(requests), 0)) as over150_pct,
    round(sum(main_cost) / nullif(sum(requests), 0), 3) as usd_req,
    round((percentile_cont(0.5) within group (order by entry_ctx))::numeric / 1000) as entry_k,
    round(100 * sum(stuck_cost) / nullif(sum(cost), 0)) as stuck_pct,
    round(100 * sum(cost) filter (where task is null) / nullif(sum(cost), 0)) as no_task_pct,
    round(100.0 * sum(tool_errors) / nullif(sum(tool_calls), 0), 1) as err_pct,
    round(100.0 * sum(tool_denied) / nullif(sum(tool_calls), 0), 1) as denied_pct,
    sum(unpriced) as unpriced
  from s group by side),
ts as (select side, count(*) as tasks,
    round((percentile_cont(0.5) within group (order by cost))::numeric, 2) as task_med,
    round((percentile_cont(0.9) within group (order by ctx_peak))::numeric / 1000) as peak_p90_k,
    round(avg(sessions), 2) as ses_task,
    round((percentile_cont(0.5) within group (order by active_min))::numeric) as min_med,
    count(*) filter (where rework) as rework
  from t group by side),
e as (select x.side, a.* from task_estimates a join periods x on a.first_at >= x.lo and a.first_at < x.hi cross join p
  where a.key = p.key and a.task <> all(p.skip) and a.done and a.active_min > 0),
es as (select side, count(*) as closed,
    round((percentile_cont(0.5) within group (order by active_min))::numeric) as done_min_med,
    round((percentile_cont(0.5) within group (order by wait_min))::numeric) as wait_min_med,
    count(fact_ratio) as estimated,
    round(100.0 * count(*) filter (where fact_ratio between 1 / 1.5 and 1.5) / nullif(count(fact_ratio), 0)) as within_pct,
    round((percentile_cont(0.5) within group (order by fact_ratio))::numeric, 2) as ratio_med
  from e group by side)
select x.side, ss.sessions, ts.tasks, ss.usd, ss.ctx_k, ss.over150_pct, ss.usd_req, ts.task_med, ts.peak_p90_k,
  ts.ses_task, ts.min_med, es.closed, es.done_min_med, es.wait_min_med, es.estimated, es.within_pct, es.ratio_med,
  ss.entry_k, ss.stuck_pct, ss.no_task_pct, ts.rework, ss.err_pct, ss.denied_pct, ss.unpriced
from periods x left join ss using (side) left join ts using (side) left join es using (side) order by x.lo;
```

Columns: mean context per request (`ctx_k`), share of requests > 150k, $ per main-thread request, median task cost, p90 of a task's peak window, sessions per task, median active minutes of a task; for closed tasks — their number, median active minutes and user waiting, how many of them have an estimate, the share within ×1.5 of the estimate (`within_pct`) and median actual / estimate (`ratio_med`, > 1 — underestimate); then the median entry context, the shares of spend in stuck spans and without a task, tasks marked as rework, errors and denials per 100 calls, answers of models with no price (`unpriced`). A session belongs to the period of its first answer, a task to that of its first answer and with all its cost. Estimate accuracy — only over closed tasks with an estimate; fewer than 5 such on either side — "too little data". Breakdown by component — `select model_family, component, count(fact_ratio), percentile_cont(0.5) within group (order by fact_ratio) from e group by 1, 2` (in the same CTE).

**Always a cut by model, next to the table.** Run labels move small tasks to cheap models, and the median task cost falls even if the tasks of the expensive model got no cheaper. Compare task cost and time within one model:

```sql
with p(key, skip) as (values ('ACME', array[]::text[])),
periods(side, lo, hi) as (values
  ('base', '2026-09-20'::timestamptz, '2026-09-27 19:00'::timestamptz),
  ('now', '2026-09-27 19:00', now())),
e as (select x.side, x.lo, a.* from task_estimates a join periods x on a.first_at >= x.lo and a.first_at < x.hi cross join p
  where a.key = p.key and a.task <> all(p.skip))
select side, coalesce(model_family, '?') as model, count(*) as tasks, count(*) filter (where done) as closed,
  round(sum(cost)) as usd,
  round((percentile_cont(0.5) within group (order by cost))::numeric, 2) as usd_med,
  round((percentile_cont(0.5) within group (order by cost) filter (where done))::numeric, 2) as done_usd_med,
  round((percentile_cont(0.5) within group (order by active_min) filter (where done))::numeric) as done_min_med,
  count(fact_ratio) filter (where done) as estimated,
  round((percentile_cont(0.5) within group (order by fact_ratio) filter (where done))::numeric, 2) as ratio_med
from e group by side, lo, model_family order by lo, model_family;
```

Fewer than 5 tasks of a model on either side (closed ones, when the tracker gives statuses) — do not interpret its row.

## 5. What changed between the periods

- Rule edits in the window: `audit_rules` over `[base.lo, now.hi)` of the same project, without `undone`; memory as one line with a count. Target and reason — `rule_imports` over the same window (`purpose`: economy, quality, process, infrastructure).
- Models: `select x.side, a.model, count(*), round(sum(a.cost))` over `s` from the query above.
- The mix of tasks: the top tasks of "now" with their share of spend (below). A task or a related group (`related`, a common subsystem in the titles) over ~25% of the period's spend is an outlier: show it separately and recompute section 4 with it in `skip`.

## 6. Deeper

```sql
-- The most expensive (or: order by active_min desc — the slowest) tasks of the period
with p(key, lo, hi) as (values ('ACME', '2026-09-27 19:00'::timestamptz, now()))
select t.task, round(t.cost, 2) as usd, round(100 * t.cost / sum(t.cost) over ()) as pct, round(t.active_min) as min,
  t.sessions as ses, t.relays + t.checkpoints + t.restarts as handoffs, round(t.ctx_peak / 1000.0) as peak_k,
  round(t.entry_ctx / 1000.0) as entry_k, t.spans, round(t.stuck_cost, 2) as stuck, t.tool_errors as err,
  t.tool_denied as den, t.rework, t.status, t.title
from audit_tasks t cross join p where t.key = p.key and t.first_at >= p.lo and t.first_at < p.hi
order by t.cost desc limit 10;

-- A task's sessions
select session_id, launch_reason, model, first_at, round(active_min) as min, requests, round(ctx_peak / 1000.0) as peak_k,
  round(entry_ctx / 1000.0) as entry_k, round(cost, 2) as usd, round(stuck_cost, 2) as stuck, tool_errors, title
from audit_sessions where task = 'ACME-123' order by first_at;

-- A task's stuck spans with the classifier's cause
select from_at, to_at, kinds, reason, note from stuck_spans where task = 'ACME-123' order by from_at;

-- A task's re-read files and tool errors
with ids as (select session_id from session_tasks where task = 'ACME-123')
select brief, count(*) as reads, count(distinct session_id) as sessions from tool_calls
where session_id in (select session_id from ids) and name = 'Read' group by brief having count(*) > 2 order by 2 desc limit 10;
with ids as (select session_id from session_tasks where task = 'ACME-123')
select name, error_kind, count(*), min(error_text) as sample from tool_calls
where session_id in (select session_id from ids) and is_error group by 1, 2 order by 3 desc limit 10;

-- Steps that grew within a week, and a step's series by week
select project, step, week::text as week, n, round(prev_p90) as was_p90, round(p90) as p90, grew_p50, grew_p90
from step_growth where (grew_p50 or grew_p90) and week >= now() - interval '35 days' order by week desc, project, step;
select week::text as week, n, round(p50) as p50, round(p90) as p90, round(max) as max, cold, failed
from step_weeks where project ilike 'acme-shop' and step = 'vitest' order by week;
```

`week` is the date of the Monday; without `::text` the script prints it as local midnight in UTC (`2026-09-27 22:00` instead of `2026-09-28`).

Over the whole period — the same without the task filter, through `s`. Stuck causes: `unclear_task`, `broken_tooling`, `debug_loop`, `waiting_user`, `limit_env`, `normal`, `other`.

## 7. The report

In the user's language, short:

1. **Period and sample** — the dates of "base" and "now", why these (an edit, named by the user, or 7 days — too little data after an edit), tasks and sessions on each side.
2. **Metrics table** — "base", "now", the change; the sample next to it. Below the threshold — "too little data". Under it — the cut by model (section 4): a conclusion about task cost is drawn from it, not from the overall median.
3. **What changed** — rule edits with target and reason, models, the mix of tasks; an outlier separately, with numbers without it.
4. **Deeper** — 2–5 tasks that show the cause: sessions, stuck spans with their notes, re-reads, errors.
5. **Conclusions and proposals** — in order of usefulness, with the expected effect on a metric from the table. Only what the numbers show. Rule edits not silently: as a separate task or with the user's consent.

## 8. Handoffs and compactions

A handoff is a new session of a task taking the place of the previous one: at a checkpoint (the session wrote a note and ended its turn with `CHECKPOINT: <path>`, from Even Keel's `checkpoint` plugin), at a limit with a cold cache (`relay`), on a change of model or account, or by the "New session" button (`restart`). A compaction is the CLI's own handoff inside one session: the context is replaced by a summary. The question is the same for both: what the next stretch of work took over and what it had to dig up again, and what that cost.

- `handoffs` — `session_id` (the new session), `previous`, `task`, `reason` (`relay` / `checkpoint` / `restart`), `at`, `source`, `prompt` (the new session's whole prompt), `note_path`, `note`. `source = 'even-keel'` is the snapshot Even Keel kept at the handoff, the note exactly as the new session read it; `source = 'transcript'` is rebuilt from transcripts (the note is the previous session's last `Write` of it plus the `Edit`s over it; `relay` and `restart` have none).
- `handoff_notes` — the same without the texts: `prompt_chars`, `note_chars`, `headings` (Markdown `#` lines, `# comments` in code blocks included).
- `compactions` — `session_id`, `agent_id` (empty — the main thread), `uuid` and `at` of the boundary, `trigger` (`auto`/`manual`), `pre_tokens` → `post_tokens`, `summary_chars`, `seq` (the n-th of the stream), `next_at` (the next one, empty — the segment runs to the session's end). The summarizing call itself is not in the transcript, so its price is not in the sums.
- Requests — `message_costs` (`agent_id is null` — the main thread; a request's context is `input + cache_read + cache_write_5m + cache_write_1h`). The context of request `n` includes the results of the calls of request `n − 1`.

Overview and a task's chain (`previous` not equal to the previous row's `session_id` — a session by hand or an unrecorded handoff between them):

```sql
select split_part(task, '-', 1) as key, reason, source, count(*),
  count(*) filter (where note_chars > 0) as notes, round(avg(note_chars)) as note_avg, round(avg(prompt_chars)) as prompt_avg
from handoff_notes group by 1, 2, 3 order by 1, 2, 3;

select to_char(at, 'MM-DD HH24:MI') as at, reason, source, left(previous, 8) as prev, left(session_id, 8) as s,
  note_chars, prompt_chars, array_to_string(headings, ' | ') as headings
from handoff_notes where task = 'ACME-123' order by at;
```

The ramp-up of each new session: `ramp_req` / `ramp_usd` — requests and money before its first edit (an `Edit`/`Write` other than the note), `reread_prev` — files the previous session also read, `bash_prev` — commands it ran word for word:

```sql
with h as (select * from handoff_notes where task in ('ACME-123')),
m as (select mc.session_id, mc.at, mc.cost, mc.input + mc.cache_read + mc.cache_write_5m + mc.cache_write_1h as ctx,
        row_number() over (partition by mc.session_id order by mc.at) as n
      from message_costs mc join h using (session_id) where mc.agent_id is null),
fe as (select t.session_id, min(t.at) as at from tool_calls t join h using (session_id)
       where t.name in ('Edit', 'Write', 'MultiEdit') and t.brief !~* 'handoff' group by 1),
ramp as (select m.session_id, count(*) as req, round(sum(m.cost), 2) as usd
         from m left join fe using (session_id) where m.at < coalesce(fe.at, 'infinity') group by 1),
calls as (select l.session_id, b->>'name' as name,
            lower(replace(coalesce(b->'input'->>'file_path', b->'input'->>'command'), '\', '/')) as arg
          from lines l, jsonb_array_elements(case when jsonb_typeof(l.raw->'message'->'content') = 'array'
            then l.raw->'message'->'content' else '[]' end) b
          where l.agent_id is null and l.type = 'assistant' and b->>'type' = 'tool_use' and b->>'name' in ('Read', 'Bash')
            and l.session_id in (select session_id from h union select previous from h)),
rep as (select h.session_id,
    count(*) filter (where c.name = 'Read') as reads,
    count(distinct c.arg) filter (where c.name = 'Read' and c.arg !~ '/\.temp/' and exists (select 1 from calls p
      where p.session_id = h.previous and p.name = 'Read'
        and regexp_replace(p.arg, '^.*/worktrees/[^/]+/', '') = regexp_replace(c.arg, '^.*/worktrees/[^/]+/', ''))) as reread_prev,
    count(*) filter (where c.name = 'Bash') as bash,
    count(*) filter (where c.name = 'Bash' and exists (select 1 from calls p
      where p.session_id = h.previous and p.name = 'Bash' and p.arg = c.arg)) as bash_prev
  from h join calls c using (session_id) group by 1)
select h.task, to_char(h.at, 'MM-DD HH24:MI') as at, left(h.session_id, 8) as s, h.reason, h.note_chars as note,
  round(a.entry_ctx / 1000.0) as entry_k,
  round((select ctx from m where m.session_id = h.session_id and n = 10) / 1000.0) as ctx10_k,
  round(a.ctx_peak / 1000.0) as peak_k, a.requests as req, round(a.cost, 2) as usd,
  r.req as ramp_req, r.usd as ramp_usd, rep.reads, rep.reread_prev, rep.bash, rep.bash_prev
from h join audit_sessions a using (session_id) left join ramp r using (session_id) left join rep using (session_id)
order by h.at;
```

What a ramp-up went on — a session's first requests with the growth of context and their calls:

```sql
with m as (select mc.message_id, mc.input + mc.cache_read + mc.cache_write_5m + mc.cache_write_1h as ctx,
        row_number() over (order by mc.at) as n
      from message_costs mc where mc.agent_id is null and mc.session_id like 'd3185955%')
select m.n, round(m.ctx / 1000.0, 1) as ctx_k, round((m.ctx - lag(m.ctx) over (order by m.n)) / 1000.0, 1) as d_k,
  string_agg(t.name || ' ' || left(coalesce(t.brief, ''), 90), ' ; ') as calls
from m left join tool_calls t on t.message_id = m.message_id
where m.n <= 16 group by m.n, m.ctx order by m.n;
```

Split the growth up to about the 10th request into a constant part (the note, `git status`/`log`, skills, the task from the tracker) and digging in the code (files, searches, builds). The constant part is the same for every handoff of a task: it is the price of one handoff.

Compactions side by side with handoffs — the part of a session after a boundary as a virtual successor of the part before it:

```sql
with c as (select c.*, st.task from compactions c left join session_tasks st using (session_id)
           where c.agent_id is null and st.task in ('ACME-123')),
m as (select c.uuid, mc.at, mc.cost, mc.input + mc.cache_read + mc.cache_write_5m + mc.cache_write_1h as ctx,
        row_number() over (partition by c.uuid order by mc.at) as n
      from c join message_costs mc on mc.session_id = c.session_id and mc.agent_id is null
        and mc.at > c.at and mc.at < coalesce(c.next_at, 'infinity')),
fe as (select c.uuid, min(t.at) as at from c join tool_calls t on t.session_id = c.session_id
         and t.at > c.at and t.at < coalesce(c.next_at, 'infinity')
       where t.name in ('Edit', 'Write', 'MultiEdit') group by 1),
ramp as (select m.uuid, count(*) as req, round(sum(m.cost), 2) as usd
         from m left join fe using (uuid) where m.at < coalesce(fe.at, 'infinity') group by 1)
select c.task, to_char(c.at, 'MM-DD HH24:MI') as at, left(c.session_id, 8) as s, c.seq, c.trigger,
  round(c.pre_tokens / 1000.0) as pre_k, round(c.post_tokens / 1000.0) as post_k, c.summary_chars as summary,
  round((select ctx from m where m.uuid = c.uuid and n = 1) / 1000.0) as entry_k,
  round((select ctx from m where m.uuid = c.uuid and n = 10) / 1000.0) as ctx10_k,
  (select count(*) from m where m.uuid = c.uuid) as req, (select round(sum(cost), 2) from m where m.uuid = c.uuid) as usd,
  r.req as ramp_req, r.usd as ramp_usd
from c left join ramp r using (uuid) order by c.at;
```

All compactions at once — drop the `st.task` condition (a session by hand may have no task).

A verdict per handoff in one word: **lost** (the new session dug up again what the previous one knew, and the note did not carry it), **repeated** (a deliberate repeat: the note said to re-run or re-measure), **clean**. For it, check three things:

1. Repeated runs: `bash_prev`, and the same run with other flags — by the run's keys (test names, case numbers) in `lines`.
2. A ruled-out idea taken up again: what the note ruled out (sections like "ruled out", "tried"), searched for in the next notes and in the new session's calls. A return with a new reason is fine if the note said on what case it was ruled out.
3. Where the previous session stood: its last calls before it wrote the note — a boundary (a commit, a green run, a finished measurement) or the middle of something (a trace, a trial edit, a run in the background).

Check the notes against what the `checkpoint` plugin asks for: what is done, what is left, hypotheses, what was tried and ruled out, the files and symbols that matter, the exact next command. A compaction keeps the session's loaded skills and tools but hands over a summary the agent did not write itself; a handoff starts cold and reads a note written with the next step in mind — name which one cost less on these tasks, and whether the session kept the task's language and rules after a compaction.

Report a handoff review as: the sample (tasks, handoffs by reason and source, empty notes, breaks in the chain); a line per handoff (`prev → s`, note length, `entry_k` → `ctx10_k`, `ramp_req` / `ramp_usd`, `reread_prev`, where the previous one stood, the verdict with what exactly); the common skeleton of the notes and what is missing; the price of a handoff; conclusions. A change to what the checkpoint hook asks for is a proposal to the user, not an edit on the way.

## Caveats

- Prices are API prices, the rates of `prices` in `tally/tally.config.json` of Even Keel's checkout by model: a ruler for comparing, not the bill of a subscription. A model without a rate counts in `unpriced` and adds no money.
- A session's task comes from Even Keel's launch log, the branch or the worktree folder: "continue" sessions on the same branch also count towards the task, and someone else's work done on a task's branch lands there too — for a task with suspiciously many sessions, check the sessions' `title` before drawing conclusions.
- The collector runs every 5 min, task statuses and labels hourly: the last minutes and fresh statuses may lag.
- The data starts when the collector first ran, and only from the transcripts the CLI still kept then (it deletes them after 30 days by default). Rule history starts there too; limit shares only from the first limit snapshot.
- Active time of VS Code and desktop sessions includes waits on permissions (they write no turn duration): compare the time of tasks done in different places with care.
- `reread_prev` compares paths without the worktree root and case; reading again is not always a loss — the file may have changed. `ramp_*` runs to the first edit: a session that only measures and reports gets a ramp-up over its whole length.
- The checkpoint threshold may have changed between the periods (`/stats` shows it and where it comes from): a lower `ctx_peak` of old handoffs is not a sign of better notes.
