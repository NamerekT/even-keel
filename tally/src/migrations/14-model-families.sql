-- v13 → v14 (BTN-967). Keep this expression identical to familyOf in src/stats/base-sql.ts.
-- The view keeps its columns; only the family expression changes.

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
    select mode() within group (order by coalesce(
      substring(s.model from '^claude-([a-z]+)'),
      substring(s.model from '^(?:openai/)?gpt-[0-9.]+-(sol|luna|astra|terra)(?:-|$)'),
      substring(s.model from '^(?:openai/)?(gpt)-'),
      substring(lower(s.model) from '^(?:[^/]+/)?(deepseek|qwen|gemini|kimi|glm|mistral|llama)(?:[-./0-9]|$)')
    ))
    from audit_sessions s where s.task = a.task
  ) as model_family,
  a.title, a.status
from audit_tasks a
left join task_times tt on tt.task = a.task
left join tasks t on t.task = a.task;
