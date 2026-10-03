// $1 Baton project keys, $2 their repository paths without drive, $3 time zone, $4 scope, $5 account or null,
// $6 folders without drive and $7 their groups (folderGroups).
// A message belongs to the Baton project of its task key, a message without a task to the Baton project
// whose repository holds its folder, anything else to the group of its folder.
export const BASE = `
with base as (
  select c.message_id, c.session_id, coalesce(c.agent_id, '') as agent_id, c.task, c.at, c.cost, c.model, c.entrypoint,
    s.launch_reason,
    coalesce(
      case when split_part(c.task, '-', 1) = any($1::text[]) then split_part(c.task, '-', 1) end,
      case when c.task is null then (
        select b.key from unnest($1::text[], $2::text[]) as b(key, dir)
        where d.dir = b.dir or starts_with(d.dir, b.dir || '/')
        order by length(b.dir) desc
        limit 1
      ) end,
      (select g.label from unnest($6::text[], $7::text[]) as g(dir, label) where g.dir = d.dir),
      c.project,
      '?'
    ) as project
  from message_costs c
  left join sessions s on s.session_id = c.session_id
  cross join lateral (
    select lower(regexp_replace(replace(coalesce(c.project_dir, ''), '\\', '/'), '^[a-zA-Z]:', '')) as dir
  ) d
  where ($4::text = 'all' or s.launch_reason is not null) and ($5::text is null or c.account = $5::text)
), seven as (
  select message_id, sum(share) as share from limit_shares where span = '7d' group by message_id
)`
