-- v14 → v15 (BTN-1076). A built-in project switched to the tracker its tasks were copied into names them anew: the
-- old id `ABC-5` is linked to the new `GH-12` (`task_moves`, from Even Keel's `tracker_export_tasks`), and a session
-- of the old id counts for the new one. Raw rows keep the old id; only the view maps it, and every task view reads it.

create table if not exists task_moves (
  old_task text primary key,
  task     text not null
);

create or replace view session_tasks as
select b.session_id, coalesce(mv.task, b.task) as task
from (
  select s.session_id, coalesce(s.launch_task, n.task, f.task) as task
  from sessions s
  left join (
    select distinct on (session_id) session_id, task
    from messages
    where task is not null
    order by session_id, at, message_id
  ) f on f.session_id = s.session_id
  left join lateral (
    select upper(x.m[1]) as task
    from (values (1, s.custom_title), (2, s.ai_title), (3, s.prompt)) t(rank, txt)
    cross join lateral regexp_matches(
      t.txt, '(?<![A-Za-z0-9])(' || split_part(f.task, '-', 1) || '-[0-9]+)(?![0-9])', 'gi'
    ) with ordinality x(m, pos)
    where s.launch_task is null and f.task is not null and t.txt is not null
    order by upper(x.m[1]) = f.task desc, t.rank, x.pos
    limit 1
  ) n on true
) b
left join task_moves mv on mv.old_task = b.task;
