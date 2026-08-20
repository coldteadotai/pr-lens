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
# comment with an older picture. Asking GitHub is what makes this answerable —
# an older checkout does not contain the newer commit, so no amount of local
# history could settle it.
overtaken() {
  local current
  current="$(gh api "repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}" --jq .head.sha)"

  if [ "${current}" = "${HEAD_SHA}" ]; then
    return 1
  fi

  echo "::notice::#${PR_NUMBER} has moved on to ${current}; leaving the comment to the run that is drawing it."
  return 0
}

# Once here, to spend nothing on a comment that will not be posted.
if overtaken; then
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

# And again here, because everything between the two costs seconds — composing
# the body, listing the comments — and this is the check that guards the write.
# Cancelling an overtaken run is not a lock: the signal arrives when it arrives,
# and a request already in flight still lands. The window that remains is the
# one between this line and the next.
if overtaken; then
  exit 0
fi

if [ -n "${MINE}" ]; then
  jq -Rs '{body: .}' < "${BODY}" \
    | gh api -X PATCH "repos/${GITHUB_REPOSITORY}/issues/comments/$(printf '%s' "${MINE}" | jq -r '.id')" \
      --input - --silent
else
  jq -Rs '{body: .}' < "${BODY}" \
    | gh api -X POST "repos/${GITHUB_REPOSITORY}/issues/${PR_NUMBER}/comments" --input - --silent
fi
