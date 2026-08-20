#!/usr/bin/env bash
#
# Posts the one PR Lens comment, or updates the one that is already there.
set -euo pipefail

WORK="${RUNNER_TEMP}/pr-lens"
BODY="${WORK}/comment.md"

cli() {
  npx --yes "@coldtea/pr-lens-cli@${CLI_VERSION}" "$@"
}

# Whether this run still describes the pull request as it stands. A run that
# was overtaken while it drew has nothing useful to say: its diagrams are of a
# commit that is no longer the head, and posting them would replace a newer
# comment with an older picture. Asking GitHub is what makes this reliable —
# an older checkout does not contain the newer commit, so no amount of local
# history could answer it. A push in the seconds after this check still wins
# the comment, which is what the workflow's concurrency group is for.
CURRENT_HEAD="$(gh api "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}" --jq .head.sha)"

if [ "${CURRENT_HEAD}" != "${HEAD_SHA}" ]; then
  echo "::notice::#${PR_NUMBER} has moved on to ${CURRENT_HEAD}; leaving the comment to the run that is drawing it."
  exit 0
fi

cli comment \
  --graph "${WORK}/assets/drawn.graph.json" \
  --manifest "${WORK}/assets/manifest.json" \
  --asset-base-url "${ASSETS_URL}" \
  ${BRANDING_OFF:+--no-branding} \
  --out "${BODY}"

MARKER="$(cli comment --print-marker)"

gh api "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" --paginate --jq '.[]' \
  > "${WORK}/comments.jsonl"

# Anyone can post the marker, so it is not enough to find the comment by:
# ownership decides what may be edited, and a marker on somebody else's
# comment is simply not ours.
MINE="$(jq -c --arg author "${COMMENT_AUTHOR}" --arg marker "${MARKER}" \
  'select(.user.login == $author) | select(.body | startswith($marker))' \
  "${WORK}/comments.jsonl" | head -n 1)"

if [ -n "${MINE}" ]; then
  jq -Rs '{body: .}' < "${BODY}" \
    | gh api -X PATCH "repos/${GITHUB_REPOSITORY}/issues/comments/$(printf '%s' "${MINE}" | jq -r '.id')" \
      --input - --silent
else
  jq -Rs '{body: .}' < "${BODY}" \
    | gh api -X POST "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" --input - --silent
fi
