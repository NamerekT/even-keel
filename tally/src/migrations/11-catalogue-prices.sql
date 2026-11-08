-- v10 → v11. A model with no price in tally.config.json takes one from OpenCode's copy of the models.dev catalogue
-- (BTN-859). A response keeps the provider it was served by: the catalogue prices `<provider>/<model>`, and one model
-- costs differently at different providers. A price row keeps its source: a catalogue row is one exact model, never a
-- prefix, and a config price always wins over it.

-- Claude's responses are Anthropic's, Codex's OpenAI's; OpenCode's name their own, Copilot's and the classifier's none.
alter table messages add column if not exists provider text;
update messages set provider = case when entrypoint like 'codex%' then 'openai' else 'anthropic' end
where provider is null
  and message_id not like 'opencode:%' and message_id not like 'copilot:%' and message_id not like 'tally-classify:%';
-- OpenCode's databases are read whole again, so their older responses get the provider too.
delete from files where path like '%opencode.db';

alter table model_prices add column if not exists source text not null default 'config' check (source in ('config', 'catalogue'));
-- A config prefix may be spelled as a catalogue key (`minimax/minimax-m3.1-flash`).
alter table model_prices drop constraint model_prices_pkey;
alter table model_prices add primary key (source, model);

-- A message gives its spend to the task of its session, as the audit counts it (BTN-79): the start of a manual
-- session before its branch is not lost, and a session that touched two tasks goes wholly to the first.
create or replace view message_costs as
select
  m.message_id, m.session_id, m.agent_id, m.account, m.project, m.project_dir,
  coalesce(st.task, m.task) as task,
  m.branch, m.entrypoint, m.model, m.speed, m.at,
  m.input, m.cache_write_5m, m.cache_write_1h, m.cache_read, m.output,
  p.model as price_model,
  (m.input * r.input + m.cache_write_5m * r.cache_write_5m + m.cache_write_1h * r.cache_write_1h
    + m.cache_read * r.cache_read + m.output * r.output) / 1000000 as cost,
  p.source as price_source
from messages m
left join session_tasks st on st.session_id = m.session_id
-- The price once per model and provider, not per message: per message it cost PGlite 0.6 s on every read. The longest
-- config prefix of the model, else the catalogue row of exactly `<provider>/<model>`. No provider is '' so the join
-- stays an equality.
left join (
  select distinct on (used.model, used.provider) used.model as message_model, used.provider as message_provider, p.*
  from (select distinct model, coalesce(provider, '') as provider from messages) used
  join model_prices p
    on (p.source = 'config' and starts_with(used.model, p.model))
    or (p.source = 'catalogue' and used.provider <> '' and p.model = used.provider || '/' || used.model)
  order by used.model, used.provider, p.source = 'config' desc, length(p.model) desc
) p on p.message_model = m.model and p.message_provider = coalesce(m.provider, '')
-- A prompt over long_over tokens pays the long prompt rates on all of its tokens.
left join lateral (
  select
    case when long then p.long_input else p.input end as input,
    case when long then p.long_output else p.output end as output,
    case when long then p.long_cache_read else p.cache_read end as cache_read,
    case when long then p.long_cache_write_5m else p.cache_write_5m end as cache_write_5m,
    case when long then p.long_cache_write_1h else p.cache_write_1h end as cache_write_1h
  from (select coalesce(m.input + m.cache_read + m.cache_write_5m + m.cache_write_1h > p.long_over, false) as long) t
) r on true;
