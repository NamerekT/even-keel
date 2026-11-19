-- v17 → v18 (BTN-1233). A project chat's session (BTN-1229) is no task's: Even Keel's `chats` name each chat's session,
-- copied into `chat_sessions`, and `session_tasks` gives such a session no task, whatever its branch, folder or title
-- name. Its spend stays in the project of its folder; /stats counts the chats next to the tasks.

create table if not exists chat_sessions (
  session_id text primary key,
  chat       text not null
);

create or replace view session_tasks as
select b.session_id, case when cs.session_id is null then coalesce(mv.task, b.task) end as task
from (
  select s.session_id, coalesce(s.launch_task, n.task, f.task) as task
  from sessions s
  left join (
    select distinct on (session_id) session_id, task
    from messages
    where task is not null
    order by session_id, at, message_id
  ) f on f.session_id = s.session_id
  left join lateral (
    select upper(x.m[1]) as task
    from (values (1, s.custom_title), (2, s.ai_title), (3, s.prompt)) t(rank, txt)
    cross join lateral regexp_matches(
      t.txt, '(?<![A-Za-z0-9])(' || split_part(f.task, '-', 1) || '-[0-9]+)(?![0-9])', 'gi'
    ) with ordinality x(m, pos)
    where s.launch_task is null and f.task is not null and t.txt is not null
    order by upper(x.m[1]) = f.task desc, t.rank, x.pos
    limit 1
  ) n on true
) b
left join task_moves mv on mv.old_task = b.task
left join chat_sessions cs on cs.session_id = b.session_id;

-- A message gives its spend to the task of its session (BTN-79), a chat's message to none: its own branch's task is
-- not taken back either.
create or replace view message_costs as
select
  m.message_id, m.session_id, m.agent_id, m.account, m.project, m.project_dir,
  case when cs.session_id is null then coalesce(st.task, m.task) end as task,
  m.branch, m.entrypoint, m.model, m.speed, m.at,
  m.input, m.cache_write_5m, m.cache_write_1h, m.cache_read, m.output,
  p.model as price_model,
  (m.input * r.input + m.cache_write_5m * r.cache_write_5m + m.cache_write_1h * r.cache_write_1h
    + m.cache_read * r.cache_read + m.output * r.output) / 1000000 as cost,
  p.source as price_source
from messages m
left join session_tasks st on st.session_id = m.session_id
left join chat_sessions cs on cs.session_id = m.session_id
-- The price once per model and provider, not per message: per message it cost PGlite 0.6 s on every read. The longest
-- config prefix of the model, else the catalogue row of exactly `<provider>/<model>`. No provider is '' so the join
-- stays an equality.
left join (
  select distinct on (used.model, used.provider) used.model as message_model, used.provider as message_provider, p.*
  from (select distinct model, coalesce(provider, '') as provider from messages) used
  join model_prices p
    on (p.source = 'config' and starts_with(used.model, p.model))
    or (p.source = 'catalogue' and used.provider <> '' and p.model = used.provider || '/' || used.model)
  order by used.model, used.provider, p.source = 'config' desc, length(p.model) desc
) p on p.message_model = m.model and p.message_provider = coalesce(m.provider, '')
-- A prompt over long_over tokens pays the long prompt rates on all of its tokens.
left join lateral (
  select
    case when long then p.long_input else p.input end as input,
    case when long then p.long_output else p.output end as output,
    case when long then p.long_cache_read else p.cache_read end as cache_read,
    case when long then p.long_cache_write_5m else p.cache_write_5m end as cache_write_5m,
    case when long then p.long_cache_write_1h else p.cache_write_1h end as cache_write_1h
  from (select coalesce(m.input + m.cache_read + m.cache_write_5m + m.cache_write_1h > p.long_over, false) as long) t
) r on true;
