-- v12 → v13. A span classified as normal is a false alarm (BTN-966).
-- Keep the audit columns and the full stuck_spans list; exclude only from money and task counters.

create or replace view audit_sessions as
with tools as (
  select session_id, count(*) as calls,
    count(*) filter (where is_error and coalesce(error_kind, '') not in ('denied', 'hook')) as errors,
    count(*) filter (where error_kind in ('denied', 'hook')) as denied
  from tool_calls
  group by session_id
)
select
  c.session_id,
  min(c.account) as account,
  (array_agg(x.dir order by c.at) filter (where c.agent_id is null))[1] as dir,
  st.task,
  split_part(st.task, '-', 1) as key,
  s.launch_reason,
  min(c.at) as first_at,
  max(c.at) as last_at,
  coalesce(max(tm.active_s), 0) / 60 as active_min,
  (array_agg(c.model order by c.at) filter (where c.agent_id is null))[1] as model,
  count(*) filter (where c.agent_id is null) as requests,
  coalesce(sum(x.ctx) filter (where c.agent_id is null), 0) as ctx_sum,
  max(x.ctx) filter (where c.agent_id is null) as ctx_peak,
  count(*) filter (where c.agent_id is null and x.ctx > 150000) as over150,
  (array_agg(x.ctx order by c.at) filter (where c.agent_id is null))[1] as entry_ctx,
  sum(c.cost) as cost,
  coalesce(sum(c.cost) filter (where c.agent_id is null), 0) as main_cost,
  count(*) filter (where c.cost is null) as unpriced,
  coalesce(sum(c.cost) filter (where exists (
    select 1 from spans sp
    left join span_reasons sr on sr.span_id = sp.id
    where sp.session_id = c.session_id and sp.agent_id = coalesce(c.agent_id, '') and c.at between sp.from_at and sp.to_at
      and sr.reason is distinct from 'normal'
  )), 0) as stuck_cost,
  coalesce(max(t.calls), 0) as tool_calls,
  coalesce(max(t.errors), 0) as tool_errors,
  coalesce(max(t.denied), 0) as tool_denied,
  coalesce(s.custom_title, s.ai_title) as title
from message_costs c
join sessions s on s.session_id = c.session_id
left join session_tasks st on st.session_id = c.session_id
left join tools t on t.session_id = c.session_id
left join session_times tm on tm.session_id = c.session_id
cross join lateral (
  select c.input + c.cache_write_5m + c.cache_write_1h + c.cache_read as ctx,
    lower(regexp_replace(replace(coalesce(c.project_dir, ''), '\', '/'), '^[a-zA-Z]:', '')) as dir
) x
where c.entrypoint is distinct from 'tally-classify'
group by c.session_id, st.task, s.launch_reason, s.custom_title, s.ai_title;

create or replace view audit_tasks as
select
  a.task,
  min(a.key) as key,
  (array_agg(a.dir order by a.first_at))[1] as dir,
  min(a.first_at) as first_at,
  max(a.last_at) as last_at,
  sum(a.active_min) as active_min,
  count(*) as sessions,
  count(*) filter (where a.launch_reason = 'relay') as relays,
  count(*) filter (where a.launch_reason = 'checkpoint') as checkpoints,
  count(*) filter (where a.launch_reason = 'restart') as restarts,
  array_agg(distinct a.model) filter (where a.model is not null) as models,
  sum(a.requests) as requests,
  sum(a.ctx_sum) as ctx_sum,
  sum(a.over150) as over150,
  max(a.ctx_peak) as ctx_peak,
  (array_agg(a.entry_ctx order by a.first_at))[1] as entry_ctx,
  sum(a.cost) as cost,
  sum(a.stuck_cost) as stuck_cost,
  (select count(*) from spans sp
    join session_tasks st on st.session_id = sp.session_id
    left join span_reasons sr on sr.span_id = sp.id
    where st.task = a.task and sr.reason is distinct from 'normal') as spans,
  sum(a.tool_calls) as tool_calls,
  sum(a.tool_errors) as tool_errors,
  sum(a.tool_denied) as tool_denied,
  coalesce(t.labels && array['Переделка', 'Rework'], false) as rework,
  t.title, t.status, t.labels, t.related
from audit_sessions a
left join tasks t on t.task = a.task
where a.task is not null
group by a.task, t.title, t.status, t.labels, t.related;

create or replace view task_repeats as
with st as (
  select * from session_tasks where task is not null
), stuck as (
  select st.task, count(*) as spans
  from spans sp
  join st on st.session_id = sp.session_id
  left join span_reasons sr on sr.span_id = sp.id
  where sr.reason is distinct from 'normal'
  group by st.task
)
select
  st.task,
  count(*) as sessions,
  count(*) filter (where s.launch_reason = 'relay') as relays,
  count(*) filter (where s.launch_reason = 'checkpoint') as checkpoints,
  count(*) filter (where s.launch_reason = 'restart') as restarts,
  coalesce(max(stuck.spans), 0) as spans,
  t.title, t.status, t.labels, coalesce(t.labels && array['Переделка', 'Rework'], false) as rework, t.related
from st
join sessions s on s.session_id = st.session_id
left join stuck on stuck.task = st.task
left join tasks t on t.task = st.task
group by st.task, t.title, t.status, t.labels, t.related;
