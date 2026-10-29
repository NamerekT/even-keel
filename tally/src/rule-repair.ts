// BTN-551: a narrowed account scan wrote unchanged ~/.claude files as deleted and restored twice.
// Delete both ends only within the incident window, comparing adjacent snapshots across its boundaries.
export const REPAIR_GLOBAL_RULE_SNAPSHOTS = `
with timeline as (
  select key, at, hash,
    lag(hash) over w as previous_hash,
    lead(hash) over w as next_hash,
    lead(at) over w as next_at
  from rule_snapshots
  where key like '~/.claude/%'
    and not exists (select 1 from tally_meta where name = 'rules_global_scan_repair_20261028')
  window w as (partition by key order by at)
), pairs as (
  select key, at, next_at from timeline
  where hash is null and previous_hash is not null and next_hash = previous_hash
    and at >= '2026-10-28 22:35:00Z'::timestamptz
    and next_at < '2026-10-28 23:09:00Z'::timestamptz
), deleted as (
  delete from rule_snapshots s using pairs p
  where s.key = p.key and (s.at = p.at or s.at = p.next_at)
  returning s.key
)
insert into tally_meta (name, value)
select 'rules_global_scan_repair_20261028', count(*)::text from deleted
on conflict (name) do nothing
returning value
`
