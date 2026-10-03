#!/bin/sh
# Restores a dump (default: the newest in ./backups) into a throwaway postgres:18 and
# compares exact row counts of every table with the live database. Run on the server from
# the stack folder: sh scripts/restore-check.sh [dump]
set -eu

cd "$(dirname "$0")/.."
dump=${1:-$(ls -1t backups/tally-*.dump | head -n 1)}
db=$(sed -n 's/^TALLY_DB=//p' .env)
db=${db:-tally}
scratch=tally-restore-check
live_container=$(docker compose ps -q db)

counts() {
  docker exec "$1" psql -U postgres -d "$db" -At -c "
    SELECT format('SELECT %L || '' '' || count(*) FROM %I.%I;', schemaname || '.' || tablename, schemaname, tablename)
    FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    ORDER BY 1" | docker exec -i "$1" psql -U postgres -d "$db" -At
}

docker rm -f "$scratch" >/dev/null 2>&1 || true
trap 'docker rm -f "$scratch" >/dev/null 2>&1 || true' EXIT
docker run -d --name "$scratch" -e POSTGRES_HOST_AUTH_METHOD=trust postgres:18 >/dev/null
until docker exec "$scratch" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 1; done

docker exec "$scratch" psql -U postgres -q -c "CREATE ROLE tally_writer; CREATE ROLE tally_reader;"
docker exec "$scratch" createdb -U postgres -O tally_writer "$db"
docker exec -i "$scratch" pg_restore -U postgres -d "$db" --exit-on-error < "$dump"

live=$(counts "$live_container")
restored=$(counts "$scratch")
echo "dump: $dump"
echo "$restored"
if [ "$live" = "$restored" ]; then
  echo "OK: row counts match the live database"
else
  echo "MISMATCH with the live database:" >&2
  echo "$live" >&2
  exit 1
fi
