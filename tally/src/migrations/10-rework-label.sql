-- v9 → v10. The built-in tracker labels a rework of a done task `Rework` (BTN-767), Huly here `Переделка` (BTN-785):
-- `rework` and the follow-ups take either. The views keep their columns; only the label test changes.

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
  (select count(*) from spans sp join session_tasks st on st.session_id = sp.session_id where st.task = a.task) as spans,
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
  select st.task, count(*) as spans from spans sp join st on st.session_id = sp.session_id group by st.task
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

create or replace view task_followups as
with last_sessions as (
  select st.task, max(s.last_at) as last_at
  from session_tasks st
  join sessions s on s.session_id = st.session_id
  where st.task is not null
  group by st.task
)
select
  l.task,
  l.last_at,
  count(f.task) as followups,
  coalesce(array_agg(f.task order by f.created_at, f.task) filter (where f.task is not null), '{}') as followup_tasks
from last_sessions l
left join tasks t on t.task = l.task
left join tasks f on f.task = any(t.related)
  and f.created_at > l.last_at
  and f.labels && array['Bug', 'Переделка', 'Rework']
group by l.task, l.last_at;
