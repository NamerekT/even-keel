-- v3 → v4. Context compactions as rows, so a compaction can be compared with a handoff (BTN-254). A compaction
-- keeps the session: its boundary splits the stream into segments, and the segment after it is a virtual successor.
-- Pure SQL over lines: every compaction ever collected shows at once.
--
-- The summary is a user line with isCompactSummary under the boundary: its child in older CLIs, in newer ones
-- below the attachments the CLI writes between them. A summary longer than the cut in compact.ts ends with
-- `…[+N]`, N being the characters cut off.

create or replace view compactions as
with recursive boundaries as (
  select l.session_id, l.agent_id, l.uuid, l.at, l.raw->'compactMetadata' as meta
  from lines l
  where l.type = 'system' and l.raw->>'subtype' = 'compact_boundary'
),
up (summary, content, ancestor, depth) as (
  select s.uuid, s.raw->'message'->'content', s.raw->>'parentUuid', 1
  from lines s
  where s.type = 'user' and s.raw->>'isCompactSummary' = 'true'
  union all
  select up.summary, up.content, p.raw->>'parentUuid', up.depth + 1
  from up
  join lines p on p.uuid = up.ancestor and p.type = 'attachment'
  where up.depth < 20
),
summaries as (
  select distinct on (b.uuid) b.uuid as boundary,
    case jsonb_typeof(up.content)
      when 'string' then up.content #>> '{}'
      else (select string_agg(block->>'text', '') from jsonb_array_elements(up.content) block where block->>'type' = 'text')
    end as text
  from up
  join boundaries b on b.uuid = up.ancestor
  order by b.uuid, up.depth
)
select b.session_id, b.agent_id, b.uuid, b.at,
  b.meta->>'trigger' as trigger,
  (b.meta->>'preTokens')::int as pre_tokens,
  (b.meta->>'postTokens')::int as post_tokens,
  (b.meta->>'durationMs')::int as duration_ms,
  (
    length(s.text)
    - coalesce(length(substring(s.text from '…\[\+\d+\]$')), 0)
    + coalesce(substring(s.text from '…\[\+(\d+)\]$')::int, 0)
  )::int as summary_chars,
  (row_number() over stream)::int as seq,
  lead(b.at) over stream as next_at
from boundaries b
left join summaries s on s.boundary = b.uuid
window stream as (partition by b.session_id, b.agent_id order by b.at, b.uuid);
