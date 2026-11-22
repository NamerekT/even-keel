-- The queries behind the phase-1 result of the compaction versus handoff A/B (BTN-505), per the amendment of
-- 2026-11-17 in compaction-ab.md.
-- Run against Tally: node <main checkout>/tally/bin/sql.mjs -n 0 -f docs/posts/compaction-ab.sql
-- Phase 1: BTN tasks whose first session started 2026-11-12 13:14:16 UTC (the second start) .. 2026-11-17
-- 15:25:04.578 UTC (BTN-1051, the first chain session writing the five-minute cache), closed.
-- Arm = parity of the task number (even = compaction, odd = handoff), whatever happened in the task.
-- Definitions and formulas as in compaction-week.sql. Costs are API-equivalent prices, not a subscription bill;
-- a compaction's summary call is not in the transcript and so is not priced (a bias in favour of compaction).

-- 1. Population and deviations, every closed task of phase 1 (other providers included, then excluded).
--    Result: see compaction-ab.md, "Phase 1 result".
with lim(lo, hi) as (values ('2026-11-12 13:14:16+00'::timestamptz, '2026-11-17 15:25:04.578+00'::timestamptz)),
comp as (select st.task, count(*) as n from compactions c join session_tasks st using (session_id)
         where c.agent_id is null and c.trigger = 'auto' group by 1),
mc as (select st.task, bool_or(m.model not like 'claude%') as other_agent
       from message_costs m join session_tasks st using (session_id) group by 1),
ver as (select st.task, count(distinct r.raw->>'version') as clis
        from lines l join line_raws r using (uuid) join session_tasks st using (session_id)
        where l.type = 'assistant' and l.agent_id is null and r.raw->>'version' is not null
          and l.at >= '2026-11-12 13:14:16+00' group by 1),
t as (select case when split_part(a.task, '-', 2)::int % 2 = 0 then 'compaction' else 'handoff' end as arm,
        a.task, a.labels, a.checkpoints, te.done, coalesce(mc.other_agent, false) as other_agent,
        coalesce(comp.n, 0) as compactions, ver.clis
      from audit_tasks a
      join lim on a.first_at >= lim.lo and a.first_at < lim.hi
      join task_estimates te on te.task = a.task
      left join mc on mc.task = a.task
      left join comp on comp.task = a.task
      left join ver on ver.task = a.task
      where a.key = 'BTN')
select arm,
  count(*) filter (where not done) as still_open,
  count(*) filter (where done) as closed,
  count(*) filter (where done and other_agent) as other_provider,
  count(*) filter (where done and not other_agent) as claude_tasks,
  count(*) filter (where done and not other_agent
                   and 'Break | compaction' = any(labels) and 'Break | handoff' = any(labels)) as both_labels,
  count(*) filter (where done and not other_agent
                   and not ('Break | compaction' = any(labels) or 'Break | handoff' = any(labels))) as no_label,
  count(*) filter (where done and not other_agent and not ('Break | ' || arm = any(labels))
                   and ('Break | compaction' = any(labels) or 'Break | handoff' = any(labels))) as wrong_label,
  count(*) filter (where done and not other_agent and arm = 'handoff' and compactions > 0) as compacted,
  count(*) filter (where done and not other_agent and arm = 'compaction' and checkpoints > 0) as handed_off,
  count(*) filter (where done and not other_agent and clis > 1) as cli_changed,
  count(*) filter (where done and not other_agent and clis is null) as cli_unknown
from t group by 1 order by 1;

-- 2. Primary: every closed Claude task of phase 1 by arm.
--    Result (compaction / handoff): 94 / 99 tasks; $/1k output 0.100 / 0.099; $/request 0.059 / 0.056;
--    context 113k / 102k; active min/1k output 0.414 / 0.409; median $2.72, 14 min / $2.52, 11 min.
with lim(lo, hi) as (values ('2026-11-12 13:14:16+00'::timestamptz, '2026-11-17 15:25:04.578+00'::timestamptz)),
comp as (select st.task, count(*) as n from compactions c join session_tasks st using (session_id)
         where c.agent_id is null and c.trigger = 'auto' group by 1),
real as (select task, count(*) as n from stuck_spans
         where reason in ('broken_tooling', 'debug_loop', 'unclear_task', 'other') group by 1),
mc as (select st.task, sum(m.output) as output,
         count(*) filter (where m.agent_id is null) as main_req,
         sum(m.cost) filter (where m.agent_id is null) as main_cost,
         sum(m.input + m.cache_read + m.cache_write_5m + m.cache_write_1h) filter (where m.agent_id is null) as main_ctx,
         bool_or(m.model not like 'claude%') as other_agent
       from message_costs m join session_tasks st using (session_id) group by 1),
