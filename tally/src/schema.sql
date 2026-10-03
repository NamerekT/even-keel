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

create or replace view limit_steps as
select
  g.account, g.span, g.observed_at, g.used_percentage, g.resets_at, g.source, g.prev_at, g.fresh, g.wnd,
  max(g.used_percentage) over (
    partition by g.account, g.span, g.wnd order by g.observed_at rows between unbounded preceding and 1 preceding
  ) as prev_max,
  case g.span when '5h' then interval '5 hours' else interval '7 days' end as len
from (
  select f.*, sum(f.fresh) over (partition by f.account, f.span order by f.observed_at) as wnd
  from (
    select
      account, span, observed_at, used_percentage, resets_at, source,
      lag(observed_at) over w as prev_at,
      case when abs(extract(epoch from resets_at - lag(resets_at) over w)) <= 1800 then 0 else 1 end as fresh
    from limit_snapshots
    window w as (partition by account, span order by observed_at)
  ) f
) g;

create or replace view limit_intervals as
select s.account, s.span, d.since, s.observed_at as till, d.delta
from limit_steps s
cross join lateral (
  select
    case when s.fresh = 0 then greatest(s.used_percentage - s.prev_max, 0) else s.used_percentage end as delta,
    greatest(s.prev_at, s.resets_at - s.len) as since
) d
where s.prev_at is not null and d.delta > 0 and d.since < s.observed_at;

create or replace view limit_windows as
select
  account, span, max(resets_at) as resets_at, max(resets_at) - min(len) as starts_at,
  max(used_percentage) as peak, min(observed_at) as first_at, max(observed_at) as last_at
from limit_steps
group by account, span, wnd;

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

-- Session audit (the session-audit skill, BTN-53). Context of a request is its whole prompt: input plus cache
-- read and write; context metrics take the main thread only, money takes subagents too. Tally's classifier
-- answers are not sessions. Active time sums the gaps between answers of up to 10 minutes.
create or replace view audit_sessions as
with tools as (
  select session_id, count(*) as calls,
    count(*) filter (where is_error and coalesce(error_kind, '') not in ('denied', 'hook')) as errors,
    count(*) filter (where error_kind in ('denied', 'hook')) as denied
  from tool_calls
  group by session_id
), gaps as (
  select session_id, extract(epoch from at - lag(at) over (partition by session_id order by at)) as gap
  from messages
), active as (
  select session_id, coalesce(sum(gap) filter (where gap <= 600), 0) / 60 as minutes from gaps group by session_id
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
  max(ac.minutes) as active_min,
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
    where sp.session_id = c.session_id and sp.agent_id = coalesce(c.agent_id, '') and c.at between sp.from_at and sp.to_at
  )), 0) as stuck_cost,
  coalesce(max(t.calls), 0) as tool_calls,
  coalesce(max(t.errors), 0) as tool_errors,
  coalesce(max(t.denied), 0) as tool_denied,
  coalesce(s.custom_title, s.ai_title) as title
from message_costs c
join sessions s on s.session_id = c.session_id
left join session_tasks st on st.session_id = c.session_id
left join tools t on t.session_id = c.session_id
left join active ac on ac.session_id = c.session_id
cross join lateral (
  select c.input + c.cache_write_5m + c.cache_write_1h + c.cache_read as ctx,
    lower(regexp_replace(replace(coalesce(c.project_dir, ''), '\', '/'), '^[a-zA-Z]:', '')) as dir
) x
where c.entrypoint is distinct from 'tally-classify'
group by c.session_id, st.task, s.launch_reason, s.custom_title, s.ai_title;

-- A task over all its sessions; it belongs to the period of its first message.
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
  coalesce('Переделка' = any(t.labels), false) as rework,
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
  t.title, t.status, t.labels, coalesce('Переделка' = any(t.labels), false) as rework, t.related
from st
join sessions s on s.session_id = st.session_id
left join stuck on stuck.task = st.task
left join tasks t on t.task = st.task
group by st.task, t.title, t.status, t.labels, t.related;

create table if not exists tally_meta (
  name text primary key,
  value text not null
);

create table if not exists rule_texts (
  hash text primary key,
  content text not null,
  lines int not null
);

create table if not exists rule_files (
  key text primary key,
  display text not null,
  kind text not null,
  scope text not null
);

create table if not exists rule_seen (
  session_id text not null,
  key text not null,
  hash text not null,
  at timestamptz not null,
  primary key (session_id, key, hash)
);
create index if not exists rule_seen_key on rule_seen (key, hash, at);

create table if not exists rule_snapshot_files (
  path text primary key,
  key text not null,
  size bigint not null,
  mtime text not null,
  hash text
);

create table if not exists rule_snapshots (
  key text not null,
  at timestamptz not null,
  hash text,
  primary key (key, at)
);

create table if not exists rule_edits (
  tool_use_id text primary key,
  session_id text,
  agent_id text,
  key text not null,
  at timestamptz,
  tool text not null,
  added int not null,
  removed int
);
create index if not exists rule_edits_key on rule_edits (key, at);

create table if not exists rule_changes (
  id text primary key,
  key text not null,
  at timestamptz not null,
  old_hash text,
  new_hash text,
  source text not null,
  added int not null,
  removed int not null
);
create index if not exists rule_changes_at on rule_changes (at);
alter table rule_changes drop constraint if exists rule_changes_source_check;
alter table rule_changes add constraint rule_changes_source_check
  check (source in ('snapshot', 'transcript', 'file-history', 'backup', 'git'));

create table if not exists rule_versions (
  key text not null,
  at timestamptz not null,
  hash text,
  source text not null check (source in ('file-history', 'backup', 'git')),
  ref text not null,
  primary key (key, at, source)
);

create table if not exists rule_imports (
  hash text primary key,
  id text not null,
  at timestamptz not null,
  until timestamptz,
  precision text not null,
  sessions text[] not null,
  files jsonb not null,
  purpose text[] not null,
  reason text not null,
  task text,
  source text not null
);

-- A rule change with the folder it applies to: 'global', or the folder of a project file; memory folders
-- (slug scopes) resolve through the folders sessions ran in (session-audit skill, BTN-53). `undone` — the
-- same file went back to the old text within a day, as in the false deleted-and-created pairs.
create or replace view audit_rules as
with dirs as materialized (
  select distinct lower(regexp_replace(replace(project_dir, '\', '/'), '^[a-zA-Z]:', '')) as dir
  from messages
  where project_dir is not null
)
select c.id, c.at, c.key, f.display, f.kind, c.source, c.added, c.removed,
  exists (
    select 1 from rule_changes b
    where b.key = c.key and b.id <> c.id and b.old_hash is not distinct from c.new_hash
      and b.new_hash is not distinct from c.old_hash and abs(extract(epoch from b.at - c.at)) <= 86400
  ) as undone,
  case
    when f.scope = 'global' then 'global'
    when f.scope like 'slug:%' then coalesce((
      select d.dir from dirs d
      where regexp_replace(d.dir, '[^a-z0-9]', '-', 'g') = regexp_replace(f.scope, '^slug:[a-z]-', '')
      order by d.dir
      limit 1
    ), f.scope)
    else f.scope
  end as place
from rule_changes c
join rule_files f on f.key = c.key;
