-- v4 → v5. A task's milestone, and the cost per milestone of a project (BTN-172): several Even Keel projects (a
-- release clone next to the main one) share one tracker project and its task keys, so a release is told apart
-- only by the milestone. Every task fetched before is asked again at the next run, for its milestone.

alter table tasks add column if not exists milestone text;
update tasks set fetched_at = 'epoch' where title is not null;

-- The project is the key of the task id: a release project's tasks count under the tracker project they live in.
create or replace view milestone_costs as
select
  split_part(c.task, '-', 1) as project,
  t.milestone,
  count(*) as tasks,
  count(*) filter (where t.done) as done,
  sum(c.sessions) as sessions,
  sum(c.messages) as messages,
  min(c.first_at) as first_at,
  max(c.last_at) as last_at,
  sum(c.cost) as cost,
  sum(c.unpriced) as unpriced,
  sum(c.five_hour_share) as five_hour_share,
  sum(c.seven_day_share) as seven_day_share
from task_costs c
left join tasks t on t.task = c.task
group by 1, 2;
