#!/bin/sh
# Compressed custom-format dump of the Tally database every BACKUP_INTERVAL_SECONDS,
# keeping the BACKUP_KEEP newest files in /backups.
set -eu

while true; do
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  tmp="/backups/.tally-$stamp.dump.part"
  if pg_dump --format=custom --compress=9 --dbname="$TALLY_DB" --file="$tmp"; then
    mv "$tmp" "/backups/tally-$stamp.dump"
    echo "$(date -u +%FT%TZ) backup tally-$stamp.dump $(du -h "/backups/tally-$stamp.dump" | cut -f1)"
    ls -1t /backups/tally-*.dump | tail -n +"$((BACKUP_KEEP + 1))" | xargs -r rm -f
  else
    rm -f "$tmp"
    echo "$(date -u +%FT%TZ) backup failed" >&2
  fi
  sleep "$BACKUP_INTERVAL_SECONDS"
done
