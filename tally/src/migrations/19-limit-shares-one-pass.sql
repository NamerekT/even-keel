-- v18 → v19 (BTN-1351). limit_shares in one pass: the first body joined every response with every interval of its
-- account and filtered by time after the join (messages × intervals, 122 million rows on the live database, 17–29 s a
-- read). The intervals of one (account, span) never overlap and their ends are unique snapshot times, so a response
-- belongs only to the nearest end at or after it: responses and ends merge into one stream sorted by time descending,
-- where the running minimum of the ends is that nearest end. An end sorts before a response at the same moment, so a
-- response at an interval's end stays in it; a response at or before the found interval's start gets no share. The
-- columns and their types stay those of the first body: task_costs reads it.

create or replace view limit_shares as
with iv as (select account, span, since, till, delta from limit_intervals),
ev as (
  select account, span, till as t, 0 as kind, null::text as message_id, null::text as session_id, null::text as task, null::numeric as cost
  from iv
  union all
  select c.account, s.span, c.at, 1, c.message_id, c.session_id, c.task, c.cost
  from message_costs c
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
