#!/usr/bin/env bash
set -euo pipefail
[[ ${GATE_RESULT:?} == success ]]
baseline=$(jq -er '.["bootstrap-sha"]' release-please-config.json)
[[ $baseline =~ ^[0-9a-f]{40}$ && $GITHUB_SHA =~ ^[0-9a-f]{40}$ ]]
git merge-base --is-ancestor "$baseline" "$GITHUB_SHA"
current=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/master" --jq .object.sha)
if [[ $current == "$GITHUB_SHA" ]]; then
  deployed=$(curl --fail --silent --show-error https://parlor.mistystep.io/version.txt)
  [[ $deployed == "$GITHUB_SHA" ]]
  printf 'current=true\n' >> "$GITHUB_OUTPUT"
else
  printf 'Superseded source; no release metadata publication.\n'
fi
