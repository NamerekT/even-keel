-- The queries behind every number in compaction-week.md (BTN-254, BTN-258).
-- Run against Tally: node <main checkout>/tally/bin/sql.mjs -n 0 -f docs/posts/compaction-week.sql
-- Handoffs: tasks started 2026-10-10 .. 2026-10-19 20:34 UTC, the checkpoint plugin asking for a handoff note at ~150k.
-- Compaction: tasks started 2026-10-19 20:34 .. 2026-10-26 19:00 UTC, handoffs by context off, CLI auto-compact
-- with autoCompactWindow 250000.
-- Costs are API-equivalent prices from tally.config.json, not a subscription bill. The summary call of a
-- compaction is not priced: it is not in the transcript.

-- 1. The week: project BTN, closed tasks, Claude Opus only (no other agent in the task).
--    "long" = the task had at least one break: a handoff (before) or an auto-compaction (during).
--    "short" = no break at all: the control group, which sees every other change of the week too.
--    Post: long 42 vs 32 tasks, short 81 vs 81; $/1k output long 0.083 -> 0.093, short 0.085 -> 0.095;
--    $/request long 0.055 -> 0.058, short 0.050 -> 0.049; context long 123k -> 135k, short 103k -> 109k;
--    breaks per long task 1.5 handoffs vs 1.7 compactions; stuck spans per long task 0.43 vs 0.41,
--    long tasks with one 26 % vs 16 %, short 14 % vs 7 %; active minutes per 1k output long 0.230 -> 0.274,
--    short 0.272 -> 0.305; median long task $9.84 / 28 min vs $9.67 / 30 min.
with era(side, lo, hi) as (values
  ('handoffs', '2026-10-10'::timestamptz, '2026-10-19 20:34'::timestamptz),
  ('compaction', '2026-10-19 20:34', '2026-10-26 19:00')),
comp as (select st.task, count(*) as n from compactions c join session_tasks st using (session_id)
         where c.agent_id is null and c.trigger = 'auto' group by 1),
-- A compaction is itself a sign of the stuck-span detector, so a session that compacts gets a span over its
-- whole length that the classifier then calls "normal". Only spans with a real cause count as stuck here.
real as (select task, count(*) as n from stuck_spans
         where reason in ('broken_tooling', 'debug_loop', 'unclear_task', 'other') group by 1),
mc as (select st.task, sum(m.output) as output,
         count(*) filter (where m.agent_id is null) as main_req,
         sum(m.cost) filter (where m.agent_id is null) as main_cost,
         sum(m.input + m.cache_read + m.cache_write_5m + m.cache_write_1h) filter (where m.agent_id is null) as main_ctx,
         bool_or(m.model not like 'claude%') as other_agent
       from message_costs m join session_tasks st using (session_id) group by 1),
t as (select e.side, a.*, coalesce(comp.n, 0) as compactions, coalesce(real.n, 0) as real_spans, mc.output, mc.main_req, mc.main_cost, mc.main_ctx,
        case when e.side = 'handoffs' and a.checkpoints > 0 then 'long'
             when e.side = 'compaction' and coalesce(comp.n, 0) > 0 then 'long'
             when a.checkpoints = 0 and a.relays = 0 and coalesce(comp.n, 0) = 0 then 'short' end as kind
      from audit_tasks a
      join era e on a.first_at >= e.lo and a.first_at < e.hi
      join task_estimates te using (task)
      join mc using (task)
      left join comp using (task)
      left join real using (task)
      where a.key = 'BTN' and te.done and te.model_family = 'opus' and not mc.other_agent)
select kind, side, count(*) as tasks,
  round(1000 * sum(cost) / sum(output), 3) as usd_per_1k_out,
  round(sum(main_cost) / sum(main_req), 3) as usd_per_req,
  round(sum(main_ctx) / sum(main_req) / 1000) as ctx_avg_k,
  round(avg(checkpoints + compactions), 1) as breaks_per_task,
  round(avg(real_spans), 2) as stuck_per_task,
  round(100.0 * count(*) filter (where real_spans > 0) / count(*)) as stuck_tasks_pct,
  round(1000 * sum(active_min) / sum(output), 3) as active_min_per_1k_out,
  round((percentile_cont(0.5) within group (order by cost))::numeric, 2) as usd_median,
  round((percentile_cont(0.5) within group (order by active_min))::numeric) as min_median,
  round(sum(cost)) as usd_total
from t where kind is not null
group by kind, side order by kind, side desc;

