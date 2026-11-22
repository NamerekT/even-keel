-- v21 → v22. The raw row leaves `lines` for `line_raws` (BTN-1471), so reading the narrow columns no longer drags the
-- compressed JSON through the cache. The old table becomes `line_raws` whole (its heap, TOAST, key and grants stay) and
-- a new narrow `lines` is a copy of its small columns: about 100 bytes a row move, not the 2 GB of raw.
drop trigger record_compactions on lines;
drop function record_compaction_nodes();
drop function compaction_node(lines);
drop index lines_session_at;
alter table lines rename to line_raws;
alter table line_raws rename constraint lines_pkey to line_raws_pkey;

create table lines (
  uuid text not null,
  session_id text,
  agent_id text,
  type text,
  at timestamptz
);
insert into lines select uuid, session_id, agent_id, type, at from line_raws;
alter table lines add primary key (uuid);
create index lines_session_at on lines (session_id, at);
analyze lines;

-- Dropping a column rewrites nothing: its old values stay in the heap of `line_raws` until a rewrite.
alter table line_raws drop column session_id, drop column agent_id, drop column type, drop column at;

-- The collector writes a row into `lines`, then its raw into `line_raws` in the same statement: the trigger moves to
-- the raw table and takes the narrow fields from `lines`.
create function compaction_node(l lines, r line_raws) returns setof compaction_nodes language sql immutable as $$
  select l.uuid, l.type, r.raw->>'parentUuid',
    case when l.type = 'system' then l.session_id end,
    case when l.type = 'system' then l.agent_id end,
    case when l.type = 'system' then l.at end,
    case when l.type = 'system' then jsonb_build_object(
      'trigger', r.raw #> '{compactMetadata,trigger}', 'preTokens', r.raw #> '{compactMetadata,preTokens}',
      'postTokens', r.raw #> '{compactMetadata,postTokens}', 'durationMs', r.raw #> '{compactMetadata,durationMs}') end,
    (length(s) - coalesce(length(substring(s from '…\[\+\d+\]$')), 0)
      + coalesce(substring(s from '…\[\+(\d+)\]$')::int, 0))::int
  from (select case when l.type = 'user' then
    case jsonb_typeof(r.raw->'message'->'content')
      when 'string' then r.raw->'message'->>'content'
      when 'array' then (select string_agg(b->>'text', '' order by n)
        from jsonb_array_elements(r.raw->'message'->'content') with ordinality a(b,n) where b->>'type' = 'text')
    end end as s) summary
  where (l.type = 'attachment' and r.raw->>'parentUuid' is not null)
     or (l.type = 'system' and r.raw->>'subtype' = 'compact_boundary')
     or (l.type = 'user' and r.raw->>'isCompactSummary' = 'true')
$$;

create function record_compaction_nodes() returns trigger language plpgsql as $$
begin
  insert into compaction_nodes
  select n.* from inserted r join lines l on l.uuid = r.uuid cross join lateral compaction_node(l, r) n
  where l.type in ('attachment', 'system', 'user');
  return null;
end $$;
create trigger record_compactions after insert on line_raws referencing new table as inserted
for each statement execute function record_compaction_nodes();
