# Tally database on a server

Postgres for session stats: the stack `/opt/stacks/tally-stats` on your own server (below — `my-server`, user `me`), the Compose project `tally-stats` (pinned by `name:`). The schema is created by the collector (BTN-46); this covers only the database, the roles and the backup.

## What is inside

- `db` — `postgres:18`, port 5432 published only on the host's tailnet address (`BIND_ADDRESS`), not on the local network.
- Roles (created by `initdb/10-roles.sh` on the first start with an empty volume):
  - `tally_writer` — owner of the database and the `public` schema, written to by the collector;
  - `tally_reader` — read-only: `SELECT` on everything `tally_writer` creates, transactions read-only by default. Even Keel and the sessions with the weekly summary use it.
  - `postgres` — the superuser, needed only for the backup and maintenance.
- `backup` — every `BACKUP_INTERVAL_SECONDS` (a day by default) `pg_dump --format=custom --compress=9` into `./backups/tally-<time>.dump`, keeping the latest `BACKUP_KEEP` (7 by default).

## Installation

From the PC (Git Bash), from the repository root:

```sh
ssh my-server 'sudo install -d -o me -g me /opt/stacks/tally-stats'
scp -r tally/deploy/compose.yaml tally/deploy/initdb tally/deploy/scripts my-server:/opt/stacks/tally-stats/
```

On the server, in `/opt/stacks/tally-stats`:

```sh
umask 077
cat > .env <<EOF
BIND_ADDRESS=$(tailscale ip -4)
POSTGRES_PASSWORD=$(openssl rand -hex 24)
TALLY_DB=tally
TALLY_WRITER_PASSWORD=$(openssl rand -hex 24)
TALLY_READER_PASSWORD=$(openssl rand -hex 24)
EOF
chmod 600 .env
mkdir -p backups && chmod 700 backups
docker compose up -d
```

The role passwords are copied into Even Keel's local `.env` (outside git) as `TALLY_DB_*`, `TALLY_WRITER_PASSWORD` and `TALLY_READER_PASSWORD` — the format is in `.env.example` in the repository root.

The port is bound to the tailnet address. For the binding to survive a boot where Docker starts before `tailscaled`, the server has `net.ipv4.ip_nonlocal_bind=1` (`/etc/sysctl.d/99-nonlocal-bind.conf`, set up for LiteLLM). On a new host, set it up the same way.

Every start of the `backup` container writes a dump at once, then on schedule; the extra ones are removed by `BACKUP_KEEP`.

## Check

```sh
export PGUSER=tally_reader PGDATABASE=tally PGPASSWORD=<reader password>
# from the PC over the tailnet — should succeed
psql -h <tailnet address> -c 'select current_user'
# from the PC to the server's local network address — the connection must fail
psql -h <local network address> -c 'select 1'
```

## Restore

Checking the latest dump in a temporary container, comparing the row count of each table with the live database:

```sh
sh scripts/restore-check.sh            # the latest dump
sh scripts/restore-check.sh backups/tally-20261003T000000Z.dump
```

A real restore goes into an empty database of the same version: the roles from `initdb/10-roles.sh`, then `pg_restore -U postgres -d tally --exit-on-error < dump`.