t as (select case when split_part(a.task, '-', 2)::int % 2 = 0 then 'compaction' else 'handoff' end as arm,
        a.*, te.model_family, coalesce(comp.n, 0) as compactions, coalesce(real.n, 0) as real_spans,
        mc.output, mc.main_req, mc.main_cost, mc.main_ctx
      from audit_tasks a
      join lim on a.first_at >= lim.lo and a.first_at < lim.hi
      join task_estimates te on te.task = a.task
      join mc on mc.task = a.task
      left join comp on comp.task = a.task
      left join real on real.task = a.task
      where a.key = 'BTN' and te.done and not mc.other_agent)
select arm, count(*) as tasks,
  count(*) filter (where model_family = 'opus') as opus,
  count(*) filter (where model_family is distinct from 'opus') as other_family,
  round(1000 * sum(cost) / sum(output), 3) as usd_per_1k_out,
  round(sum(main_cost) / sum(main_req), 3) as usd_per_req,
  round(sum(main_ctx) / sum(main_req) / 1000) as ctx_avg_k,
  round(avg(checkpoints), 2) as handoffs_per_task,
  round(avg(compactions), 2) as compactions_per_task,
  round(avg(real_spans), 2) as stuck_per_task,
  round(100.0 * count(*) filter (where real_spans > 0) / count(*)) as stuck_tasks_pct,
  round(1000 * sum(active_min) / sum(output), 3) as active_min_per_1k_out,
  round((percentile_cont(0.5) within group (order by cost))::numeric, 2) as usd_median,
  round((percentile_cont(0.5) within group (order by active_min))::numeric) as min_median,
  round(sum(cost)) as usd_total
from t group by 1 order by 1;

-- 3. Secondary, biased against compaction (a handoff fires at a lower peak, so the handoff arm's "long" takes in
--    smaller tasks): long (a handoff or an auto-compaction) and short (no break, no relay) tasks by arm.
--    Result: long 20 / 28, $/1k output 0.103 / 0.099, average peak 210k / 182k; short 68 / 65, 0.097 / 0.098.
with lim(lo, hi) as (values ('2026-11-12 13:14:16+00'::timestamptz, '2026-11-17 15:25:04.578+00'::timestamptz)),
comp as (select st.task, count(*) as n from compactions c join session_tasks st using (session_id)
         where c.agent_id is null and c.trigger = 'auto' group by 1),
real as (select task, count(*) as n from stuck_spans
         where reason in ('broken_tooling', 'debug_loop', 'unclear_task', 'other') group by 1),
mc as (select st.task, sum(m.output) as output,
         count(*) filter (where m.agent_id is null) as main_req,
         sum(m.cost) filter (where m.agent_id is null) as main_cost,
         sum(m.input + m.cache_read + m.cache_write_5m + m.cache_write_1h) filter (where m.agent_id is null) as main_ctx,
         bool_or(m.model not like 'claude%') as other_agent
       from message_costs m join session_tasks st using (session_id) group by 1),
t as (select case when split_part(a.task, '-', 2)::int % 2 = 0 then 'compaction' else 'handoff' end as arm,
        a.*, coalesce(comp.n, 0) as compactions, coalesce(real.n, 0) as real_spans,
        mc.output, mc.main_req, mc.main_cost, mc.main_ctx,
        case when a.checkpoints > 0 or coalesce(comp.n, 0) > 0 then 'long'
             when a.relays = 0 then 'short' end as kind
      from audit_tasks a
      join lim on a.first_at >= lim.lo and a.first_at < lim.hi
      join task_estimates te on te.task = a.task
      join mc on mc.task = a.task
      left join comp on comp.task = a.task
      left join real on real.task = a.task
      where a.key = 'BTN' and te.done and not mc.other_agent)
select kind, arm, count(*) as tasks,
  round(1000 * sum(cost) / sum(output), 3) as usd_per_1k_out,
  round(sum(main_cost) / sum(main_req), 3) as usd_per_req,
  round(sum(main_ctx) / sum(main_req) / 1000) as ctx_avg_k,
  round(avg(checkpoints + compactions), 1) as breaks_per_task,
  round(avg(real_spans), 2) as stuck_per_task,
  round(1000 * sum(active_min) / sum(output), 3) as active_min_per_1k_out,
  round((percentile_cont(0.5) within group (order by cost))::numeric, 2) as usd_median,
  round(avg(ctx_peak) / 1000) as peak_avg_k
from t where kind is not null group by 1, 2 order by 1, 2;

-- 4. The primary comparison inside CLI-version strata: the version of the task's first main assistant line;
--    then the unweighted mean of the per-version differences (compaction - handoff) over versions in both arms.
--    Result: 4 matched versions, 192 tasks: +0.002 $/1k output, +$0.006 a request, +14k context,
--    -0.01 stuck spans a task, +0.006 active min/1k output.
with lim(lo, hi) as (values ('2026-11-12 13:14:16+00'::timestamptz, '2026-11-17 15:25:04.578+00'::timestamptz)),
real as (select task, count(*) as n from stuck_spans
         where reason in ('broken_tooling', 'debug_loop', 'unclear_task', 'other') group by 1),
