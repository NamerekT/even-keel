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
  select distinct on (r.raw->'message'->>'id') r.raw->'message'->>'id' as message_id, r.raw->>'effort' as effort
  from lines l join line_raws r on r.uuid = l.uuid
  where l.type = 'assistant' and r.raw->>'effort' is not null
  order by r.raw->'message'->>'id', l.at desc
) e
where e.message_id = m.message_id and m.effort is null`

export const SESSION_PROMPTS = `
with missing as materialized (
  select s.session_id, coalesce(p.prompt, case when s.last_at < now() - interval '1 day' then '' end) as prompt
  from sessions s left join lateral (
    select a.prompt from session_activity a
    where a.session_id = s.session_id and a.prompt is not null order by a.at, a.uuid limit 1
  ) p on true
  where s.prompt is null
)
update sessions s set prompt = m.prompt from missing m
where s.session_id = m.session_id and s.prompt is null and m.prompt is not null`
