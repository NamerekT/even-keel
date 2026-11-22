-- v20 → v21. The collector projects analysis inputs from each incoming transcript chunk.
create table session_activity (
  uuid text primary key,
  session_id text not null,
  at timestamptz,
  event jsonb not null,
  prompt text
);
create index session_activity_order on session_activity(session_id, at, uuid);

-- A summary can precede its boundary or arrive in a later chunk. Keep attachment ancestry,
-- boundary counters and summary lengths so the page can resolve them in either order.
create table compaction_nodes (
  uuid text primary key,
  kind text not null,
  parent text,
  session_id text,
  agent_id text,
  at timestamptz,
  meta jsonb,
  chars integer
);

create function compaction_node(l lines) returns setof compaction_nodes language sql immutable as $$
  select l.uuid, l.type, l.raw->>'parentUuid',
    case when l.type = 'system' then l.session_id end,
    case when l.type = 'system' then l.agent_id end,
    case when l.type = 'system' then l.at end,
    case when l.type = 'system' then jsonb_build_object(
      'trigger', l.raw #> '{compactMetadata,trigger}', 'preTokens', l.raw #> '{compactMetadata,preTokens}',
      'postTokens', l.raw #> '{compactMetadata,postTokens}', 'durationMs', l.raw #> '{compactMetadata,durationMs}') end,
    (length(s) - coalesce(length(substring(s from '…\[\+\d+\]$')), 0)
      + coalesce(substring(s from '…\[\+(\d+)\]$')::int, 0))::int
  from (select case when l.type = 'user' then
    case jsonb_typeof(l.raw->'message'->'content')
      when 'string' then l.raw->'message'->>'content'
      when 'array' then (select string_agg(b->>'text', '' order by n)
        from jsonb_array_elements(l.raw->'message'->'content') with ordinality a(b,n) where b->>'type' = 'text')
    end end as s) summary
  where (l.type = 'attachment' and l.raw->>'parentUuid' is not null)
     or (l.type = 'system' and l.raw->>'subtype' = 'compact_boundary')
     or (l.type = 'user' and l.raw->>'isCompactSummary' = 'true')
$$;

insert into compaction_nodes
select n.* from lines l cross join lateral compaction_node(l) n
where l.type in ('attachment', 'system', 'user');

create function record_compaction_nodes() returns trigger language plpgsql as $$
begin
  insert into compaction_nodes
  select n.* from inserted l cross join lateral
    compaction_node(row(l.uuid, l.session_id, l.agent_id, l.type, l.at, l.raw)::lines) n
  where l.type in ('attachment', 'system', 'user');
  return null;
end $$;
create trigger record_compactions after insert on lines referencing new table as inserted
for each statement execute function record_compaction_nodes();

create index compaction_node_kinds on compaction_nodes(kind) where kind in ('user', 'system');
create or replace view compactions as
with recursive up(summary, chars, ancestor, depth) as (
  select uuid, chars, parent, 1 from compaction_nodes where kind = 'user'
  union all
  select u.summary, u.chars, p.parent, u.depth + 1 from up u
  join compaction_nodes p on p.uuid = u.ancestor and p.kind = 'attachment'
  where u.depth < 20
),
summaries as (
  select distinct on (ancestor) ancestor, chars from up order by ancestor, depth, summary
)
select b.session_id, b.agent_id, b.uuid, b.at, b.meta->>'trigger' as trigger,
  (b.meta->>'preTokens')::int as pre_tokens, (b.meta->>'postTokens')::int as post_tokens,
  (b.meta->>'durationMs')::int as duration_ms, s.chars as summary_chars,
  (row_number() over stream)::int as seq, lead(b.at) over stream as next_at
from compaction_nodes b left join summaries s on s.ancestor = b.uuid
where b.kind = 'system'
window stream as (partition by b.session_id, b.agent_id order by b.at, b.uuid);

drop index sessions_machine;
