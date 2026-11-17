-- The queries behind every number in cache-cliff.md.
-- Run against Tally: node <main checkout>/tally/bin/sql.mjs -n 0 -f docs/posts/cache-cliff.sql
-- The sample: Claude responses of the main thread (no subagents) of Claude Code sessions (CLI, VS Code, the desktop
-- app and Agent SDK sessions), 2026-09-01 .. 2026-11-17 13:00 UTC, all on Pro subscriptions, whose context was over
-- 20k tokens. A "pause" is the time since the previous response of the same session. A "rebuild" is a response that
-- wrote more than half of its context into the cache instead of reading it.
-- "chain" = a session Even Keel started for a task (it has a launch_task); "hand" = every other session.
-- Cost weights are list prices relative to input: input 1, 5-minute cache write 1.25, 1-hour write 2, read 0.1.

-- 1. The cliff: rebuilds by the pause before the response, both kinds of sessions together.
--    Post: under 5 min 184,023 / 0.2 %; 5-30 min 2,267 / 1.8 %; 30-55 min 147 / 0.7 %; 55-65 min 18 / 11 %;
--    65-120 min 13 / 77 %; 2h+ 11 / 91 %. A rebuilt response costs 14-16x what it would have cost warm.
with m as (
  select m.session_id, m.at, m.input, m.cache_write_5m as w5, m.cache_write_1h as w1, m.cache_read as r,
         case when s.launch_task is not null then 'chain' else 'hand' end as kind,
         lag(m.at) over (partition by m.session_id order by m.at) as prev_at
  from messages m join sessions s using (session_id)
  where m.provider = 'anthropic' and (m.agent_id is null or m.agent_id = '')
    and m.entrypoint in ('cli', 'claude-vscode', 'sdk-ts', 'claude-desktop')
    and m.at >= '2026-09-01' and m.at < '2026-11-17 13:00'
),
g as (
  select *, extract(epoch from at - prev_at) / 60 as gap_min, input + w5 + w1 + r as ctx
  from m where prev_at is not null
),
b as (
  select kind,
    case when gap_min < 5 then 'a under 5 min' when gap_min < 30 then 'b 5-30 min' when gap_min < 55 then 'c 30-55 min'
         when gap_min < 65 then 'd 55-65 min' when gap_min < 120 then 'e 65-120 min' else 'f 2h+' end as pause,
    ctx, (w5 + w1) > 0.5 * ctx as rebuild,
    (input + 1.25 * w5 + 2 * w1 + 0.1 * r) / nullif(input + 0.1 * (r + w5 + w1), 0) as mult
  from g where ctx > 20000
)
select pause, count(*) as responses,
  count(*) filter (where rebuild) as rebuilds,
  round(100.0 * count(*) filter (where rebuild) / count(*), 1) as rebuild_pct,
  round(avg(ctx) / 1000) as ctx_avg_k,
  round(avg(mult) filter (where rebuild)::numeric, 1) as rebuild_cost_x
from b group by 1 order by 1;

-- 2. The same split by kind of session.
--    Post (hand / chain): 55-65 min 11 / 7 responses, 18 % / 0 % rebuilt; 65-120 min 9 / 4, 78 % / 75 %;
--    2h+ 9 / 2, 89 % / 100 %.
with m as (
  select m.session_id, m.at, m.input, m.cache_write_5m as w5, m.cache_write_1h as w1, m.cache_read as r,
         case when s.launch_task is not null then 'chain' else 'hand' end as kind,
         lag(m.at) over (partition by m.session_id order by m.at) as prev_at
  from messages m join sessions s using (session_id)
  where m.provider = 'anthropic' and (m.agent_id is null or m.agent_id = '')
    and m.entrypoint in ('cli', 'claude-vscode', 'sdk-ts', 'claude-desktop')
    and m.at >= '2026-09-01' and m.at < '2026-11-17 13:00'
),
g as (
  select *, extract(epoch from at - prev_at) / 60 as gap_min, input + w5 + w1 + r as ctx
  from m where prev_at is not null
),
b as (
  select kind,
    case when gap_min < 5 then 'a under 5 min' when gap_min < 30 then 'b 5-30 min' when gap_min < 55 then 'c 30-55 min'
         when gap_min < 65 then 'd 55-65 min' when gap_min < 120 then 'e 65-120 min' else 'f 2h+' end as pause,
    (w5 + w1) > 0.5 * ctx as rebuild
  from g where ctx > 20000
)
select kind, pause, count(*) as responses,
  round(100.0 * count(*) filter (where rebuild) / count(*), 1) as rebuild_pct
from b group by 1, 2 order by 1, 2;

-- 3. What the pauses cost: the extra over a warm cache of responses after a pause of 55 minutes or more, as a share
--    of all the spend; and the share of cache writes that were 1-hour ones (the subscription's cache).
--    Post: hand 0.22 %, chain 0.04 %; 1-hour writes 99.8 % and 99.9 %.
with m as (
  select m.at, m.input, m.cache_write_5m as w5, m.cache_write_1h as w1, m.cache_read as r,
         case when s.launch_task is not null then 'chain' else 'hand' end as kind,
         lag(m.at) over (partition by m.session_id order by m.at) as prev_at
  from messages m join sessions s using (session_id)
  where m.provider = 'anthropic' and (m.agent_id is null or m.agent_id = '')
    and m.entrypoint in ('cli', 'claude-vscode', 'sdk-ts', 'claude-desktop')
    and m.at >= '2026-09-01' and m.at < '2026-11-17 13:00'
),
u as (
  select kind, extract(epoch from at - prev_at) / 60 as gap_min, w5, w1,
    input + 1.25 * w5 + 2 * w1 + 0.1 * r as units, input + 0.1 * (r + w5 + w1) as warm_units
  from m
)
select kind,
  round(100.0 * sum(w1) / nullif(sum(w1 + w5), 0), 1) as writes_1h_pct,
  round(100.0 * sum(units - warm_units) filter (where gap_min >= 55) / sum(units), 2) as extra_after_55m_pct
from u group by 1 order by 1;
