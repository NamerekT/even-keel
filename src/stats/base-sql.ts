// $1 Even Keel project keys, $2 their repository paths without drive, $3 time zone, $4 scope, $5 account or null,
// $6 folders without drive and $7 their groups (folderGroups).
// A message belongs to the Even Keel project of its task key, a message without a task to the Even Keel project
// whose repository holds its folder, anything else to the group of its folder. The folder is the one the session
// started in, so a session that ran cd stays in one project. A session started in the temp folder of another
// session (<config>/jobs/<first 8 of its id>/tmp, a test the other one ran) takes that one's task and folder.
// Folders are resolved once each in places and joined: per message the lookups cost ~4 s on 60k messages.
export const BASE = `
with places as materialized (
  select f.project_dir, p.task,
    (
      select b.key from unnest($1::text[], $2::text[]) as b(key, dir)
      where e.dir = b.dir or starts_with(e.dir, b.dir || '/')
      order by length(b.dir) desc
      limit 1
    ) as tracked,
    (select g.label from unnest($6::text[], $7::text[]) as g(dir, label) where g.dir = e.dir) as label
  from (select distinct project_dir from messages where project_dir is not null) f
  cross join lateral (
    select lower(regexp_replace(replace(f.project_dir, '\\', '/'), '^[a-zA-Z]:', '')) as dir
  ) d
  left join lateral (
    select ps.project_dir, coalesce(ps.launch_task, (
      select m.task from messages m where m.session_id = ps.session_id and m.task is not null order by m.at limit 1
    )) as task
    from sessions ps
    where d.dir ~ '/jobs/[0-9a-f]{8}/tmp(/|$)'
      and left(ps.session_id, 8) = substring(d.dir from '/jobs/([0-9a-f]{8})/tmp(?:/|$)')
    limit 1
  ) p on true
  cross join lateral (
    select coalesce(lower(regexp_replace(replace(p.project_dir, '\\', '/'), '^[a-zA-Z]:', '')), d.dir) as dir
  ) e
), base as (
  select c.message_id, c.session_id, coalesce(c.agent_id, '') as agent_id, t.task, c.at, c.cost, c.model, c.entrypoint,
    s.launch_reason,
    coalesce(
      case when split_part(t.task, '-', 1) = any($1::text[]) then split_part(t.task, '-', 1) end,
      case when t.task is null then pl.tracked end,
      pl.label,
      c.project,
      '?'
    ) as project
  from message_costs c
  left join sessions s on s.session_id = c.session_id
  left join places pl on pl.project_dir = coalesce(s.project_dir, c.project_dir)
  cross join lateral (select coalesce(pl.task, c.task) as task) t
  where ($4::text = 'all' or s.launch_reason is not null) and ($5::text is null or c.account = $5::text)
), seven as (
  select message_id, sum(share) as share from limit_shares where span = '7d' group by message_id
)`
