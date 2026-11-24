-- v22 → v23 (BTN-1615). A worktree folder gives its task to a session without a launch only when the session started
-- there or spent most of its responses there: a manual session in the main checkout that ran a few commands inside
-- `.claude/worktrees/<key>-<number>` no longer goes wholly to that task. A response's task came from its folder when
-- its branch is not `<that task>/…`; a task from the branch and the launch counts as before. A response of a session
-- left without a task no longer keeps the task of its folder in `message_costs`: only a response of an unknown
-- session does.

create or replace view session_tasks as
select b.session_id, case when cs.session_id is null then coalesce(mv.task, b.task) end as task
from (
  select s.session_id, coalesce(s.launch_task, n.task, f.task) as task
  from sessions s
  left join (
    -- One pass over messages into a few rows a session, the rest over those: windows over every message cost PGlite
    -- 7× on each read of message_costs, and a sort of them half as much again.
    with b as materialized (
      select session_id, task, branch, count(*) as n, min(at) as at, min(message_id) as first_id
      from messages
      group by session_id, task, branch
    )
    select distinct on (g.session_id) g.session_id, g.task
    from (
      select session_id, task, sum(n) as own, min(at) as first_at, min(first_id) as first_id,
        coalesce(bool_or(starts_with(lower(branch), lower(task) || '/')), false) as by_branch
      from b
      where task is not null
      group by session_id, task
    ) g
    join (select session_id, sum(n) as responses, min(at) as first_at from b group by session_id) a
      on a.session_id = g.session_id
    where g.by_branch or g.first_at = a.first_at or g.own * 2 > a.responses
    order by g.session_id, g.first_at, g.first_id
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

-- A message gives its spend to the task of its session (BTN-79), a chat's message to none; only a message of a session
-- Tally does not know keeps its own task.
create or replace view message_costs as
select
  m.message_id, m.session_id, m.agent_id, m.account, m.project, m.project_dir,
  case when cs.session_id is null then case when st.session_id is null then m.task else st.task end end as task,
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
