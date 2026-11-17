-- v16 → v17 (BTN-1280). The machine a response and a session were collected on: a machine elsewhere sends its rows
-- over its link to the hub, which writes them with its id; the hub's own rows keep it empty. No view changes: the
-- views name their columns, and /stats reaches the machine through sessions.

alter table messages add column if not exists machine text;
alter table sessions add column if not exists machine text;
create index if not exists sessions_machine on sessions (machine) where machine is not null;
