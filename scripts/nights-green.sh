#!/bin/sh
# Whether the nightly workflows and the Huly contract let a release out (docs/releases.md, "A release", step 3).
# A night ("Real CLIs", "Tracker contract", "macOS"): its latest finished run of the night or by hand on `dev` must be a success.
# A red night holds every release until a run is green again: a fix on `dev` and a run by hand
# (`gh workflow run <file> --ref dev`) lift it. A workflow with no such run yet passes, with a note: GitHub starts a
# schedule only once the workflow is on the default branch, so the release that brings it finds none.
# The Huly contract (BTN-1489): the night skips the stands up only on demand, so the latest run of trackers-e2e.yml with
# `on_demand` on `dev` (its title "Huly contract", started by scripts/huly-contract.sh) must be a success too; with no
# such run the release is held as well, since nothing starts it by itself.
# macOS left the push check of `dev` for a night: until the release that brings its schedule reaches the default
# branch, no night starts it, so with no run of the night or by hand on `dev` the release is held, not passed.
# Anything else it cannot tell — an API error — holds the release.
# usage: nights-green.sh; needs gh signed in, or GH_TOKEN with `actions: read`; GITHUB_REPOSITORY in CI
repo=${GITHUB_REPOSITORY:-NamerekT/even-keel}
on_demand='Huly contract'
held=0

# check <label> <workflow file> <query of the runs> <jq condition a run must meet> <hold when there is no run: yes|no> <how to lift a red run>
check() {
  label=$1 file=$2 query=$3 condition=$4 hold_none=$5 lift=$6
  if ! answer=$(gh api "repos/$repo/actions/workflows/$file/runs?status=completed&per_page=50$query" \
    --jq "[.workflow_runs[] | select($condition)][0] // empty | \"\(.conclusion) \(.html_url)\"" 2>&1); then
    case $answer in
    *"Not Found"*) echo "$label: not on the default branch yet, no night to check" ;;
    *) echo "$label: cannot read its runs: $answer" >&2; held=1 ;;
    esac
    return
  fi
  conclusion=${answer%% *}
  if [ -z "$answer" ] && [ "$hold_none" = yes ]; then
    echo "$label: no run on dev yet — $lift" >&2
    held=1
  elif [ -z "$answer" ]; then
    echo "$label: no night has run yet"
  elif [ "$conclusion" = success ]; then
    echo "$label: green, ${answer#* }"
  else
    echo "$label: $conclusion, ${answer#* } — $lift" >&2
    held=1
  fi
}

night='(.event == "schedule" or (.event == "workflow_dispatch" and .head_branch == "dev"))'
check cli-e2e.yml cli-e2e.yml '' "$night" no 'fix it on dev and run it again by hand'
check trackers-e2e.yml trackers-e2e.yml '' "$night and .display_title != \"$on_demand\"" no 'fix it on dev and run it again by hand'
check macos.yml macos.yml '' "$night" yes 'run it by hand: gh workflow run macos.yml --ref dev'
check "$on_demand" trackers-e2e.yml '&event=workflow_dispatch&branch=dev' ".display_title == \"$on_demand\"" yes \
  'bring Huly up and run it: sh scripts/huly-contract.sh'

exit $held