-- 2. The same as 1 on a narrow window, before most of the week's other changes:
--    handoffs 2026-10-16 .. 2026-10-19 20:34, compaction 2026-10-19 20:34 .. 2026-10-22 18:00.
--    Post: long 31 vs 9 tasks, $/1k output 0.085 -> 0.094, short 0.087 -> 0.089 (65 vs 10 tasks);
--    $/request 0.054 -> 0.060, short 0.050 -> 0.050.
with era(side, lo, hi) as (values
  ('handoffs', '2026-10-16'::timestamptz, '2026-10-19 20:34'::timestamptz),
  ('compaction', '2026-10-19 20:34', '2026-10-22 18:00')),
comp as (select st.task, count(*) as n from compactions c join session_tasks st using (session_id)
         where c.agent_id is null and c.trigger = 'auto' group by 1),
mc as (select st.task, sum(m.output) as output,
         count(*) filter (where m.agent_id is null) as main_req,
         sum(m.cost) filter (where m.agent_id is null) as main_cost,
         sum(m.input + m.cache_read + m.cache_write_5m + m.cache_write_1h) filter (where m.agent_id is null) as main_ctx,
         bool_or(m.model not like 'claude%') as other_agent
       from message_costs m join session_tasks st using (session_id) group by 1),
t as (select e.side, a.*, coalesce(comp.n, 0) as compactions, mc.output, mc.main_req, mc.main_cost, mc.main_ctx,
        case when e.side = 'handoffs' and a.checkpoints > 0 then 'long'
             when e.side = 'compaction' and coalesce(comp.n, 0) > 0 then 'long'
             when a.checkpoints = 0 and a.relays = 0 and coalesce(comp.n, 0) = 0 then 'short' end as kind
      from audit_tasks a
      join era e on a.first_at >= e.lo and a.first_at < e.hi
      join task_estimates te using (task)
      join mc using (task)
      left join comp using (task)
      where a.key = 'BTN' and te.done and te.model_family = 'opus' and not mc.other_agent)
select kind, side, count(*) as tasks,
  round(1000 * sum(cost) / sum(output), 3) as usd_per_1k_out,
  round(sum(main_cost) / sum(main_req), 3) as usd_per_req,
  round(sum(main_ctx) / sum(main_req) / 1000) as ctx_avg_k,
  round(1000 * sum(active_min) / sum(output), 3) as active_min_per_1k_out
from t where kind is not null
group by kind, side order by kind, side desc;

-- 3. Where auto-compaction fires with autoCompactWindow 250000: the context before it, after it, and its time.
--    Post: 57 compactions, median 218k (min 216k, max 228k), 19k after, 65 s.
select count(*) as n,
  round((percentile_cont(0.5) within group (order by pre_tokens))::numeric / 1000) as pre_med_k,
  round(min(pre_tokens) / 1000.0) as min_k, round(max(pre_tokens) / 1000.0) as max_k,
  round((percentile_cont(0.5) within group (order by post_tokens))::numeric / 1000) as post_med_k,
  round((percentile_cont(0.5) within group (order by duration_ms))::numeric / 1000) as sec_med
from compactions c join session_tasks st using (session_id) join audit_tasks a using (task)
where c.agent_id is null and c.trigger = 'auto' and a.key = 'BTN'
  and c.at >= '2026-10-19 20:34' and c.at < '2026-10-26 19:00';

-- 4. What else changed that week: the CLI version of BTN sessions by day.
--    Post: 2.1.303 on 10-19, 2.1.306 and 2.1.308 on 10-22, 2.1.309 and 2.1.310 from 10-23.
select (l.at at time zone 'UTC')::date as day, l.raw->>'version' as cli, count(distinct l.session_id) as sessions
from lines l join session_tasks st on st.session_id = l.session_id join audit_tasks a on a.task = st.task
where a.key = 'BTN' and l.type = 'assistant' and l.raw->>'version' is not null
  and l.at >= '2026-10-16' and l.at < '2026-10-26 19:00'
group by 1, 2 order by 1, 2;

-- 5. What else changed that week: the median context of the first request of a BTN Opus session, by day.
--    Post: 32-34k up to 10-19, 39-40k on 10-23 and 10-24.
with f as (select distinct on (m.session_id) m.session_id, m.at, m.model,
             m.input + m.cache_read + m.cache_write_5m + m.cache_write_1h as ctx
           from message_costs m join session_tasks st on st.session_id = m.session_id join audit_tasks a on a.task = st.task
           where a.key = 'BTN' and m.agent_id is null and m.at >= '2026-10-16' and m.at < '2026-10-26 19:00'
           order by m.session_id, m.at)
select (at at time zone 'UTC')::date as day, count(*) as sessions,
  round((percentile_cont(0.5) within group (order by ctx))::numeric / 1000, 1) as entry_med_k
from f where model like 'claude-opus%' group by 1 order by 1;