mc as (select st.task, sum(m.output) as output,
         count(*) filter (where m.agent_id is null) as main_req,
         sum(m.cost) filter (where m.agent_id is null) as main_cost,
         sum(m.input + m.cache_read + m.cache_write_5m + m.cache_write_1h) filter (where m.agent_id is null) as main_ctx,
         bool_or(m.model not like 'claude%') as other_agent
       from message_costs m join session_tasks st using (session_id) group by 1),
ver as (select distinct on (st.task) st.task, r.raw->>'version' as cli
        from lines l join line_raws r using (uuid) join session_tasks st using (session_id)
        where l.type = 'assistant' and l.agent_id is null and r.raw->>'version' is not null
          and l.at >= '2026-11-12 13:14:16+00'
        order by st.task, l.at),
t as (select case when split_part(a.task, '-', 2)::int % 2 = 0 then 'compaction' else 'handoff' end as arm,
        coalesce(ver.cli, 'unknown') as cli, a.cost, a.active_min, coalesce(real.n, 0) as real_spans,
        mc.output, mc.main_req, mc.main_cost, mc.main_ctx
      from audit_tasks a
      join lim on a.first_at >= lim.lo and a.first_at < lim.hi
      join task_estimates te on te.task = a.task
      join mc on mc.task = a.task
      left join real on real.task = a.task
      left join ver on ver.task = a.task
      where a.key = 'BTN' and te.done and not mc.other_agent),
s as (select cli, arm, count(*) as tasks,
        1000 * sum(cost) / sum(output) as usd_per_1k_out,
        sum(main_cost) / sum(main_req) as usd_per_req,
        sum(main_ctx) / sum(main_req) / 1000 as ctx_avg_k,
        avg(real_spans) as stuck_per_task,
        1000 * sum(active_min) / sum(output) as active_min_per_1k_out
      from t group by 1, 2),
d as (select c.cli, c.tasks as c_tasks, h.tasks as h_tasks,
        c.usd_per_1k_out - h.usd_per_1k_out as d_usd_per_1k_out,
        c.usd_per_req - h.usd_per_req as d_usd_per_req,
        c.ctx_avg_k - h.ctx_avg_k as d_ctx_avg_k,
        c.stuck_per_task - h.stuck_per_task as d_stuck_per_task,
        c.active_min_per_1k_out - h.active_min_per_1k_out as d_active_min_per_1k_out
      from s c join s h on h.cli = c.cli and c.arm = 'compaction' and h.arm = 'handoff'
      where c.cli <> 'unknown')
select cli, arm, tasks, round(usd_per_1k_out::numeric, 3) as usd_per_1k_out, round(usd_per_req::numeric, 3) as usd_per_req,
  round(ctx_avg_k::numeric) as ctx_avg_k, round(stuck_per_task::numeric, 2) as stuck_per_task,
  round(active_min_per_1k_out::numeric, 3) as active_min_per_1k_out
from s
union all
select 'mean of ' || count(*) || ' matched versions', 'compaction - handoff', sum(c_tasks + h_tasks),
  round(avg(d_usd_per_1k_out)::numeric, 3), round(avg(d_usd_per_req)::numeric, 3), round(avg(d_ctx_avg_k)::numeric),
  round(avg(d_stuck_per_task)::numeric, 2), round(avg(d_active_min_per_1k_out)::numeric, 3)
from d
order by 1, 2;

-- 5. The breaks themselves, by the session's own arm: auto-compactions (context before and after, time, the
--    unpriced summary call).
--    Result: compaction arm 22, median 217k -> 22k, 14 s; handoff arm 9, 218k -> 11k, 63 s.
with lim(lo, hi) as (values ('2026-11-12 13:14:16+00'::timestamptz, '2026-11-17 15:25:04.578+00'::timestamptz)),
mc as (select st.task, bool_or(m.model not like 'claude%') as other_agent
       from message_costs m join session_tasks st using (session_id) group by 1),
p as (select a.task, case when split_part(a.task, '-', 2)::int % 2 = 0 then 'compaction' else 'handoff' end as arm
      from audit_tasks a
      join lim on a.first_at >= lim.lo and a.first_at < lim.hi
      join task_estimates te on te.task = a.task
      join mc on mc.task = a.task
      where a.key = 'BTN' and te.done and not mc.other_agent)
select p.arm, count(*) as compactions,
  round((percentile_cont(0.5) within group (order by c.pre_tokens))::numeric / 1000) as pre_med_k,
  round((percentile_cont(0.5) within group (order by c.post_tokens))::numeric / 1000) as post_med_k,
  round((percentile_cont(0.5) within group (order by c.duration_ms))::numeric / 1000) as sec_med,
  round(sum(c.duration_ms) / 60000.0) as min_total
from compactions c join session_tasks st using (session_id) join p on p.task = st.task
where c.agent_id is null and c.trigger = 'auto'
group by 1 order by 1;
