#!/bin/sh
# Whether this workflow already passed on the pushed commit: `green=true` into $GITHUB_OUTPUT only for a push whose
# commit has a successful run of the same workflow file from a push or a manual run — a release's push of the source
# to main, one branch fast-forwarded to another's commit. The workflow's other jobs then skip and the run is green.
#
# A pull request's run does not count: it checks the merge with the base, not this commit. A run of the commit that
# is still going or failed does not count either. Anything it cannot tell — another event, an API error — is
# `green=false`, a full run.
# usage: ci-already-green.sh <event name> <pushed commit>; needs GH_TOKEN with `actions: read`
event=$1
sha=$2

green=false
if [ "$event" = push ]; then
  ref=${GITHUB_WORKFLOW_REF%@*}
  file=${ref##*/}
  # On an error gh prints the API's answer to stdout and exits non-zero: only a zero exit is taken.
  if url=$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/$file/runs?head_sha=$sha&status=success&per_page=100" \
    --jq "[.workflow_runs[] | select(.id != $GITHUB_RUN_ID and .event != \"pull_request\")][0].html_url // empty" 2>/dev/null) \
    && [ -n "$url" ]; then
    green=true
    echo "$file already passed on $sha: $url"
  fi
fi

echo "green=$green"
echo "green=$green" >> "$GITHUB_OUTPUT"
