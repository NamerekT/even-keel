create table if not exists files (
  path text primary key,
  account text not null,
  read_to bigint not null,
  size bigint not null,
  mtime timestamptz not null,
  ino text not null,
  head text not null,
  head_len int not null,
  read_at timestamptz not null default now()
);

create table if not exists lines (
  uuid text primary key,
  session_id text,
  agent_id text,
  type text,
  at timestamptz,
  raw jsonb not null
);
create index if not exists lines_session_at on lines (session_id, at);

create table if not exists messages (
  message_id text primary key,
  session_id text,
  agent_id text,
  account text not null,
  project text,
  project_dir text,
  task text,
  branch text,
  entrypoint text,
  model text,
  speed text,
  at timestamptz,
  input bigint not null,
  cache_write_5m bigint not null,
  cache_write_1h bigint not null,
  cache_read bigint not null,
  output bigint not null
);
create index if not exists messages_session on messages (session_id);
create index if not exists messages_task on messages (task);
create index if not exists messages_account_at on messages (account, at);

create table if not exists tool_calls (
  tool_use_id text primary key,
  session_id text,
  message_id text,
  task text,
  name text,
  input_hash text,
  brief text,
  at timestamptz,
  result_at timestamptz,
  is_error boolean,
  error_kind text,
  error_text text
);
create index if not exists tool_calls_session on tool_calls (session_id);
create index if not exists tool_calls_task on tool_calls (task);

create table if not exists sessions (
  session_id text primary key,
  account text not null,
  project text,
  custom_title text,
  ai_title text,
  launch_task text,
  launch_reason text,
  first_at timestamptz,
  last_at timestamptz
);

create table if not exists limit_snapshots (
  account text not null,
  span text not null check (span in ('5h', '7d')),
  observed_at timestamptz not null,
  used_percentage real not null,
  resets_at timestamptz not null,
  source text,
  primary key (account, span, observed_at)
);

create table if not exists model_prices (
  model text primary key,
  input numeric not null,
  output numeric not null,
  cache_read numeric not null,
  cache_write_5m numeric not null,
  cache_write_1h numeric not null
);

create or replace view message_costs as
select
  m.message_id, m.session_id, m.agent_id, m.account, m.project, m.project_dir,
  coalesce(s.launch_task, m.task) as task,
  m.branch, m.entrypoint, m.model, m.speed, m.at,
  m.input, m.cache_write_5m, m.cache_write_1h, m.cache_read, m.output,
  p.model as price_model,
  (m.input * p.input + m.cache_write_5m * p.cache_write_5m + m.cache_write_1h * p.cache_write_1h
    + m.cache_read * p.cache_read + m.output * p.output) / 1000000 as cost
from messages m
left join sessions s on s.session_id = m.session_id
left join lateral (
  select * from model_prices p where starts_with(m.model, p.model) order by length(p.model) desc limit 1
) p on true;

create or replace view limit_intervals as
select s.account, s.span, d.since, s.observed_at as till, d.delta
from (
  select
    account, span, observed_at, used_percentage, resets_at,
    lag(observed_at) over w as prev_at,
    lag(used_percentage) over w as prev_used,
    lag(resets_at) over w as prev_resets,
    case span when '5h' then interval '5 hours' else interval '7 days' end as len
  from limit_snapshots
  window w as (partition by account, span order by observed_at)
) s
cross join lateral (
  select
    case
      when abs(extract(epoch from s.resets_at - s.prev_resets)) <= 1800 then greatest(s.used_percentage - s.prev_used, 0)
      else s.used_percentage
    end as delta,
    greatest(s.prev_at, s.resets_at - s.len) as since
) d
where s.prev_at is not null and d.delta > 0 and d.since < s.observed_at;

create or replace view limit_shares as
select
  i.account, i.span, i.since, i.till, c.message_id, c.session_id, c.task,
  i.delta * c.cost / nullif(sum(c.cost) over (partition by i.account, i.span, i.till), 0) as share
from limit_intervals i
join message_costs c on c.account = i.account and c.at > i.since and c.at <= i.till;

create or replace view task_costs as
select
  c.task,
  count(*) as messages,
  count(distinct c.session_id) as sessions,
  min(c.at) as first_at,
  max(c.at) as last_at,
  sum(c.input) as input,
  sum(c.cache_write_5m) as cache_write_5m,
  sum(c.cache_write_1h) as cache_write_1h,
  sum(c.cache_read) as cache_read,
  sum(c.output) as output,
  sum(c.cost) as cost,
  count(*) filter (where c.cost is null) as unpriced,
  max(l.five_hour) as five_hour_share,
  max(l.seven_day) as seven_day_share
from message_costs c
left join (
  select task, sum(share) filter (where span = '5h') as five_hour, sum(share) filter (where span = '7d') as seven_day
  from limit_shares
  group by task
) l on l.task = c.task
where c.task is not null
group by c.task;

create table if not exists signs (
  session_id text not null,
  agent_id text not null default '',
  kind text not null,
  from_uuid text not null,
  to_uuid text not null,
  from_at timestamptz not null,
  to_at timestamptz not null,
  count int not null,
  detail text not null,
  primary key (session_id, agent_id, kind, from_uuid)
);

create table if not exists spans (
  id text primary key,
  session_id text not null,
  agent_id text not null default '',
  from_uuid text not null,
  to_uuid text not null,
  from_at timestamptz not null,
  to_at timestamptz not null,
  kinds text[] not null
);
create index if not exists spans_session on spans (session_id);

create table if not exists sign_sessions (
  session_id text primary key,
  last_at timestamptz,
  key text not null
);

create table if not exists span_reasons (
  span_id text primary key,
  session_id text not null,
  agent_id text not null default '',
  from_at timestamptz not null,
  to_at timestamptz not null,
  kinds text[] not null,
  reason text not null,
  note text not null,
  prompt_version int not null,
  model text,
  classifier_session text,
  classified_at timestamptz not null default now()
);

create table if not exists tasks (
  task text primary key,
  title text,
  status text,
  labels text[] not null default '{}',
  related text[] not null default '{}',
  fetched_at timestamptz not null default now()
);

create or replace view session_tasks as
select s.session_id, coalesce(s.launch_task, (
  select m.task from messages m where m.session_id = s.session_id and m.task is not null order by m.at limit 1
)) as task
from sessions s;

create or replace view stuck_spans as
select
  sp.id, sp.session_id, sp.agent_id, st.task, sp.from_at, sp.to_at, sp.kinds,
  r.reason, r.note, r.prompt_version, r.classified_at
from spans sp
left join session_tasks st on st.session_id = sp.session_id
left join span_reasons r on r.span_id = sp.id;

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
  t.title, t.status, t.labels, coalesce('Переделка' = any(t.labels), false) as rework, t.related
from st
join sessions s on s.session_id = st.session_id
left join stuck on stuck.task = st.task
left join tasks t on t.task = st.task
group by st.task, t.title, t.status, t.labels, t.related;
