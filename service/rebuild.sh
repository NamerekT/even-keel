#!/bin/sh
# Called after a green push or by a forced SSH command, like rebuild.ps1.
set -eu
commit=${1:-${SSH_ORIGINAL_COMMAND:-}}
case "$commit" in
  ''|*[!0-9a-f]*) echo 'Expected a commit hash' >&2; exit 2 ;;
esac
if [ "${#commit}" -lt 7 ] || [ "${#commit}" -gt 40 ]; then
  echo 'Expected a commit hash of 7 to 40 characters' >&2
  exit 2
fi
cd "$(dirname "$0")/.."
head=$(git rev-parse HEAD)
case "$head" in
  "$commit"*) ;;
  *) echo "The checkout is on $head, not on $commit: nothing is built"; exit 0 ;;
esac
case "$(uname -s)" in
  Linux) service=even-keel.service ;;
  Darwin) service=local.even-keel ;;
  *) echo 'Expected systemd or launchd' >&2; exit 2 ;;
esac
state=${2:-http://127.0.0.1:${EVEN_KEEL_PORT:-4747}/api/state}
npx tsc -p tsconfig.updates.json
exec node dist/src/updates/run.js rebuild --commit "$head" --root "$PWD" --state "$state" --service "$service"
