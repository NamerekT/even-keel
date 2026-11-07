#!/bin/sh
# Whether the nightly workflows let a release out (docs/releases.md, "A release", step 1): for each, its latest finished
# run of the night or by hand on `dev` must be a success. A red night holds every release until a run is green again:
# a fix on `dev` and a run by hand (`gh workflow run <file> --ref dev`) lift it. A workflow with no such run yet passes,
# with a note: GitHub starts a schedule only once the workflow is on the default branch, so the release that brings it
# finds none. Anything else it cannot tell — an API error — holds the release.
# usage: nights-green.sh; needs gh signed in, or GH_TOKEN with `actions: read`; GITHUB_REPOSITORY in CI
repo=${GITHUB_REPOSITORY:-NamerekT/even-keel}
held=0

for file in cli-e2e.yml trackers-e2e.yml; do
  if ! answer=$(gh api "repos/$repo/actions/workflows/$file/runs?status=completed&per_page=50" \
    --jq '[.workflow_runs[] | select(.event == "schedule" or (.event == "workflow_dispatch" and .head_branch == "dev"))][0] // empty | "\(.conclusion) \(.html_url)"' 2>&1); then
    case $answer in
    *"Not Found"*) echo "$file: not on the default branch yet, no night to check" ;;
    *) echo "$file: cannot read its runs: $answer" >&2; held=1 ;;
    esac
    continue
  fi
  conclusion=${answer%% *}
  if [ -z "$answer" ]; then
    echo "$file: no night has run yet"
  elif [ "$conclusion" = success ]; then
    echo "$file: green, ${answer#* }"
  else
    echo "$file: $conclusion, ${answer#* } — fix it on dev and run it again by hand" >&2
    held=1
  fi
done

exit $held
