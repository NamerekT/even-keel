-- v5 → v6. Where a task lives (BTN-66): a project's tasks may come from several trackers and profiles (task feeds),
-- so a task keeps the profile it was read through and its own link, both from Even Keel's launch log. A task of
-- another tracker than Huly gets its title from the log too: Huly has no record of it.

alter table tasks add column if not exists profile_id text;
alter table tasks add column if not exists url text;
