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
-- The effort level the CLI sent with the request (low … max), absent before the CLI recorded it.
alter table messages add column if not exists effort text;
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
-- The folder of the first answer: the session counts there on /stats even after cd elsewhere.
alter table sessions add column if not exists project_dir text;
-- The first human prompt of the main thread ('' — none in a day), for the task the session names itself.
alter table sessions add column if not exists prompt text;

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
alter table model_prices add column if not exists long_over bigint;
alter table model_prices add column if not exists long_input numeric;
alter table model_prices add column if not exists long_output numeric;
alter table model_prices add column if not exists long_cache_read numeric;
alter table model_prices add column if not exists long_cache_write_5m numeric;
alter table model_prices add column if not exists long_cache_write_1h numeric;

-- The task of a session: its launch task, else the task of its first message with one. One pass over messages,
-- not a lookup per session: message_costs joins it on every read. A manual session in a checkout left on a task
-- branch often works on another task of the project: when its titles and first prompt name tasks of the branch's
-- project but not the branch's own, the first named one wins (custom title, generated title, prompt).
create or replace view session_tasks as
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
) n on true;

-- A message gives its spend to the task of its session, as the audit counts it (BTN-79): the start of a manual
-- session before its branch is not lost, and a session that touched two tasks goes wholly to the first.
create or replace view message_costs as
select
  m.message_id, m.session_id, m.agent_id, m.account, m.project, m.project_dir,
  coalesce(st.task, m.task) as task,
  m.branch, m.entrypoint, m.model, m.speed, m.at,
  m.input, m.cache_write_5m, m.cache_write_1h, m.cache_read, m.output,
  p.model as price_model,
  (m.input * r.input + m.cache_write_5m * r.cache_write_5m + m.cache_write_1h * r.cache_write_1h
    + m.cache_read * r.cache_read + m.output * r.output) / 1000000 as cost
from messages m
left join session_tasks st on st.session_id = m.session_id
-- The longest price prefix once per model, not per message: per message it cost PGlite 0.6 s on every read.
left join (
  select distinct on (used.model) used.model as message_model, p.*
  from (select distinct model from messages) used
  join model_prices p on starts_with(used.model, p.model)
  order by used.model, length(p.model) desc
) p on p.message_model = m.model
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

alter table tasks add column if not exists priority text;
alter table tasks add column if not exists estimate_h numeric;
alter table tasks add column if not exists component text;
alter table tasks add column if not exists done boolean;
alter table tasks add column if not exists reported_h numeric;
alter table tasks add column if not exists reported_at timestamptz;

-- A turn of the main thread (src/turns.ts): from the line that started it to the last reply before the next one.
create table if not exists turns (
  session_id text not null,
  start_uuid text not null,
  start text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  replies int not null,
  ask_s numeric not null,
  limited boolean not null,
  cli_s numeric,
  primary key (session_id, start_uuid)
);
alter table turns add column if not exists cli_s numeric;

create table if not exists turn_sessions (
  session_id text primary key,
  last_at timestamptz,
  key text not null
);

-- Active time is the turn less the questions to the user inside it, and no more than the CLI's own turn duration
-- (cli only): that one also leaves out permission prompts, which the transcript does not show. Waiting is the
-- questions, the permission prompts so found, and the gaps before a user's prompt, except after a turn cut by
-- the usage limit.
create or replace view session_times as
select
  session_id,
  count(*) filter (where replies > 0) as turns,
  min(started_at) as first_at,
  max(ended_at) as last_at,
  sum(least(turn_s, coalesce(cli_s, turn_s))) as active_s,
  sum(ask_s + greatest(turn_s - coalesce(cli_s, turn_s), 0))
    + coalesce(sum(gap) filter (where start = 'prompt' and not prev_limited and gap > 0), 0) as wait_s
from (
  select t.*,
    greatest(extract(epoch from t.ended_at - t.started_at) - t.ask_s, 0) as turn_s,
    extract(epoch from t.started_at - lag(t.ended_at) over w) as gap,
    coalesce(lag(t.limited) over w, false) as prev_limited
  from turns t
  window w as (partition by t.session_id order by t.started_at, t.start_uuid)
) x
group by session_id;

-- Total time runs from the first turn of the task to the last one.
create or replace view task_times as
select
  st.task,
  count(*) as sessions,
  sum(x.turns) as turns,
  min(x.first_at) as first_at,
  max(x.last_at) as last_at,
  sum(x.active_s) as active_s,
  sum(x.wait_s) as wait_s,
  extract(epoch from max(x.last_at) - min(x.first_at)) as total_s
from session_times x
join session_tasks st on st.session_id = x.session_id
where st.task is not null
group by st.task;

create or replace view stuck_spans as
select
  sp.id, sp.session_id, sp.agent_id, st.task, sp.from_at, sp.to_at, sp.kinds,
  r.reason, r.note, r.prompt_version, r.classified_at
from spans sp
left join session_tasks st on st.session_id = sp.session_id
left join span_reasons r on r.span_id = sp.id;

-- Session audit (the session-audit skill, BTN-53). Context of a request is its whole prompt: input plus cache
-- read and write; context metrics take the main thread only, money takes subagents too. Tally's classifier
-- answers are not sessions. Active time and waiting come from the turns (session_times).
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
left join session_times tm on tm.session_id = c.session_id
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

