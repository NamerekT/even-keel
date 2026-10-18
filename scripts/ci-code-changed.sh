#!/bin/sh
# Whether a CI run has code to check: `code=false` into $GITHUB_OUTPUT only for a push that changes nothing but
# Markdown outside plugins/ (a plugin's skills ship with it). Anything it cannot tell — a pull request, a manual
# run, a new branch, a commit before the push it cannot fetch — is `code=true`.
#
# The workflow still runs for such a push, only its build and tests are skipped: Even Keel waits for a run of every
# commit pushed to main, so a push the CI never takes would hold the chain until it gives up on the CI (docs/ci.md).
# usage: ci-code-changed.sh <event name> <commit before the push> <pushed commit>
event=$1
before=$2
after=$3

code=true
if [ "$event" = push ] && git fetch -q --depth=1 origin "$before" 2>/dev/null; then
  files=$(git diff --name-only "$before" "$after")
  if [ -n "$files" ] \
    && ! printf '%s\n' "$files" | grep -qv '\.md$' \
    && ! printf '%s\n' "$files" | grep -q '^plugins/'; then
    code=false
  fi
fi

echo "code=$code"
echo "code=$code" >> "$GITHUB_OUTPUT"
