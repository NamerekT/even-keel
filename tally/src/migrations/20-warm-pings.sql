-- v19 → v20 (BTN-1413). The keep-warm pings: a fork of a waiting session asks for one word so the API reads its cache
-- again, and writes no transcript. Even Keel keeps each ping in its state database and the collector copies the new
-- ones at each run. They are not rows of messages: a ping is not a response of the session, and counting it as one
-- would change the count of responses and the gaps between them. `machine` is empty on the hub's own pings, and the
-- account of a machine elsewhere's is `<key>@<machine>`, as its messages' are.
create table if not exists warm_pings (
  session_id     text not null,
  at             timestamptz not null,
  machine        text not null default '',
  account        text not null,
  task           text not null,
  project_id     text,
  model          text,
  input          bigint not null,
  cache_write_5m bigint not null,
  cache_write_1h bigint not null,
  cache_read     bigint not null,
  output         bigint not null,
  primary key (session_id, at)
);

-- A ping at the API price of its model, as message_costs prices a response: the longest config prefix, the long
-- prompt rates over long_over. A ping names no provider, so no catalogue price. `ping_id` stands for a message id in
-- limit_shares; the task follows a move of its id (task_moves).
create or replace view warm_ping_costs as
select
  'warm:' || w.session_id || ':' || (extract(epoch from w.at) * 1000)::bigint as ping_id,
  w.session_id, w.at, w.machine, w.account, coalesce(mv.task, w.task) as task, w.project_id, w.model,
  w.input, w.cache_write_5m, w.cache_write_1h, w.cache_read, w.output,
  p.model as price_model,
  (w.input * r.input + w.cache_write_5m * r.cache_write_5m + w.cache_write_1h * r.cache_write_1h
    + w.cache_read * r.cache_read + w.output * r.output) / 1000000 as cost
from warm_pings w
left join task_moves mv on mv.old_task = w.task
left join (
  select distinct on (used.model) used.model as ping_model, p.*
  from (select distinct model from warm_pings where model is not null) used
  join model_prices p on p.source = 'config' and starts_with(used.model, p.model)
  order by used.model, length(p.model) desc
) p on p.ping_model = w.model
left join lateral (
  select
    case when long then p.long_input else p.input end as input,
    case when long then p.long_output else p.output end as output,
    case when long then p.long_cache_read else p.cache_read end as cache_read,
    case when long then p.long_cache_write_5m else p.cache_write_5m end as cache_write_5m,
    case when long then p.long_cache_write_1h else p.cache_write_1h end as cache_write_1h
  from (select coalesce(w.input + w.cache_read + w.cache_write_5m + w.cache_write_1h > p.long_over, false) as long) t
) r on true;

-- limit_shares as step 19 computes it, with the pings in the stream next to the responses: an interval's increase is
-- shared by both in proportion to their cost, a ping's row named by its ping_id. The columns and their types stay.
create or replace view limit_shares as
with iv as (select account, span, since, till, delta from limit_intervals),
ev as (
  select account, span, till as t, 0 as kind, null::text as message_id, null::text as session_id, null::text as task, null::numeric as cost
  from iv
  union all
  select c.account, s.span, c.at, 1, c.message_id, c.session_id, c.task, c.cost
  from message_costs c
  cross join (values ('5h'), ('7d')) s(span)
  union all
  select w.account, s.span, w.at, 1, w.ping_id, w.session_id, w.task, w.cost
  from warm_ping_costs w
  cross join (values ('5h'), ('7d')) s(span)
),
nx as (
  select ev.*, min(t) filter (where kind = 0) over (partition by account, span order by t desc, kind rows unbounded preceding) as next_till
  from ev
),
hit as (
  select i.account, i.span, i.since, i.till, n.message_id, n.session_id, n.task, n.cost, i.delta
  from nx n
  join iv i on i.account = n.account and i.span = n.span and i.till = n.next_till
  where n.kind = 1 and n.t > i.since
)
select
  account, span, since, till, message_id, session_id, task,
  delta * cost / nullif(sum(cost) over (partition by account, span, till), 0) as share
from hit;

-- task_costs as before, its limit shares now with the pings', and two columns at the end: the task's pings and their
-- cost, which `cost` leaves out (it is the responses').
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
  max(l.seven_day) as seven_day_share,
  coalesce(max(w.pings), 0) as warm_pings,
  max(w.cost) as warm_cost
from message_costs c
left join (
  select task, sum(share) filter (where span = '5h') as five_hour, sum(share) filter (where span = '7d') as seven_day
  from limit_shares
  group by task
) l on l.task = c.task
left join (
  select task, count(*) as pings, sum(cost) as cost
  from warm_ping_costs
  group by task
) w on w.task = c.task
where c.task is not null
group by c.task;
