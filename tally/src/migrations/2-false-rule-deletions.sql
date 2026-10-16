-- v1 → v2 (BTN-150). A collector run that read no project (the config unread or of another form) wrote every
-- live project rule file as deleted, and a later run as created again. Such a run is one whose deletions of
-- project files (keys not under ~/) cover every project file live before it. Its deletions go; so do the
-- snapshot changes from each deletion up to the key's next snapshot, which the next run derives anew: one
-- change old → new where the text differs, none where it came back the same.

create temp table false_rule_deletions on commit drop as
with project as (
  select key, at, hash, lag(hash) over w as before, lead(at) over w as next_at
  from rule_snapshots
  where key not like '~/%'
  window w as (partition by key order by at)
),
deleted as (
  select at, count(*) as files from project where hash is null and before is not null group by at
),
live as (
  select d.at, count(*) as files
  from deleted d
  cross join lateral (
    select distinct on (s.key) s.hash
    from rule_snapshots s
    where s.key not like '~/%' and s.at < d.at
    order by s.key, s.at desc
  ) last
  where last.hash is not null
  group by d.at
)
select p.key, p.at, p.next_at
from project p
join deleted d on d.at = p.at
join live l on l.at = p.at and l.files = d.files
where p.hash is null and p.before is not null;

delete from rule_changes c
using false_rule_deletions f
where c.source = 'snapshot' and c.key = f.key and c.at >= f.at and (f.next_at is null or c.at <= f.next_at);

delete from rule_snapshots s
using false_rule_deletions f
where s.key = f.key and s.at = f.at;