-- Time of a task against its estimate (BTN-55). A separate view: the audit views keep their columns, so a
-- collector on an older schema.sql can still replace them.
create or replace view task_estimates as
select
  a.task, a.key, a.dir, a.first_at, a.last_at, a.sessions, a.cost,
  tt.active_s / 60 as active_min,
  tt.wait_s / 60 as wait_min,
  tt.total_s / 60 as total_min,
  t.estimate_h,
  tt.active_s / 3600 / nullif(t.estimate_h, 0) as fact_ratio,
  t.priority, t.component, t.done, t.reported_h,
  (
    select mode() within group (order by substring(s.model from '(opus|sonnet|haiku)'))
    from audit_sessions s where s.task = a.task
  ) as model_family,
  a.title, a.status
from audit_tasks a
left join task_times tt on tt.task = a.task
left join tasks t on t.task = a.task;

-- The effort level of a session: the most frequent one of its main thread; mixed when it was changed midway.
create or replace view session_efforts as
select
  session_id,
  mode() within group (order by effort) as effort,
  count(distinct effort) > 1 as mixed
from messages
where agent_id is null and effort is not null
group by session_id;

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

-- Shell commands as steps (BTN-56, src/step-runs.ts): one row per launched command, polls of a background or
-- detached run are not runs of their own. `place` is the worktree (or folder) and git branch of the launch.
create table if not exists step_runs (
  tool_use_id text primary key,
  session_id text not null,
  agent_id text not null,
  step text,
  signature text not null,
  command text not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  seconds numeric not null,
  mode text not null,
  end_by text not null,
  outcome text,
  place text not null,
  polls int not null
);
create index if not exists step_runs_session on step_runs (session_id);
create index if not exists step_runs_step on step_runs (step, started_at);

create table if not exists step_sessions (
  session_id text primary key,
  last_at timestamptz,
  key text not null
);

-- A run is cold when it is the first of its step in its worktree and branch: a new worktree or a slot switched
-- to another branch.
create or replace view step_runs_x as
select r.*,
  case when r.step is not null then
    row_number() over (partition by r.step, r.place order by r.started_at, r.tool_use_id) = 1
  end as cold,
  st.task, s.project
from step_runs r
left join session_tasks st on st.session_id = r.session_id
left join sessions s on s.session_id = r.session_id;

-- Weekly spread of a step per project folder (sessions.project), for the audit skill.
create or replace view step_weeks as
select project, step, date_trunc('week', started_at at time zone 'UTC')::date as week,
  count(*) as n,
  percentile_cont(0.5) within group (order by seconds) as p50,
  percentile_cont(0.9) within group (order by seconds) as p90,
  max(seconds) as max,
  count(*) filter (where cold) as cold,
  count(*) filter (where outcome in ('fail', 'timeout')) as failed
from step_runs_x
where step is not null
group by project, step, week;

-- A week against the one before it; growth thresholds come from tally.config.json (tally_meta 'steps').
create or replace view step_growth as
with w as (
  select g.*,
    lag(g.week) over x as prev_week, lag(g.n) over x as prev_n, lag(g.p50) over x as prev_p50, lag(g.p90) over x as prev_p90
  from step_weeks g
  window x as (partition by g.project, g.step order by g.week)
), t as (
  select coalesce((m.value::jsonb->'growth'->>'ratio')::numeric, 1.5) as ratio,
    coalesce((m.value::jsonb->'growth'->>'minRuns')::int, 5) as min_runs,
    coalesce((m.value::jsonb->'growth'->>'minSeconds')::numeric, 10) as min_seconds
  from (select 1) one
  left join tally_meta m on m.name = 'steps'
)
select w.project, w.step, w.week, w.n, w.p50, w.p90, w.max, w.prev_week, w.prev_n, w.prev_p50, w.prev_p90,
  w.n >= t.min_runs and w.prev_n >= t.min_runs and w.p50 >= w.prev_p50 * t.ratio and w.p50 - w.prev_p50 >= t.min_seconds as grew_p50,
  w.n >= t.min_runs and w.prev_n >= t.min_runs and w.p90 >= w.prev_p90 * t.ratio and w.p90 - w.prev_p90 >= t.min_seconds as grew_p90
from w cross join t
where w.prev_week is not null;

-- What a handoff gave the new session (session_id): Even Keel's snapshot, or for older handoffs the prompt from the
-- new transcript and the note rebuilt from the old one's Write and Edit calls (source = 'transcript').
create table if not exists handoffs (
  session_id text primary key,
  previous text not null,
  task text not null,
  reason text not null,
  at timestamptz,
  source text not null check (source in ('even-keel', 'transcript')),
  prompt text not null,
  note_path text,
  note text
);
create index if not exists handoffs_task on handoffs (task);

create or replace view handoff_notes as
select h.session_id, h.previous, h.task, h.reason, h.at, h.source, h.note_path,
  length(h.prompt) as prompt_chars, length(h.note) as note_chars,
  array(select m[1] from regexp_matches(coalesce(h.note, ''), '^#{1,6}[ \t]+(.+?)[ \t\r]*$', 'gn') m) as headings
from handoffs h;
