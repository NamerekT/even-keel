// $1 — `ClosedState[]`: a done task keeps its status when the archive has none, an open one drops it (BTN-330).
export const CLOSED_TASK_STATES = `
insert into tasks (task, status, done, fetched_at)
select x.task, x.status, x.done, 'epoch' from jsonb_to_recordset($1::jsonb) as x(task text, status text, done boolean)
on conflict (task) do update set
  status = case when excluded.done then coalesce(excluded.status, tasks.status) end, done = excluded.done
where tasks.done is distinct from excluded.done
  or tasks.status is distinct from case when excluded.done then coalesce(excluded.status, tasks.status) end`

export const SESSION_FOLDERS = `
update sessions s set project_dir = (
  select m.project_dir from messages m
  where m.session_id = s.session_id and m.project_dir is not null
  order by m.at, m.message_id
  limit 1
)
where s.project_dir is null
  and exists (select 1 from messages m where m.session_id = s.session_id and m.project_dir is not null)`
// Messages loaded before effort was parsed take it from their stored lines; run once (tally_meta 'efforts').
export const MESSAGE_EFFORTS = `
update messages m set effort = e.effort
from (
  select distinct on (raw->'message'->>'id') raw->'message'->>'id' as message_id, raw->>'effort' as effort
  from lines
  where type = 'assistant' and raw->>'effort' is not null
  order by raw->'message'->>'id', at desc
) e
where e.message_id = m.message_id and m.effort is null`
// Only rows that can be a prompt: the rest of a session's user rows are tool results, heavy to fetch.
export const SESSION_PROMPT_ROWS = `
select s.session_id, coalesce(s.last_at < now() - interval '1 day', false) as old,
  (select coalesce(jsonb_agg(p.raw order by p.at, p.uuid), '[]'::jsonb)
   from (
     select l.raw, l.at, l.uuid from lines l
     where l.session_id = s.session_id and l.agent_id is null and l.type = 'user'
       and coalesce(l.raw->>'isMeta', '') <> 'true'
       and (jsonb_typeof(l.raw->'message'->'content') = 'string'
         or not (l.raw->'message'->'content') @> '[{"type": "tool_result"}]')
     order by l.at, l.uuid
     limit 10
   ) p) as rows
from sessions s
where s.prompt is null`
