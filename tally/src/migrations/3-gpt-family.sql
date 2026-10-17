-- v2 → v3 (BTN-170). Codex sessions run on OpenAI models: a task's model_family is gpt for them, beside opus,
-- sonnet and haiku. The view keeps its columns; only the family expression changes.

create or replace view task_estimates as
select
  a.task, a.key, a.dir, a.first_at, a.last_at, a.sessions, a.cost,
  tt.active_s / 60 as active_min,
  tt.wait_s / 60 as wait_min,
  tt.total_s / 60 as total_min,
  t.estimate_h,
  tt.active_s / 3600 / nullif(t.estimate_h, 0) as fact_ratio,
  t.priority, t.component, t.done, t.reported_h,
  (
    select mode() within group (order by coalesce(substring(s.model from '(opus|sonnet|haiku)'), substring(s.model from '^(gpt)-')))
    from audit_sessions s where s.task = a.task
  ) as model_family,
  a.title, a.status
from audit_tasks a
left join task_times tt on tt.task = a.task
left join tasks t on t.task = a.task;
