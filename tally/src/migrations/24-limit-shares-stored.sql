-- v23 → v24 (BTN-1658). The limit shares stored: limit_shares is a window over every response of the history, ~2.4 s
-- on the live database, and /stats computed it anew in three or four queries of each read. The materialized view keeps
-- its rows, the same columns in the same order, and is refreshed whole (`refresh materialized view concurrently`) once
-- a collector run or a machine's post wrote new rows, so a late response lands in the next refresh by itself. The
-- unique key is what a concurrent refresh needs; a reader keeps reading the old rows while it runs. The reader role
-- gets `select` through the writer's default privileges (tally/deploy), as for every table.
create materialized view if not exists limit_shares_stored as
select * from limit_shares;

create unique index if not exists limit_shares_stored_key on limit_shares_stored (message_id, span, till);
