-- The queries behind every number in sequential-by-design.md (BTN-69).
-- Run against Tally: node <main checkout>/tally/bin/sql.mjs -n 0 -f docs/posts/sequential-by-design.sql
-- Period: three full weeks of chain work, 2026-09-28 00:00 to 2026-10-19 00:00 UTC.
-- Costs are API-equivalent prices from tally.config.json, not a subscription bill.

-- 1. Chain tasks: count, closed, sessions per task, median cost and active minutes.
--    Post: 428 tasks, 421 closed, median $4.63 and 15 active minutes.
with ct as (select distinct task from audit_sessions
  where launch_reason is not null and task is not null and first_at >= '2026-09-28' and first_at < '2026-10-19')
select count(*) as tasks, count(*) filter (where done) as done, round(avg(sessions), 2) as ses_avg,
  round((percentile_cont(0.5) within group (order by cost))::numeric, 2) as usd_med,
  round((percentile_cont(0.5) within group (order by active_min))::numeric) as min_med
from task_estimates join ct using (task);

-- 2. Share of a weekly (7d) window per closed chain task.
--    Post: median 1.76 %, p90 4.33 %, about 57 median tasks per window.
with ct as (select distinct task from audit_sessions
  where launch_reason is not null and task is not null and first_at >= '2026-09-28' and first_at < '2026-10-19'),
ls as (select task, sum(share) as pct from limit_shares where span = '7d' and task is not null group by 1)
select count(*) as tasks,
  round((percentile_cont(0.5) within group (order by ls.pct))::numeric, 2) as med_pct,
  round((percentile_cont(0.9) within group (order by ls.pct))::numeric, 2) as p90_pct,
  round(100.0 / (percentile_cont(0.5) within group (order by ls.pct))::numeric) as med_tasks_per_window
from ct join ls using (task) join task_estimates te using (task) where te.done;

-- 3. Spend of chain sessions before their first successful edit (Edit/Write/MultiEdit/NotebookEdit).
--    Post: $929 of $2,521, 37 %.
with s as (select * from audit_sessions
  where requests > 0 and launch_reason is not null and first_at >= '2026-09-28' and first_at < '2026-10-19'),
fe as (select tc.session_id, min(tc.at) as at from tool_calls tc join s using (session_id)
  where tc.name in ('Edit', 'Write', 'MultiEdit', 'NotebookEdit') and not coalesce(tc.is_error, false) group by 1),
pre as (select m.session_id, sum(m.cost) as cost from message_costs m join fe using (session_id)
  where m.at <= fe.at group by 1)
select round(sum(s.cost)) as chain_usd, round(sum(pre.cost)) as before_edit_usd,
  round(100 * sum(pre.cost) / sum(s.cost)) as pct, count(*) as sessions, count(distinct s.task) as tasks
from s left join pre using (session_id);

-- 4. Entry of a fresh session against a continuation after a handoff, by model family:
--    cost up to the first edit, the context of the request that made it, the context of the first request.
--    Post (opus): fresh 371 sessions, $1.51, 114k, starts at 33k; handoff 318 sessions, $0.74, 74k, starts at 35k.
with s as (select * from audit_sessions
  where requests > 0 and first_at >= '2026-09-28' and first_at < '2026-10-19'
    and launch_reason in ('launch', 'checkpoint', 'relay')),
fe as (select tc.session_id, min(tc.at) as at from tool_calls tc join s using (session_id)
  where tc.name in ('Edit', 'Write', 'MultiEdit', 'NotebookEdit') and not coalesce(tc.is_error, false) group by 1),
pre as (select m.session_id, sum(m.cost) as cost,
    max(m.input + m.cache_read + m.cache_write_5m + m.cache_write_1h) filter (where m.agent_id is null) as ctx
  from message_costs m join fe using (session_id) where m.at <= fe.at group by 1)
