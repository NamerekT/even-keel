#!/bin/sh
# The Huly contract before a release (BTN-1489, docs/trackers.md, "Contract tests on live trackers"): brings the
# self-hosted Huly stand up, runs trackers-e2e.yml with `on_demand` on `dev` (only the stands up on demand), waits for
# its result and brings Huly down again — also after a failure or Ctrl+C. scripts/nights-green.sh holds a release until
# the latest such run on `dev` is green.
# The commands are the host's, never the repository's: EVEN_KEEL_HULY_UP and EVEN_KEEL_HULY_DOWN, from the environment
# or from the file EVEN_KEEL_HULY_STAND names (~/.config/even-keel/huly-stand by default), read by sh, such as
#   EVEN_KEEL_HULY_UP='ssh stand-host ./night.sh up'
#   EVEN_KEEL_HULY_DOWN='ssh stand-host ./night.sh down'
# The up command returns once Huly answers.
# usage: huly-contract.sh [ref]  (dev by default); needs gh signed in with `actions: write`
set -u
repo=${GITHUB_REPOSITORY:-NamerekT/even-keel}
ref=${1:-dev}
title='Huly contract'
config=${EVEN_KEEL_HULY_STAND:-$HOME/.config/even-keel/huly-stand}

if [ -z "${EVEN_KEEL_HULY_UP:-}" ] && [ -f "$config" ]; then . "$config"; fi
if [ -z "${EVEN_KEEL_HULY_UP:-}" ] || [ -z "${EVEN_KEEL_HULY_DOWN:-}" ]; then
  echo "Set EVEN_KEEL_HULY_UP and EVEN_KEEL_HULY_DOWN, in the environment or in $config" >&2
  exit 2
fi

# The id of the newest run of the Huly contract on the ref, 0 with none.
latest() {
  gh run list --repo "$repo" --workflow trackers-e2e.yml --branch "$ref" --event workflow_dispatch --limit 20 \
    --json databaseId,displayTitle --jq "[.[] | select(.displayTitle == \"$title\")][0].databaseId // 0"
}

down() {
  echo "Huly: bringing it down"
  sh -c "$EVEN_KEEL_HULY_DOWN" || echo "Huly: the down command failed — bring it down by hand" >&2
}

before=$(latest) || exit 1
trap down EXIT
trap 'exit 130' INT TERM

echo "Huly: bringing it up"
sh -c "$EVEN_KEEL_HULY_UP" || { echo "Huly: the up command failed" >&2; exit 1; }

gh workflow run trackers-e2e.yml --repo "$repo" --ref "$ref" -f on_demand=true || exit 1
run=''
for _ in $(seq 1 24); do
  sleep 5
  id=$(latest) || exit 1
  if [ "$id" -gt "$before" ]; then run=$id; break; fi
done
if [ -z "$run" ]; then
  echo "The run did not show up in two minutes: see gh run list --workflow trackers-e2e.yml" >&2
  exit 1
fi

echo "$title: run $run, waiting for it"
gh run watch "$run" --repo "$repo" --exit-status --interval 30
result=$?
gh run view "$run" --repo "$repo" --json conclusion,url --jq '"\(.conclusion) \(.url)"'
exit $result
