-- Frozen sample at schema version 86 (BTN-1696): the sample of 85 and a project chat's own choice of packages
-- (`chats.packages`, `chat_choices.packages`); the other chats keep null.
-- Frozen sample; never edit a merged sample.
create table schema_version (
  only_row    boolean primary key default true check (only_row),
  version     integer not null,
  migrated_at timestamptz not null default now()
);
insert into schema_version (version) values (86);
create table builtin_counters (
  project_id text primary key,
  last       integer not null
);
insert into builtin_counters (project_id, last) values ('11111111-1111-4111-8111-111111111111', 3);
create table builtin_milestones (
  id         text primary key,
  project_id text not null,
  name       text not null,
  date       bigint,
  description text not null default '',
  status      text not null default 'planned' check (status in ('planned', 'active', 'completed', 'canceled')),
  closed_at   text,
  created_at  text
);
create unique index builtin_milestones_name on builtin_milestones (project_id, lower(name));
insert into builtin_milestones (id, project_id, name, date, description, status, closed_at, created_at) values
  ('m0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'v0.3', 1795000000000, 'The parser reads both formats.', 'active', null, '2026-11-06T08:55:00.000Z'),
  ('m0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'v0.2', 1794000000000, '', 'completed', '2026-11-05T18:00:00.000Z', '2026-11-01T08:00:00.000Z');
create table builtin_labels (
  id         text primary key,
  project_id text not null,
  name       text not null,
  color      integer not null
);
create unique index builtin_labels_name on builtin_labels (project_id, lower(name));
insert into builtin_labels (id, project_id, name, color) values
  ('l0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Bug', 7);
create table builtin_components (
  id          text primary key,
  project_id  text not null,
  name        text not null,
  description text not null default '',
  created_at  text not null
);
create unique index builtin_components_name on builtin_components (project_id, lower(name));
insert into builtin_components (id, project_id, name, description, created_at) values
  ('c0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 'Parser', 'Reading the input files.', '2026-11-06T08:50:00.000Z'),
  ('c0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Docs', '', '2026-11-06T08:51:00.000Z');
create table builtin_tasks (
  id              text primary key,
  project_id      text not null,
  number          integer not null,
  title           text not null,
  description     text not null,
  description_rev integer not null,
  status          text not null,
  priority        text not null,
  milestone_id    text references builtin_milestones (id) on delete set null deferrable initially deferred,
  parent_id       text references builtin_tasks (id) on delete set null deferrable initially deferred,
  version         integer not null,
  created_at      text not null,
  updated_at      text not null,
  estimate        integer,
  component_id    text references builtin_components (id) on delete set null deferrable initially deferred,
  unique (project_id, number)
);
create index builtin_tasks_parent on builtin_tasks (parent_id);
insert into builtin_tasks (id, project_id, number, title, description, description_rev, status, priority, milestone_id, parent_id, version, created_at, updated_at, estimate, component_id) values
  ('t0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 1, 'Parse the example input', 'Read the sample file.', 2, 'Done', 'high', 'm0000000-0000-4000-8000-000000000001', null, 6, '2026-11-06T09:00:00.000Z', '2026-11-06T11:10:00.000Z', 20, 'c0000000-0000-4000-8000-000000000001'),
  ('t0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 2, 'Accept the second input format', '', 0, 'Todo', 'none', 'm0000000-0000-4000-8000-000000000001', 't0000000-0000-4000-8000-000000000001', 3, '2026-11-06T09:10:00.000Z', '2026-11-06T09:20:00.000Z', null, null);
create table builtin_task_labels (
  task_id  text not null references builtin_tasks (id) on delete cascade deferrable initially deferred,
  label_id text not null references builtin_labels (id) on delete cascade deferrable initially deferred,
  primary key (task_id, label_id)
);
insert into builtin_task_labels (task_id, label_id) values ('t0000000-0000-4000-8000-000000000002', 'l0000000-0000-4000-8000-000000000001');
create table builtin_relations (
  from_id text not null references builtin_tasks (id) on delete cascade deferrable initially deferred,
  to_id   text not null references builtin_tasks (id) on delete cascade deferrable initially deferred,
  kind    text not null check (kind in ('blocks', 'relates')),
  primary key (from_id, to_id, kind)
);
create index builtin_relations_to on builtin_relations (to_id);
insert into builtin_relations (from_id, to_id, kind) values ('t0000000-0000-4000-8000-000000000001', 't0000000-0000-4000-8000-000000000002', 'blocks');
create table builtin_comments (
  id      integer generated by default as identity primary key,
  task_id text not null references builtin_tasks (id) on delete cascade deferrable initially deferred,
  author  text not null check (author in ('person', 'agent', 'service')),
  body    text not null,
  at      text not null,
  model   text,
  author_name text
);
create index builtin_comments_task on builtin_comments (task_id, id);
insert into builtin_comments (task_id, author, body, at, model) values
  ('t0000000-0000-4000-8000-000000000001', 'agent', 'Done: the parser.', '2026-11-06T11:00:00.000Z', 'Claude | opus'),
  ('t0000000-0000-4000-8000-000000000001', 'person', 'Checked by hand.', '2026-11-06T11:05:00.000Z', null);
create table builtin_files (
  id      text primary key,
  task_id text not null references builtin_tasks (id) on delete cascade deferrable initially deferred,
  name    text not null,
  type    text not null,
  size    bigint not null,
  sha256  text not null,
  at      text not null,
  unique (task_id, sha256)
);
create index builtin_files_sha on builtin_files (sha256);
insert into builtin_files (id, task_id, name, type, size, sha256, at) values
  ('f0000000-0000-4000-8000-000000000001', 't0000000-0000-4000-8000-000000000001', 'screenshot.png', 'image/png', 68, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '2026-11-07T09:00:00.000Z');
create table builtin_history (
  id           integer generated by default as identity primary key,
  project_id   text not null,
  task_id      text references builtin_tasks (id) on delete cascade deferrable initially deferred,
  milestone_id text,
  at           text not null,
  author       text not null check (author in ('person', 'agent', 'service')),
  model        text,
  field        text not null,
  before       text,
  after        text,
  author_name  text,
  component_id text
);
create index builtin_history_task on builtin_history (task_id, id);
create index builtin_history_milestone on builtin_history (milestone_id, id);
create index builtin_history_component on builtin_history (component_id, id);
insert into builtin_history (project_id, task_id, milestone_id, at, author, model, field, before, after) values
  ('11111111-1111-4111-8111-111111111111', null, 'm0000000-0000-4000-8000-000000000001', '2026-11-06T08:55:00.000Z', 'person', null, 'created', null, 'v0.3'),
  ('11111111-1111-4111-8111-111111111111', null, 'm0000000-0000-4000-8000-000000000001', '2026-11-06T08:56:00.000Z', 'person', null, 'date', null, '1795000000000'),
  ('11111111-1111-4111-8111-111111111111', 't0000000-0000-4000-8000-000000000001', null, '2026-11-06T09:00:00.000Z', 'person', null, 'created', null, null),
  ('11111111-1111-4111-8111-111111111111', 't0000000-0000-4000-8000-000000000001', null, '2026-11-06T10:00:00.000Z', 'service', null, 'status', 'Todo', 'In Progress'),
  ('11111111-1111-4111-8111-111111111111', 't0000000-0000-4000-8000-000000000001', null, '2026-11-06T10:30:00.000Z', 'agent', 'Claude | opus', 'description', null, '[{"kind":"removed","text":"Read the file."},{"kind":"added","text":"Read the sample file."}]'),
  ('11111111-1111-4111-8111-111111111111', 't0000000-0000-4000-8000-000000000001', null, '2026-11-06T11:00:00.000Z', 'service', null, 'status', 'In Progress', 'Done');
insert into builtin_history (project_id, task_id, component_id, at, author, model, field, before, after) values
  ('11111111-1111-4111-8111-111111111111', null, 'c0000000-0000-4000-8000-000000000001', '2026-11-06T08:50:00.000Z', 'person', null, 'created', null, 'Parser'),
  ('11111111-1111-4111-8111-111111111111', null, 'c0000000-0000-4000-8000-000000000002', '2026-11-06T08:51:00.000Z', 'person', null, 'created', null, 'Docs'),
  ('11111111-1111-4111-8111-111111111111', 't0000000-0000-4000-8000-000000000001', null, '2026-11-06T11:10:00.000Z', 'person', null, 'component', null, 'Parser');
insert into builtin_history (project_id, milestone_id, at, author, model, field, before, after) values
  ('11111111-1111-4111-8111-111111111111', 'm0000000-0000-4000-8000-000000000002', '2026-11-01T08:00:00.000Z', 'person', null, 'created', null, 'v0.2'),
  ('11111111-1111-4111-8111-111111111111', 'm0000000-0000-4000-8000-000000000002', '2026-11-05T18:00:00.000Z', 'person', null, 'status', 'planned', 'completed'),
  ('11111111-1111-4111-8111-111111111111', 'm0000000-0000-4000-8000-000000000001', '2026-11-06T11:20:00.000Z', 'person', null, 'status', 'planned', 'active');
create table event_log (
  id     integer primary key,
  at     text not null,
  level  text not null,
  notice text not null,
  place  text
);
insert into event_log (id, at, level, notice, place) values
  (1, '2026-11-05T09:00:00.000Z', 'info', '{"code":"eventLog.chainStarted","params":{"project":"11111111-1111-4111-8111-111111111111"}}', '{"view":"project","project":"11111111-1111-4111-8111-111111111111"}'),
  (2, '2026-11-05T09:30:00.000Z', 'error', '{"code":"eventLog.red","params":{"project":"11111111-1111-4111-8111-111111111111","commit":"abc1234","cis":["github"]}}', '{"view":"ci","project":"11111111-1111-4111-8111-111111111111"}'),
  (3, '2026-11-05T10:00:00.000Z', 'warning', '{"code":"text","params":{"text":"claude 2.2.0 was not checked"}}', null);
create table merge_closes (
  project_id text not null,
  task       text not null,
  commits    text not null,
  closed_at  text not null,
  primary key (project_id, task)
);
insert into merge_closes (project_id, task, commits, closed_at) values
  ('11111111-1111-4111-8111-111111111111', 'ABC-1', '["1111111111111111111111111111111111111111"]', '2026-11-01T14:35:47.000Z'),
  ('77777777-7777-4777-8777-777777777777', 'ABCGH-4', '["2222222222222222222222222222222222222222","3333333333333333333333333333333333333333"]', '2026-11-01T15:00:00.000Z');
create table account_limits (
  account text primary key,
  limits  text not null
);
insert into account_limits (account, limits) values
  ('global', '{"fiveHour":{"usedPercentage":12,"resetsAt":"2026-10-31T06:00:00.000Z"},"sevenDay":{"usedPercentage":69,"resetsAt":"2026-11-03T10:00:00.000Z"},"updatedAt":"2026-10-31T03:05:00.000Z","source":"usage"}'),
  ('codex', '{"fiveHour":null,"sevenDay":{"usedPercentage":40,"resetsAt":"2026-11-04T10:00:00.000Z"},"updatedAt":"2026-10-31T03:04:00.000Z","source":"api","pool":"chatgpt:example-account"}');
create table key_organizations (
  account      text primary key,
  organization text not null,
  seen_at      text not null
);
insert into key_organizations (account, organization, seen_at) values
  ('work-api', 'org-anthropic-example', '2026-10-26T10:00:00.000Z'),
  ('codex-api', 'org-openai-example', '2026-10-26T10:00:00.000Z');
create table changelog_versions (
  project_id  text not null,
  milestone   text not null,
  version     integer not null,
  kind        text not null check (kind in ('draft', 'again', 'edit', 'add')),
  text        text not null,
  base        text,
  instruction text,
  tasks       text not null,
  open_tasks  integer not null,
  at          text not null,
  written_at  text,
  commit_sha  text,
  spend       text,
  primary key (project_id, milestone, version)
);
insert into changelog_versions (project_id, milestone, version, kind, text, base, instruction, tasks, open_tasks, at, written_at, commit_sha, spend) values
  ('11111111-1111-4111-8111-111111111111', 'v0.1', 1, 'draft', E'## [Unreleased]\n\n### Added\n\n- The chain of tasks.', null, null, '["ABC-1","ABC-2"]', 1, '2026-10-18T11:00:00.000Z', '2026-10-18T11:05:00.000Z', '0123456789abcdef0123456789abcdef01234567', null),
  ('11111111-1111-4111-8111-111111111111', 'v0.1', 2, 'edit', E'## [Unreleased]\n\n### Added\n\n- A chain of tasks run one by one.', E'## [Unreleased]\n\n### Added\n\n- The chain of tasks.', 'Say how it runs', '["ABC-1","ABC-2"]', 1, '2026-10-18T11:10:00.000Z', null, null, '{"model":"claude-sonnet-5-5","tokens":{"input":1200,"output":800,"cacheRead":30000,"cacheWrite":6000},"cost":0.12,"durationMs":21000,"account":"work"}'),
  ('11111111-1111-4111-8111-111111111111', 'v0.1', 3, 'edit', E'## [Unreleased]\n\n### Added\n\n- A chain of tasks, run one by one.', E'## [Unreleased]\n\n### Added\n\n- A chain of tasks run one by one.', 'A comma', '["ABC-1","ABC-2"]', 1, '2026-10-18T11:20:00.000Z', null, null, '{"model":"gpt-6.1-sol","tokens":{"input":900,"output":300,"cacheRead":4000,"cacheWrite":0},"cost":null,"durationMs":15000,"account":"codex"}');
create table tracker_profiles (
  id          text primary key,
  kind        text not null,
  name        text not null,
  credentials text not null,
  is_default  boolean not null default false,
  login       text,
  expires_at  text,
  position    integer not null,
  created_at  text not null,
  rules       text not null default '{}',
  mcp_oauth   text not null default 'null',
  moves       text not null default '{}',
  disabled    boolean not null default false,
  hand_sessions boolean not null default true
);
create unique index tracker_profiles_default on tracker_profiles (kind) where is_default;
create table chains (
  position   integer primary key,
  project_id text not null,
  chain      text not null
);
create table chain_queue (
  position   integer primary key,
  project_id text not null
);
create table chain_lists (
  project_id text not null,
  list       text not null,
  value      text not null,
  primary key (project_id, list),
  constraint chain_lists_list_check check (list in ('orders', 'skipped', 'leftovers', 'released', 'shelved', 'ci', 'reviews', 'landings'))
);
create table questions (
  position   integer primary key,
  task       text not null,
  session_id text not null,
  ask        text not null,
  comment    text not null,
  done       boolean not null default false
);
create table launches (
  id         integer generated by default as identity primary key,
  at         text not null,
  project_id text not null,
  task       text not null,
  session_id text not null,
  reason     text,
  extra      text not null default '{}'
);
create index launches_session on launches (session_id);
create index launches_task on launches (task);
create table handoffs (
  session_id text primary key,
  at         text,
  task       text,
  previous   text,
  reason     text,
  prompt     text,
  note_path  text,
  note       text
);
create table closed_tasks (
  project_id text not null,
  task       text not null,
  tracker    text not null,
  title      text not null,
  url        text,
  closed_at  text not null,
  profile_id text,
  status     text,
  milestone  text,
  priority   text,
  labels     text,
  primary key (project_id, task)
);
create table mailbox (
  id         integer not null,
  task       text not null,
  session_id text not null,
  text       text not null,
  files      text not null default '[]',
  posted_at  text not null,
  fate       text not null check (fate in ('waiting', 'delivered', 'returned', 'dismissed')),
  event      text,
  settled_at text,
  reason     text check (reason in ('asked', 'gone', 'closed')),
  machine_id text
);
create index mailbox_session on mailbox (session_id);
create unique index mailbox_key on mailbox ((coalesce(machine_id, '')), id);
create table projects (
  id               text primary key,
  key              text not null,
  name             text,
  repo             text not null,
  branch           text not null,
  tracker_projects text not null default '{}',
  position         integer not null,
  profile_id       text references tracker_profiles (id) deferrable initially deferred,
  feeds            text not null default '[]'
);
create table feed_profiles (
  feed_id    text primary key,
  profile_id text not null references tracker_profiles (id) deferrable initially deferred
);
create table setting_definitions (
  key           text primary key,
  kind          text not null,
  spec          text not null,
  default_value text,
  scopes        text not null,
  qualifier     text,
  task_label    text
);
create table setting_values (
  key        text not null references setting_definitions (key),
  project_id text references projects (id) on delete cascade,
  qualifier  text not null default '',
  value      text not null,
  updated_at text not null,
  updated_by text not null
);
create unique index setting_values_target on setting_values (key, (coalesce(project_id, '')), qualifier);
create table service_state (
  name  text primary key,
  value text not null
);
insert into tracker_profiles (id, kind, name, credentials, is_default, login, expires_at, position, created_at, rules, mcp_oauth, moves, disabled, hand_sessions) values
  ('33333333-3333-4333-8333-333333333333', 'huly', 'Huly · example', '{"HULY_URL":"https://huly.example.com","HULY_WORKSPACE":"example","HULY_EMAIL":"john.doe@example.com","HULY_PASSWORD":"example-password"}', true, 'John Doe', null, 0, '2026-10-18T09:00:00.000Z', '{"terminal":["Done","Canceled","Shipped"]}', 'null', '{"start":"In Progress","review":null,"done":"Shipped"}', false, false),
  ('44444444-4444-4444-8444-444444444444', 'github', 'GitHub · john-doe', '{"GITHUB_TOKEN":"github_pat_example_personal"}', true, 'john-doe', '2026-11-18T00:00:00.000Z', 1, '2026-10-18T09:00:00.000Z', '{}', '{"server":"https://api.githubcopilot.com/mcp/","clientId":"example-client","clientSecret":"example-secret","tokenEndpoint":"https://github.com/login/oauth/access_token","redirect":"http://localhost:4747/api/profiles/oauth/callback","resource":"","accessToken":"gho_example_access","expiresAt":null,"reconnect":false}', '{}', true, true),
  ('55555555-5555-4555-8555-555555555555', 'github', 'GitHub · octo-org', '{"GITHUB_TOKEN":"github_pat_example_org"}', false, 'john-doe', null, 2, '2026-10-18T09:40:00.000Z', '{"excludedLabels": ["wontfix", "Manual", "Вручную"]}', 'null', '{}', false, true);
insert into projects (id, key, name, repo, branch, tracker_projects, position, profile_id, feeds) values
  ('11111111-1111-4111-8111-111111111111', 'ABC', 'Example project', 'C:\repos\example-project', 'main', '{}', 0, '33333333-3333-4333-8333-333333333333', '[{"id":"77777777-7777-4777-8777-777777777777","tracker":"github","key":"ABCGH","github":"octo-org/ideas","chain":{"excludedLabels":["Later","Manual","Вручную"]}}]'),
  ('22222222-2222-4222-8222-222222222222', 'XYZ', null, 'C:\repos\other-project', 'trunk', '{"github":"octo-org/example"}', 1, '55555555-5555-4555-8555-555555555555', '[]'),
  ('66666666-6666-4666-8666-666666666666', 'ABC', 'Example release', 'C:\repos\example-release', 'release/v1', '{"huly":"ABR"}', 2, '33333333-3333-4333-8333-333333333333', '[]');
insert into feed_profiles (feed_id, profile_id) values
  ('77777777-7777-4777-8777-777777777777', '55555555-5555-4555-8555-555555555555');
insert into setting_definitions (key, kind, spec, default_value, scopes, qualifier, task_label) values
  ('parallel', 'integer', '{}', '1', 'global', null, null),
  ('unattended', 'boolean', '{}', 'false', 'global', null, null),
  ('trimTools', 'boolean', '{}', 'true', 'global', null, null),
  ('tracker', 'enum', '{}', '"github"', 'project', null, null),
  ('models', 'string', '{}', '{"claude":"opus"}', 'global,project', 'provider', 'run'),
  ('color', 'integer', '{}', null, 'project', null, null),
  ('chain.excludedLabels', 'list', '{}', '[]', 'global,project,profile', null, null);
insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by) values
  ('color', '11111111-1111-4111-8111-111111111111', '', '3', '2026-10-18T22:10:00.000Z', 'page'),
  ('chain.excludedLabels', '11111111-1111-4111-8111-111111111111', '', '["Later", "Manual", "Вручную"]', '2026-10-30T09:00:00.000Z', 'page'),
  ('chain.excludedLabels', null, '', '["Manual", "Вручную"]', '2026-11-05T12:00:00.000Z', 'service'),
  ('color', '22222222-2222-4222-8222-222222222222', '', '2', '2026-10-18T22:00:00.000Z', 'service'),
  ('color', '66666666-6666-4666-8666-666666666666', '', '4', '2026-10-22T09:00:00.000Z', 'service'),
  ('parallel', null, '', '2', '2026-10-18T09:00:00.000Z', 'import'),
  ('unattended', null, '', 'true', '2026-10-18T09:00:00.000Z', 'import'),
  ('trimTools', null, '', 'true', '2026-10-18T09:00:00.000Z', 'import'),
  ('tracker', '11111111-1111-4111-8111-111111111111', '', '"huly"', '2026-10-24T09:00:00.000Z', 'service'),
  ('tracker', '22222222-2222-4222-8222-222222222222', '', '"github"', '2026-10-18T09:00:00.000Z', 'import'),
  ('tracker', '66666666-6666-4666-8666-666666666666', '', '"huly"', '2026-10-24T09:00:00.000Z', 'service'),
  ('models', '11111111-1111-4111-8111-111111111111', 'claude', '"sonnet"', '2026-10-18T09:30:00.000Z', 'page'),
  ('models', '11111111-1111-4111-8111-111111111111', 'opencode/openai', '"openai/gpt-6-luna"', '2026-11-13T09:00:00.000Z', 'page'),
  ('models', null, 'opencode/opencode', '"opencode/big-pickle"', '2026-11-13T09:00:00.000Z', 'page');
insert into service_state (name, value) values
  ('config.imported', '"2026-10-18T09:00:00.000Z"'),
  ('profiles.imported', '"2026-10-18T09:00:00.000Z"'),
  ('updates.dismissed', '"0.2.0"'),
  ('eventLog.memory', '{"seen":{"red|11111111-1111-4111-8111-111111111111|abc1234|red":"2026-11-05T10:00:00.000Z"},"chains":{"11111111-1111-4111-8111-111111111111":{"paused":false,"error":null}}}');
insert into chain_lists (project_id, list, value) values
  ('11111111-1111-4111-8111-111111111111', 'orders', '["ABC-1","ABC-2","ABC-3"]'),
  ('22222222-2222-4222-8222-222222222222', 'orders', '["XYZ-7"]'),
  ('11111111-1111-4111-8111-111111111111', 'skipped', '["ABC-9"]'),
  ('22222222-2222-4222-8222-222222222222', 'leftovers', '[{"task":"XYZ-1","at":"2026-10-01T09:00:00.000Z","notice":{"code":"text","params":{"text":"dirty worktree"}}}]'),
  ('11111111-1111-4111-8111-111111111111', 'released', '["ABC-1"]'),
  ('11111111-1111-4111-8111-111111111111', 'shelved', '[{"task":"ABC-1","sessionId":"aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee","at":"2026-10-19T09:00:00.000Z"}]'),
  ('11111111-1111-4111-8111-111111111111', 'ci', '{"green":"0123456789abcdef0123456789abcdef01234567","afterGreen":"0123456789abcdef0123456789abcdef01234567"}'),
  ('11111111-1111-4111-8111-111111111111', 'reviews', '[{"task":"ABC-3","remote":"origin","number":12,"url":"https://github.com/example/project/pull/12","branch":"abc-3/task","at":"2026-10-06T10:00:00.000Z","pushedAt":"2026-10-06T10:00:00.000Z","markAt":"2026-10-06T09:59:00.000Z","seen":["review:41"],"feedback":"Rename it."}]'),
  ('11111111-1111-4111-8111-111111111111', 'landings', '[{"task":"ABC-2","rounds":1,"resolving":true}]');
insert into chain_queue (position, project_id) values
  (0, '22222222-2222-4222-8222-222222222222');
insert into chains (position, project_id, chain) values
  (0, '11111111-1111-4111-8111-111111111111', '{"current":{"task":"ABC-2","sessionId":"00000000-0000-4000-8000-0000000000a1","since":"2026-10-01T10:00:00.000Z","limit":{"at":"2026-10-01T10:30:00.000Z","account":"john@example.com","resetsAt":null,"lastReplyAt":"2026-10-01T10:29:00.000Z","then":"relay","acted":null,"overage":{"stopped":true,"session":{"sessionId":"00000000-0000-4000-8000-0000000000a1","agentId":"agent-1","account":"global","cwd":"C:/repos/example-project","workdir":"C:/repos/example-project/.claude/worktrees/abc-2","branch":"abc-2/task","transcript":"C:/fake/session.jsonl","lastReplyAt":"2026-10-01T10:29:00.000Z","recent":[],"lastMessage":"Keep the parser change","checkpoint":".temp/handoff.md","limit":{"at":"2026-10-01T10:30:00.000Z","text":"Included subscription allowance exhausted; paid usage detected"}}}}},"paused":false,"error":null}');
insert into closed_tasks (project_id, task, tracker, title, url, closed_at, profile_id, status, milestone, priority, labels) values
  ('11111111-1111-4111-8111-111111111111', 'ABC-1', 'huly', 'Parse the example input', 'https://huly.example.com/workbench/example/browse/ABC-1', '2026-10-04T12:00:00.000Z', null, null, null, null, null),
  ('11111111-1111-4111-8111-111111111111', 'ABCGH-4', 'github', 'Accept the second input format', 'https://github.com/octo-org/ideas/issues/4', '2026-10-22T08:00:00.000Z', '55555555-5555-4555-8555-555555555555', 'closed', '{"label":"v0.3","targetDate":1795996800000}', 'medium', '["Bug"]');
insert into handoffs (session_id, at, task, previous, reason, prompt, note_path, note) values
  ('00000000-0000-4000-8000-0000000000a3', '2026-10-05T10:00:00.000Z', 'ABC-2', '00000000-0000-4000-8000-0000000000a2', 'relay', 'ABC-2

Continuation: read the handoff note first.', 'C:\repos\example-project\.temp\handoff.md', '# ABC-2 handoff

Done: the parser.');
insert into launches (id, at, project_id, task, session_id, reason, extra) values
  (1, '2026-10-01T08:00:00.000Z', '11111111-1111-4111-8111-111111111111', 'ABC-1', '00000000-0000-4000-8000-0000000000a0', null, '{"fallback":"codex"}'),
  (2, '2026-10-01T10:00:00.000Z', '11111111-1111-4111-8111-111111111111', 'ABC-2', '00000000-0000-4000-8000-0000000000a1', 'restart', '{"previous":"00000000-0000-4000-8000-0000000000a0"}'),
  (3, '2026-10-01T11:00:00.000Z', '11111111-1111-4111-8111-111111111111', 'ABC-FIX', '00000000-0000-4000-8000-0000000000f0', null, '{"commit":"c6b39560000000000000000000000000000000aa"}'),
  (4, '2026-10-01T11:20:00.000Z', '11111111-1111-4111-8111-111111111111', 'ABC-FIX', '00000000-0000-4000-8000-0000000000f0', 'landed', '{"commit":"15945fe0000000000000000000000000000000bb"}'),
  (5, '2026-10-01T12:00:00.000Z', '11111111-1111-4111-8111-111111111111', 'ABC-FIX', '00000000-0000-4000-8000-0000000000f1', null, '{"commit":"d00d0000000000000000000000000000000000cc"}'),
  (6, '2026-10-01T12:05:00.000Z', '11111111-1111-4111-8111-111111111111', 'ABC-FIX', '00000000-0000-4000-8000-0000000000f1', 'dropped', '{}');
insert into mailbox (id, task, session_id, text, files, posted_at, fate, event, settled_at, reason, machine_id) values
  (1, 'ABC-2', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'Use the other parser.', '[]', '2026-10-18T10:00:00.000Z', 'delivered', 'PostToolUse', '2026-10-18T10:00:04.000Z', null, null),
  (2, 'ABC-2', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'Mind the second case too.', '["C:\\repos\\example-project\\.temp\\inbox\\case.png"]', '2026-10-18T10:05:00.000Z', 'returned', null, '2026-10-18T10:05:20.000Z', 'asked', '88888888-8888-4888-8888-888888888888'),
  (3, 'ABC-2', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'And run the slow tests.', '[]', '2026-10-18T10:06:00.000Z', 'waiting', null, null, null, '88888888-8888-4888-8888-888888888888'),
  (2, 'ABC-3', 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', 'Take the laptop''s folder.', '[]', '2026-10-18T10:07:00.000Z', 'delivered', 'Stop', '2026-10-18T10:07:03.000Z', null, '99999999-9999-4999-8999-999999999999');
insert into questions (position, task, session_id, ask, comment, done) values
  (0, 'ABC-2', '00000000-0000-4000-8000-0000000000a1', 'toolu_example1', 'comment-example-1', false);
select setval(pg_get_serial_sequence('launches', 'id'), (select max(id) from launches));
insert into setting_definitions (key, kind, spec, default_value, scopes) values
  ('modelPrompts', 'json', '{}', '{}', 'global');
insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by) values
  ('modelPrompts', null, '', '{"* | sonnet":"First.","* | gpt-sol":"Second."}', '2026-10-01', 'hand');
insert into setting_definitions (key, kind, spec, default_value, scopes) values
  ('protection', 'json', '{}', '{"disabled":[],"claude":[],"codex":[],"copilot":[],"opencode":[]}', 'global,project');
insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by) values
  ('protection', null, '', '{"disabled":["forcePush","deleteGithub"],"claude":["Write(.env)"]}', '2026-10-30', 'page'),
  ('protection', '11111111-1111-4111-8111-111111111111', '', '{"disabled":["deleteHuly","deleteGithub","deleteGitlab","deleteLinear","deleteJira"]}', '2026-10-30', 'page');
insert into setting_definitions (key, kind, spec, default_value, scopes, qualifier) values
  ('cli', 'enum', '{}', '{"claude":"system","codex":"system","opencode":"system","copilot":"system"}', 'global', 'provider');
insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by) values
  ('cli', null, 'claude', '"checked"', '2026-10-30T09:00:00.000Z', 'service'),
  ('cli', null, 'codex', '"system"', '2026-10-20T09:00:00.000Z', 'page'),
  ('cli', null, 'opencode', '"checked"', '2026-10-30T09:00:00.000Z', 'service'),
  ('cli', null, 'copilot', '"checked"', '2026-10-30T09:00:00.000Z', 'service');
insert into setting_definitions (key, kind, spec, default_value, scopes, qualifier) values
  ('execution', 'enum', '{}', '{"claude":"auto","codex":"sandbox"}', 'global', 'provider');
insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by) values
  ('execution', null, 'claude', '"sdk"', '2026-10-30T09:00:00.000Z', 'page');


create table global_accounts (account text primary key);
insert into global_accounts (account) values ('global'), ('codex');


insert into setting_definitions (key, kind, spec, default_value, scopes, qualifier)
  values ('testProject', 'boolean', '{}', 'false', 'project', null);

create table rare_events (
  entry      text not null,
  event      text not null,
  session_id text not null,
  seen_at    text not null,
  waiting    text,
  primary key (entry, event, session_id)
);
create index rare_events_seen on rare_events (seen_at);
insert into rare_events (entry, event, session_id, seen_at, waiting) values
  ('46', 'job-end-1', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', '2026-11-07T09:00:00.000Z', null),
  ('18', 'copy:old-session:1794045600000', 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff', '2026-11-07T09:30:00.000Z', '{"kind":"transcript","old":"old-session","since":1794045600000,"identity":{"sessionId":"bbbbbbbb-cccc-4ddd-8eee-ffffffffffff","cwd":"C:\\repos\\example-project","task":"ABC-2","project":"ABC"}}'),
  ('86', 'boot', 'cccccccc-dddd-4eee-8fff-000000000000', '2026-11-07T09:45:00.000Z', '{"kind":"answer"}');

create table key_spends (
  session_id text primary key,
  account    text not null,
  usd        double precision not null,
  shared     boolean not null,
  reads      integer not null,
  first_at   text not null,
  last_at    text not null
);
insert into key_spends (session_id, account, usd, shared, reads, first_at, last_at) values
  ('ses_0000000000000000000000001', 'opencode-example', 0.185, false, 4, '2026-11-08T10:00:00.000Z', '2026-11-08T10:20:00.000Z'),
  ('ses_0000000000000000000000002', 'opencode-example', 0, true, 1, '2026-11-08T11:00:00.000Z', '2026-11-08T11:00:00.000Z');
create table management_keys (
  account  text primary key,
  key      text not null,
  saved_at text not null
);
insert into management_keys (account, key, saved_at) values
  ('opencode-example', 'management-key-example', '2026-11-08T12:00:00.000Z');
create table browser_hotkeys (
  browser  text primary key,
  bindings text not null,
  saved_at text not null
);
insert into browser_hotkeys (browser, bindings, saved_at) values
  ('browser-example-0001', '{"chainRun":"Mod+Shift+Enter"}', '2026-11-08T13:00:00.000Z');
create table task_retries (
  position   bigint generated by default as identity primary key,
  project_id text not null,
  retry_key  text not null,
  ids        text not null,
  started    text,
  unique (project_id, retry_key)
);
insert into task_retries (project_id, retry_key, ids, started) values
  ('11111111-1111-4111-8111-111111111111', 'batch-example', '["ABC-4","ABC-5"]', '{"at":2,"marker":"marker-example-0001"}'),
  ('22222222-2222-4222-8222-222222222222', 'batch-example', '["XYZ-8"]', null);
create table account_settings (
  account  text primary key,
  written  text not null,
  own      text not null,
  saved_at text not null
);
insert into account_settings (account, written, own, saved_at) values
  ('john.doe', '{"model":"opus","theme":"dark"}', '{"model":"sonnet","statusLine":null}', '2026-11-09T01:00:00.000Z');
create table left_folders (
  path       text primary key,
  project_id text not null,
  task       text not null,
  repo       text not null,
  until      bigint not null
);
insert into left_folders (path, project_id, task, repo, until) values
  ('C:\repos\example-project\.claude\worktrees\abc-3', '11111111-1111-4111-8111-111111111111', 'ABC-3', 'C:\repos\example-project', 1794714366000);
create table context_windows (
  account     text not null,
  model       text not null,
  settings    text,
  stamp       text not null,
  window_size integer,
  measured_at bigint not null,
  unique nulls not distinct (account, model, settings)
);
insert into context_windows (account, model, settings, stamp, window_size, measured_at) values
  ('john.doe', 'opus', '{"autoCompactWindow":250000}', '["claude",1794700000000,1794600000000]', 250000, 1794714000000),
  ('john.doe', 'opus', null, '["claude",1794700000000,1794600000000]', 200000, 1794714100000);
create table session_windows (
  session_id  text primary key,
  window_size integer not null,
  seen_at     bigint not null
);
insert into session_windows (session_id, window_size, seen_at) values
  ('00000000-0000-4000-8000-000000000001', 250000, 1794714200000);



create table badge_translations (
  tracker      text not null,
  task         text not null,
  title_hash   text not null,
  attempted_at bigint not null,
  title_en     text,
  primary key (tracker, task, title_hash)
);
insert into badge_translations (tracker, task, title_hash, attempted_at, title_en)
  values ('example', 'ABC-3', 'example-hash', 1794714200000, 'Fix the panel');
create table task_runs (
  project_id text not null,
  task       text not null,
  provider   text,
  model      text,
  effort     text,
  machines   text,
  primary key (project_id, task)
);
insert into task_runs (project_id, task, provider, model, effort, machines) values
  ('11111111-1111-4111-8111-111111111111', 'ABC-2', 'claude', 'opus', 'high', null),
  ('11111111-1111-4111-8111-111111111111', 'ABC-3', null, null, 'low', '["88888888-8888-4888-8888-888888888888"]');
create table run_label_imports (
  project_id text primary key
);
insert into run_label_imports (project_id) values
  ('22222222-2222-4222-8222-222222222222');
create table badge_translation_spend (
  message_id text primary key,
  message    text not null
);
insert into badge_translation_spend (message_id, message) values
  ('badge-translate:example:google-gemini-test', '{"messageId":"badge-translate:example:google-gemini-test","sessionId":"example","agentId":null,"account":"litellm","project":"example","projectDir":"C:/repos/example","task":null,"branch":null,"entrypoint":"badge-translate","model":"google-gemini-test","speed":null,"effort":null,"at":"2026-11-09T12:00:00Z","input":100,"cacheWrite5m":0,"cacheWrite1h":0,"cacheRead":0,"output":12,"provider":null}');
create table tracker_exports (
  project_id  text primary key,
  profile     text not null,
  place       text not null,
  key         text not null,
  started_at  text not null,
  finished_at text,
  source_key  text
);
insert into tracker_exports (project_id, profile, place, key, started_at, finished_at, source_key) values
  ('11111111-1111-4111-8111-111111111111', 'github-example', 'example/repo', 'GH', '2026-11-12T09:00:00.000Z', null, 'ABC');
create table tracker_export_tasks (
  project_id text not null,
  task_id    text not null,
  number     integer not null,
  new_key    text,
  url        text,
  stage      text not null check (stage in ('pending', 'created', 'linked', 'attached', 'journaled', 'marked')),
  marker     text,
  done       integer not null default 0,
  at         text not null,
  primary key (project_id, task_id)
);
insert into tracker_export_tasks (project_id, task_id, number, new_key, url, stage, marker, done, at) values
  ('11111111-1111-4111-8111-111111111111', 't0000000-0000-4000-8000-000000000002', 2, 'GH-14', 'https://github.example.com/example/repo/issues/14', 'journaled', 'even-keel:ABC-2', 0, '2026-11-12T09:01:00.000Z'),
  ('11111111-1111-4111-8111-111111111111', 't0000000-0000-4000-8000-000000000003', 3, null, null, 'pending', null, 0, '2026-11-12T09:00:00.000Z');
create table machines (
  id           text primary key,
  name         text not null,
  secret_hash  text not null,
  created_at   bigint not null,
  revoked_at   bigint,
  host         text,
  api          integer,
  seen_at      bigint,
  last_event   bigint not null default 0,
  last_command bigint not null default 0,
  invite_expires bigint,
  joined_at    bigint,
  about        text,
  capacity     integer,
  color        text
);
insert into machines (id, name, secret_hash, created_at, revoked_at, host, api, seen_at, last_event, last_command, invite_expires, joined_at, about, capacity, color) values
  ('88888888-8888-4888-8888-888888888888', 'Example server', '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8', 1794650000000, null, 'example-host', 6, 1794650100000, 7, 3, 1794651800000, 1794650050000, '{"host":"example-host","os":"linux 6.8.0","evenKeel":"0.4.0","node":"24.11.0","git":"2.47.0","agents":{"claude":"2.1.0"},"gitUser":true,"root":"/home/example/projects"}', 2, '#6f8f7f'),
  ('99999999-9999-4999-8999-999999999999', 'Example laptop', '6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b', 1794652000000, null, null, null, null, 0, 0, 1794653800000, null, null, 1, null);
create table machine_commands (
  machine_id text not null,
  seq        bigint not null,
  command    text not null,
  created_at bigint not null,
  primary key (machine_id, seq)
);
insert into machine_commands (machine_id, seq, command, created_at) values
  ('88888888-8888-4888-8888-888888888888', 3, '{"type":"example.run","project":"11111111-1111-4111-8111-111111111111","folder":"C:/repos/example"}', 1794650050000);
create table project_machines (
  project_id text not null,
  machine_id text not null,
  enabled    boolean not null default true,
  folder     text,
  settings   text,
  after_green text,
  primary key (project_id, machine_id)
);
insert into project_machines (project_id, machine_id, enabled, folder, settings, after_green) values
  ('11111111-1111-4111-8111-111111111111', '88888888-8888-4888-8888-888888888888', true, null, '{"beforeStart":["npm ci"],"afterGreen":["npm run deploy:server"],"servers":{"files":{"files":{"command":"/opt/example/bin/files-mcp","args":["/srv/example"]}}}}', 'cccccccccccccccccccccccccccccccccccccccc'),
  ('11111111-1111-4111-8111-111111111111', '99999999-9999-4999-8999-999999999999', false, '/home/example/work/abc', null, null);
create table machine_tasks (
  project_id  text not null,
  task        text not null,
  machine_id  text not null,
  assigned_at bigint not null,
  primary key (project_id, task)
);
insert into machine_tasks (project_id, task, machine_id, assigned_at) values
  ('11111111-1111-4111-8111-111111111111', 'ABC-2', '88888888-8888-4888-8888-888888888888', 1794650060000);
create table handoff_notes (
  id         integer generated by default as identity primary key,
  project_id text not null,
  task       text not null,
  session_id text not null,
  branch     text,
  machine_id text,
  at         text not null,
  note       text not null
);
create index handoff_notes_task on handoff_notes (project_id, task);
insert into handoff_notes (id, project_id, task, session_id, branch, machine_id, at, note) values
  (1, '11111111-1111-4111-8111-111111111111', 'ABC-2', '00000000-0000-4000-8000-0000000000a1', 'abc-2/parser', '88888888-8888-4888-8888-888888888888', '2026-10-01T10:40:00.000Z', 'Done: the parser. Next: npm test -- parser.');
create table memory_records (
  project_id  text not null,
  name        text not null,
  description text not null,
  type        text not null,
  body        text not null,
  version     integer not null,
  deleted     boolean not null default false,
  file        text,
  file_hash   text,
  task        text,
  machine_id  text,
  at          text not null,
  primary key (project_id, name)
);
insert into memory_records (project_id, name, description, type, body, version, deleted, file, file_hash, task, machine_id, at) values
  ('11111111-1111-4111-8111-111111111111', 'parser-needs-utf8', 'the example parser reads only UTF-8 input', 'project', 'Convert the input to UTF-8 first.', 3, false, 'parser-needs-utf8.md', null, 'ABC-2', '88888888-8888-4888-8888-888888888888', '2026-10-01T10:45:00.000Z'),
  ('11111111-1111-4111-8111-111111111111', 'old-lexer-flag', 'the lexer flag that was removed', 'project', '', 2, true, null, null, 'ABC-1', null, '2026-09-30T09:00:00.000Z');
create table task_moves (
  project_id   text not null,
  task         text not null,
  from_machine text not null,
  branch       text not null,
  moved_at     bigint not null,
  launched_at  bigint,
  primary key (project_id, task)
);
insert into task_moves (project_id, task, from_machine, branch, moved_at, launched_at) values
  ('11111111-1111-4111-8111-111111111111', 'ABC-2', '99999999-9999-4999-8999-999999999999', 'abc-2/task', 1794650000000, 1794650060000),
  ('11111111-1111-4111-8111-111111111111', 'ABC-3', '99999999-9999-4999-8999-999999999999', 'abc-3/task', 1794650100000, null);
create table chats (
  id          text primary key,
  project_id  text not null,
  agent       text not null,
  account     text not null,
  model       text,
  effort      text,
  title       text,
  first       text,
  said        text not null default '',
  last        text,
  session_id  text,
  machine_id  text,
  created_at  bigint not null,
  last_at     bigint not null,
  read_at     bigint,
  archived_at bigint,
  successor   text,
  previous    text,
  pending     text,
  packages    text
);
create index chats_project on chats (project_id, archived_at, last_at);
insert into chats (id, project_id, agent, account, model, effort, title, first, said, last, session_id, machine_id, created_at, last_at, read_at, archived_at, successor, previous, pending, packages) values
  ('chat-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'claude', 'global', 'opus', 'high', 'Slow build', 'Why is the build slow?', E'Why is the build slow?\nAnd the tests?', '{"from":"agent","text":"The tests run twice.","at":"2026-11-19T10:05:00.000Z"}', 'aaaaaaaa-1111-4222-8333-444444444444', '88888888-8888-4888-8888-888888888888', 1795082400000, 1795082700000, 1795082600000, null, null, null, null, '{"lint@example":true,"huly@even-keel":false}'),
  ('chat-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 'codex', 'codex-work', null, null, null, null, '', null, null, null, 1795083000000, 1795083000000, null, null, null, null, null, null),
  ('chat-cccccccccccc', '11111111-1111-4111-8111-111111111111', 'claude', 'global', 'sonnet', null, 'Release notes', 'Draft the release notes', 'Draft the release notes', '{"from":"user","text":"Draft the release notes","at":"2026-11-17T09:00:00.000Z"}', 'cccccccc-1111-4222-8333-444444444444', '88888888-8888-4888-8888-888888888888', 1794906000000, 1794906000000, null, 1794992400000, 'chat-aaaaaaaaaaaa', null, null, null),
  ('chat-dddddddddddd', '11111111-1111-4111-8111-111111111111', 'claude', 'global', 'opus', 'high', null, 'Fix the header', 'Fix the header', '{"from":"user","text":"Fix the header","at":"2026-11-19T11:00:00.000Z"}', null, '88888888-8888-4888-8888-888888888888', 1795086000000, 1795086000000, 1795086000000, null, null, 'chat-eeeeeeeeeeee', E'This chat goes on from an earlier chat of the project, whose session was stopped.\n\nThe user''s message:\n\nFix the header\n', null),
  ('chat-eeeeeeeeeeee', '11111111-1111-4111-8111-111111111111', 'claude', 'global', 'opus', 'high', 'Header', 'Look at the header', 'Look at the header', '{"from":"agent","text":"The header is fine.","at":"2026-11-19T10:10:00.000Z"}', 'eeeeeeee-1111-4222-8333-444444444444', '88888888-8888-4888-8888-888888888888', 1795082000000, 1795083000000, 1795083000000, 1795086000000, 'chat-dddddddddddd', null, null, null);
create table chat_choices (
  project_id text primary key,
  account    text not null,
  model      text,
  effort     text,
  packages   text
);
insert into chat_choices (project_id, account, model, effort, packages) values
  ('11111111-1111-4111-8111-111111111111', 'global', 'opus', 'high', '{"lint@example":true,"huly@even-keel":false}');
alter table tracker_exports add column history_summary boolean;

insert into setting_definitions (key, kind, spec, default_value, scopes) values
  ('context.warn', 'number', '{}', '50', 'global');
insert into setting_values (key, project_id, qualifier, value, updated_at, updated_by) values
  ('context.warn', null, '', '65', '2026-11-19T09:00:00.000Z', 'page');
alter table tracker_exports add column direction text not null default 'export' check (direction in ('export', 'import'));
alter table tracker_exports add column plan text;
alter table tracker_exports add column checked text;
create table tracker_transfers (
  id          text primary key,
  project_id  text not null,
  direction   text not null check (direction in ('export', 'import')),
  tracker     text not null,
  place       text not null,
  key         text not null,
  source_key  text,
  closed      boolean not null default false,
  history     boolean not null default false,
  started_at  text not null,
  finished_at text,
  switched_at text not null,
  plan        text not null,
  checked     text not null,
  matched     boolean not null
);
create index tracker_transfers_project on tracker_transfers (project_id, switched_at);
update tracker_exports set
  plan = '{"tasks":[{"id":"ABC-1","title":"Parse the log","status":"Todo"}],"counts":{"tasks":1,"comments":2,"files":0,"blocks":0,"relates":0,"subtasks":0,"milestones":0,"labels":1},"statuses":[{"name":"Todo","category":"ToDo","tasks":1,"target":{"name":"Todo","category":"ToDo"}}],"losses":[{"kind":"estimate","tasks":["ABC-1"],"names":[]}]}',
  checked = '{"at":"2026-11-12T09:30:00.000Z","rows":[{"kind":"tasks","source":1,"target":1,"tasks":[]},{"kind":"comments","source":2,"target":1,"tasks":["ABC-1"]},{"kind":"links","source":0,"target":0,"tasks":[]},{"kind":"labels","source":1,"target":1,"tasks":[]}]}'
  where project_id = '11111111-1111-4111-8111-111111111111';
insert into tracker_transfers (id, project_id, direction, tracker, place, key, source_key, closed, history, started_at, finished_at, switched_at, plan, checked, matched) values
  ('transfer-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'export', 'github', 'example/other', 'XG', 'XYZ', false, false, '2026-11-10T08:00:00.000Z', '2026-11-10T08:20:00.000Z', '2026-11-10T08:25:00.000Z',
   '{"tasks":[{"id":"XYZ-7","title":"Write the guide","status":null}],"counts":{"tasks":1,"comments":0,"files":0,"blocks":0,"relates":0,"subtasks":0,"milestones":0,"labels":0},"statuses":[],"losses":[]}',
   '{"at":"2026-11-10T08:24:00.000Z","rows":[{"kind":"tasks","source":1,"target":1,"tasks":[]},{"kind":"comments","source":0,"target":0,"tasks":[]},{"kind":"links","source":0,"target":0,"tasks":[]},{"kind":"labels","source":0,"target":0,"tasks":[]}]}',
   true);
create table warm_pings (
  session_id     text not null,
  at             text not null,
  machine_id     text not null,
  account        text not null,
  task           text not null,
  project_id     text,
  model          text,
  input          bigint not null,
  cache_write_5m bigint not null,
  cache_write_1h bigint not null,
  cache_read     bigint not null,
  output         bigint not null,
  primary key (session_id, at)
);
insert into warm_pings (session_id, at, machine_id, account, task, project_id, model, input, cache_write_5m, cache_write_1h, cache_read, output) values
  ('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', '2026-11-12T10:04:00.000Z', 'machine-own-0001', 'global', 'ABC-2', '11111111-1111-4111-8111-111111111111', 'claude-opus-5-5', 3, 120, 0, 81000, 4),
  ('dddddddd-eeee-4fff-8000-111111111111', '2026-11-12T10:30:00.000Z', 'machine-laptop-0001', 'codex-example', 'XYZ-7', null, 'gpt-6.1-sol', 900, 0, 0, 52000, 6);
create table tracker_imports (
  project_id  text primary key,
  tracker     text not null,
  place       text not null,
  key         text not null,
  started_at  text not null,
  finished_at text,
  authors     text not null,
  plan        text,
  checked     text
);
create table tracker_import_tasks (
  project_id text not null,
  task_ref   text not null,
  number     integer not null,
  stage      text not null check (stage in ('created', 'linked', 'attached', 'journaled', 'done')),
  done       integer not null default 0,
  files      text not null default '{}',
  changes    integer not null default 0,
  at         text not null,
  primary key (project_id, task_ref)
);
insert into builtin_counters (project_id, last) values ('22222222-2222-4222-8222-222222222222', 8);
insert into builtin_tasks (id, project_id, number, title, description, description_rev, status, priority, milestone_id, parent_id, version, created_at, updated_at, estimate, component_id) values
  ('t0000000-0000-4000-8000-000000000007', '22222222-2222-4222-8222-222222222222', 7, 'Write the guide', 'See ![shot](/api/tasks/XYZ-7/files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa).', 0, 'Done', 'medium', null, null, 2, '2026-09-01T08:00:00.000Z', '2026-09-03T10:00:00.000Z', null, null),
  ('t0000000-0000-4000-8000-000000000008', '22222222-2222-4222-8222-222222222222', 8, 'Translate the guide', '', 0, 'Todo', 'none', null, null, 1, '2026-09-02T08:00:00.000Z', '2026-09-02T08:00:00.000Z', null, null);
insert into builtin_comments (task_id, author, body, at, model, author_name) values
  ('t0000000-0000-4000-8000-000000000007', 'person', 'Looks right to me.', '2026-09-03T10:00:00.000Z', null, 'Jane Doe');
insert into tracker_imports (project_id, tracker, place, key, started_at, finished_at, authors, plan, checked) values
  ('22222222-2222-4222-8222-222222222222', 'huly', '', 'XYZ', '2026-11-20T09:00:00.000Z', null,
   '[{"kind":"person","name":"Jane Doe","as":"person"},{"kind":"agent","name":"Claude Code","as":"agent"}]', null, null);
insert into tracker_import_tasks (project_id, task_ref, number, stage, done, files, changes, at) values
  ('22222222-2222-4222-8222-222222222222', 'huly-issue-7', 7, 'done', 0, '{"huly-image:blob-7":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}', 2, '2026-11-20T09:02:00.000Z'),
  ('22222222-2222-4222-8222-222222222222', 'huly-issue-8', 8, 'created', 0, '{}', 0, '2026-11-20T09:03:00.000Z');
alter table tracker_exports add column closed_tasks boolean;
update tracker_exports set closed_tasks = true where project_id = '11111111-1111-4111-8111-111111111111';
alter table tracker_exports add column failed text;
update tracker_exports set failed = '{"code":"export.failed","params":{"tracker":"GitHub"},"detail":"github: HTTP 502"}' where project_id = '11111111-1111-4111-8111-111111111111';
alter table tracker_import_tasks add column seen text;
update tracker_import_tasks set seen = '{"at":1795600000000,"comments":1,"changes":2,"files":1}' where task_ref = 'huly-issue-7';
create table people (
  id         text primary key,
  name       text not null,
  created_at text not null
);
insert into people (id, name, created_at) values ('a1000000-0000-4000-8000-000000000001', 'Owner', '2026-11-24T08:00:00.000Z');
create table access_tokens (
  id          text primary key,
  person_id   text not null references people (id) on delete cascade deferrable initially deferred,
  rights      text not null check (rights in ('owner')),
  secret_hash text not null unique,
  device      text not null,
  created_at  text not null,
  seen_at     text,
  seen_from   text,
  revoked_at  text,
  key_mark    text,
  passkey_host text,
  invite_id   text
);
create index access_tokens_person on access_tokens (person_id);
insert into access_tokens (id, person_id, rights, secret_hash, device, created_at, seen_at, seen_from, revoked_at, key_mark, passkey_host, invite_id) values
  ('t1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'owner', '6c2f0b1a8a0e3f7d5b9c4e2a1d8f6b3c7e9a0d2f4b6c8e1a3d5f7b9c0e2a4d6f', 'Firefox on Linux', '2026-11-24T08:10:00.000Z', '2026-11-24T09:15:00.000Z', '192.0.2.7', null, '3f1c9a7e5b2d8f4a6c0e1b3d5f7a9c2e4b6d8f0a1c3e5b7d9f2a4c6e8b0d1f3a', null, null),
  ('t1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'owner', '0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e', 'Safari on iPhone', '2026-11-24T08:20:00.000Z', null, null, '2026-11-24T09:30:00.000Z', null, 'hub.example.com', null),
  ('t1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'owner', '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b', 'Chrome on Android', '2026-11-24T10:04:00.000Z', '2026-11-24T10:20:00.000Z', '100.64.0.12', null, null, null, 'i1000000-0000-4000-8000-000000000001');
create table device_invites (
  id            text primary key,
  person_id     text not null references people (id) on delete cascade deferrable initially deferred,
  link_hash     text not null unique,
  created_by    text,
  created_at    text not null,
  expires_at    text not null,
  state         text not null check (state in ('waiting', 'opened', 'admitted', 'declined', 'cancelled', 'used')),
  claim_hash    text unique,
  opened_at     text,
  opened_device text,
  opened_from   text,
  digits        text,
  decided_at    text,
  token_id      text
);
insert into device_invites (id, person_id, link_hash, created_by, created_at, expires_at, state, claim_hash, opened_at, opened_device, opened_from, digits, decided_at, token_id) values
  ('i1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', '1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c', 't1000000-0000-4000-8000-000000000001', '2026-11-24T10:00:00.000Z', '2026-11-24T10:10:00.000Z', 'used', '2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d', '2026-11-24T10:02:00.000Z', 'Chrome on Android', '100.64.0.12', '47', '2026-11-24T10:03:00.000Z', 't1000000-0000-4000-8000-000000000003'),
  ('i1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', '3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e', null, '2026-11-24T11:00:00.000Z', '2026-11-24T11:10:00.000Z', 'declined', '4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f', '2026-11-24T11:01:00.000Z', 'Firefox on Windows', '198.51.100.20', '08', '2026-11-24T11:02:00.000Z', null),
  ('i1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', '5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a', 't1000000-0000-4000-8000-000000000001', '2026-11-24T12:00:00.000Z', '2026-11-24T12:10:00.000Z', 'waiting', null, null, null, null, null, null, null);
create table passkeys (
  credential_id text primary key,
  person_id     text not null references people (id) on delete cascade deferrable initially deferred,
  public_key    text not null,
  counter       bigint not null default 0,
  host          text not null,
  name          text not null,
  created_at    text not null,
  used_at       text
);
create index passkeys_person on passkeys (person_id);
insert into passkeys (credential_id, person_id, public_key, counter, host, name, created_at, used_at) values
  ('Y3JlZGVudGlhbC1leGFtcGxl', 'a1000000-0000-4000-8000-000000000001', 'cHVibGljLWtleS1leGFtcGxl', 3, 'hub.example.com', 'Laptop', '2026-11-24T08:05:00.000Z', '2026-11-24T09:00:00.000Z');
create table sign_in_on (
  id    smallint primary key check (id = 1),
  since text not null
);
insert into sign_in_on (id, since) values (1, '2026-11-24T09:30:00.000Z');
create table page_origins (
  origin  text primary key,
  seen_at text not null
);
insert into page_origins (origin, seen_at) values
  ('https://hub.example.com', '2026-11-25T08:00:00.000Z'),
  ('http://192.0.2.10:4747', '2026-11-20T18:15:00.000Z');