select split_part(s.model, '-', 2) as fam,
  case when s.launch_reason = 'launch' then 'fresh' else 'handoff' end as kind,
  count(pre.session_id) as n,
  round((percentile_cont(0.5) within group (order by pre.cost))::numeric, 2) as usd_med,
  round((percentile_cont(0.5) within group (order by pre.ctx))::numeric / 1000) as ctx_k_med,
  round((percentile_cont(0.5) within group (order by s.entry_ctx))::numeric / 1000) as entry_k
from s join pre using (session_id) group by 1, 2 order by 1, 2;

-- 5. Waiting for a human in chain tasks (questions, permissions, the gap to the next prompt).
--    Post: 425 tasks, 147 h active, 23 h waiting, 13 %, 335 tasks never waited.
with ct as (select distinct task from audit_sessions
  where launch_reason is not null and task is not null and first_at >= '2026-09-28' and first_at < '2026-10-19')
select count(*) as tasks, round(sum(active_s) / 3600) as active_h, round(sum(wait_s) / 3600) as wait_h,
  round(100 * sum(wait_s) / nullif(sum(active_s + wait_s), 0)) as wait_pct,
  count(*) filter (where wait_s < 60) as no_wait_tasks
from task_times join ct using (task);

-- 6. What started the turns of chain sessions: the dispatcher (launch, resume), a background
--    notification, a message from another session, or a human prompt.
--    Post: 87 of 982 turns, about 3 of 153 turn hours, began with a human prompt.
with s as (select session_id, launch_reason from audit_sessions
  where requests > 0 and first_at >= '2026-09-28' and first_at < '2026-10-19')
select (s.launch_reason is not null) as chain, t.start, count(*) as turns,
  round(sum(extract(epoch from (t.ended_at - t.started_at))) / 3600) as h_raw
from turns t join s using (session_id) group by 1, 2 order by 1, 2;

-- 7. The longest stretches of chain work: turns of chain sessions merged while the gap is under 30 min.
--    Post: 2026-10-10 14:50 to 2026-10-11 07:17 UTC, 16.4 h, 12 tasks, 3 human turns.
with s as (select session_id, task from audit_sessions
  where requests > 0 and launch_reason is not null and first_at >= '2026-09-28' and first_at < '2026-10-19'),
t as (select t.*, s.task from turns t join s using (session_id) where t.ended_at is not null),
o as (select *, max(ended_at) over (order by started_at rows between unbounded preceding and 1 preceding) as prev_end from t),
g as (select *, sum(case when prev_end is null or started_at > prev_end + interval '30 minutes' then 1 else 0 end)
  over (order by started_at) as grp from o),
r as (select grp, min(started_at) as from_at, max(ended_at) as to_at,
  count(*) filter (where start = 'prompt') as human_turns, count(distinct task) as tasks from g group by grp)
select from_at, to_at, round(extract(epoch from to_at - from_at) / 3600, 1) as hours, human_turns, tasks
from r order by to_at - from_at desc limit 5;

-- 8. Inside that stretch: sessions started by reason, tasks closed, turns cut by a usage limit.
--    Post: 10 fresh sessions, 32 checkpoint handoffs over 9 tasks, 1 restart; 12 of 12 tasks closed; 1 limit hit.
select launch_reason, count(*) as sessions, count(distinct task) as tasks from audit_sessions
where requests > 0 and launch_reason is not null and first_at >= '2026-10-10 14:50' and first_at < '2026-10-11 07:18'
group by 1;
select count(distinct a.task) filter (where te.done) as done, count(distinct a.task) as tasks
from audit_sessions a left join task_estimates te using (task)
where a.requests > 0 and a.launch_reason is not null and a.first_at >= '2026-10-10 14:50' and a.first_at < '2026-10-11 07:18';
select count(*) filter (where limited) as limited_turns from turns t join audit_sessions a using (session_id)
where a.launch_reason is not null and t.started_at >= '2026-10-10 14:50' and t.started_at < '2026-10-11 07:18';
