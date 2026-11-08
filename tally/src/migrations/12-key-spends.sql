-- v11 → v12. The real spend of a chain session on a key that tells it, an OpenRouter key's `usage` (BTN-860): Even
-- Keel keeps it in its state database, and the collector copies the rows whole at each run.
create table if not exists key_spends (
  session_id text primary key,
  account    text not null,
  usd        double precision not null,
  -- Two sessions ran on the key at once: their spend cannot be told apart, and both keep only the estimate.
  shared     boolean not null,
  first_at   timestamptz not null,
  last_at    timestamptz not null
);

-- A response's cost as paid: a session's real spend laid over its responses in proportion to their estimate, or
-- evenly when the session has none; every other response pays its estimate. `cost` stays the estimate by price.
create or replace view message_paid as
select
  c.*,
  case
    when s.session_id is null then c.cost
    when s.estimate > 0 then coalesce(c.cost, 0) * s.usd / s.estimate
    else s.usd / s.messages
  end as paid
from message_costs c
left join (
  select k.session_id, k.usd, sum(m.cost) as estimate, count(*) as messages
  from key_spends k
  join message_costs m on m.session_id = k.session_id
  where not k.shared
  group by k.session_id, k.usd
) s on s.session_id = c.session_id;
