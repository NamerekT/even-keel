-- v6 → v7. Follow-ups over a task as a quality signal (BTN-362): a task done badly is not reopened, a new one with
-- the label Bug or Переделка is filed over it and related to it. Huly records a relation on both tasks, so the pair
-- gets its direction from the time: a follow-up is created after the last session of the task it follows. Every task
-- fetched before is asked again at the next run, for its creation time.

alter table tasks add column if not exists created_at timestamptz;
update tasks set fetched_at = 'epoch' where title is not null;

-- Every task with a session, with none or more follow-ups.
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
  and f.labels && array['Bug', 'Переделка']
group by l.task, l.last_at;
