#!/usr/bin/env bash
#
# The whole PR Lens run for a Bitbucket Pipelines pull-request pipeline:
# analyze the diff, render the diagrams, publish them to the repository's
# Downloads, and keep exactly one sticky comment on the pull request.
#
# The clone Pipelines hands over is a synthetic merge — the destination is
# merged into the source before the run — and no destination-commit variable
# exists, so the diff base is recovered in-clone with git merge-base.
set -euo pipefail

MODEL_PROVIDER="${MODEL_PROVIDER:-gemini}"
MODEL="${MODEL:-}"
BASE_URL="${BASE_URL:-}"
LENS="${LENS:-}"
BRANDING="${BRANDING:-true}"
COMMENT="${COMMENT:-true}"
CLI_VERSION="${CLI_VERSION:-0.6.1}"
API_KEY_VARIABLE="${API_KEY_VARIABLE:-GEMINI_API_KEY}"
TOKEN_VARIABLE="${TOKEN_VARIABLE:-PR_LENS_TOKEN}"

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[ -n "${BITBUCKET_PR_ID:-}" ] \
  || fail "PR Lens runs in pull-request pipelines only. Put the pipe under the pull-requests: section of bitbucket-pipelines.yml."

[ -n "${BITBUCKET_PR_DESTINATION_BRANCH:-}" ] \
  || fail "BITBUCKET_PR_DESTINATION_BRANCH is empty, so there is no base to measure against."

API_KEY="${!API_KEY_VARIABLE:-}"
[ -n "${API_KEY}" ] \
  || fail "the repository variable ${API_KEY_VARIABLE} is empty. Put your model key there (Repository settings → Pipelines → Repository variables, secured), or name another variable with API_KEY_VARIABLE."
export PR_LENS_API_KEY="${API_KEY}"

TOKEN="${!TOKEN_VARIABLE:-}"
if [ "${COMMENT}" = "true" ] && [ -z "${TOKEN}" ]; then
  fail "posting the comment needs a repository access token (pullrequest:write and repository:write scopes — the second publishes the diagrams to Downloads) in the secured repository variable ${TOKEN_VARIABLE}. Pipelines provides no token of its own for the Bitbucket API, and app passwords are retired."
fi

# The explicit refspec matters: a shallow default clone is single-branch, so
# a plain fetch of the destination would land only in FETCH_HEAD and
# origin/<dest> would never exist.
DEST="${BITBUCKET_PR_DESTINATION_BRANCH}"
DEST_REFSPEC="+refs/heads/${DEST}:refs/remotes/origin/${DEST}"
git fetch --quiet origin "${DEST_REFSPEC}" 2>/dev/null || true

# The clone may be shallow; a base the history cannot reach is deepened once
# before giving up, and before any model money is spent.
if ! git merge-base HEAD "origin/${DEST}" > /dev/null 2>&1; then
  git fetch --quiet --unshallow origin "${DEST_REFSPEC}" 2>/dev/null \
    || git fetch --quiet --depth=1000 origin "${DEST_REFSPEC}" 2>/dev/null \
    || true
  git merge-base HEAD "origin/${DEST}" > /dev/null 2>&1 \
    || fail "cannot find a common ancestor of HEAD and origin/${DEST}. Give the step full history: clone: depth: full in bitbucket-pipelines.yml."
fi

WORK="${PR_LENS_WORK:-$(mktemp -d)}"

cli() {
  npx --yes "@coldtea/pr-lens-cli@${CLI_VERSION}" "$@"
}

# HEAD already contains the destination, so the CLI's own merge-base of the
# two is the destination tip, and the measured diff is exactly the pull
# request's effective change.
cli analyze \
  --base "origin/${DEST}" \
  --head HEAD \
  --pr "${BITBUCKET_PR_ID}" \
  --forge bitbucket \
  --provider "${MODEL_PROVIDER}" \
  --api-key-env PR_LENS_API_KEY \
  ${MODEL:+--model "${MODEL}"} \
  ${BASE_URL:+--base-url "${BASE_URL}"} \
  ${LENS:+--lens "${LENS}"} \
  --out "${WORK}/graph.json"

cli render "${WORK}/graph.json" --out "${WORK}/assets"

if [ "${COMMENT}" != "true" ]; then
  echo "Comment disabled; the render is in ${WORK}/assets."
  exit 0
fi

API="https://api.bitbucket.org/2.0/repositories/${BITBUCKET_WORKSPACE}/${BITBUCKET_REPO_SLUG}"

api() {
  curl -fsS --header "Authorization: Bearer ${TOKEN}" "$@"
}

json() {
  node -e "let d=\"\";process.stdin.on(\"data\",c=>d+=c).on(\"end\",()=>{${1}})"
}

# Whether this run still describes the pull request as it stands. The payload
# and the API carry 12-character commit prefixes, so the comparison is a
# prefix match against BITBUCKET_COMMIT — the source-branch push that
# triggered this pipeline. Not knowing is a failure, not a reason to stay
# quiet, so a failed lookup exits rather than returning.
overtaken() {
  local current
  if ! current="$(api "${API}/pullrequests/${BITBUCKET_PR_ID}" \
    | json 'const pr=JSON.parse(d);const h=pr.source?.commit?.hash;if(!h)process.exit(1);console.log(h)')"; then
    fail "could not ask Bitbucket what pull request #${BITBUCKET_PR_ID} points at, so this run cannot tell whether its diagram is still the current one."
  fi

  if [ "${current}" = "${BITBUCKET_COMMIT:0:${#current}}" ]; then
    return 1
  fi

  echo "Pull request #${BITBUCKET_PR_ID} has moved on to ${current}; leaving the comment to the run that is drawing it."
  return 0
}

# Once here, to spend nothing on publishing that will not be shown.
if overtaken; then
  exit 0
fi

# Downloads rather than a data branch: nothing to push, and the renderer
# names every file after the hash of its own contents, so re-publishing the
# same render overwrites it with identical bytes.
for FILE in "${WORK}"/assets/*.svg; do
  api --form "files=@${FILE}" "${API}/downloads" > /dev/null \
    || fail "could not publish $(basename "${FILE}") to Downloads"
done

node - "${WORK}/assets/manifest.json" "https://bitbucket.org/${BITBUCKET_WORKSPACE}/${BITBUCKET_REPO_SLUG}/downloads" <<'PATCH'
const fs = require("node:fs");
const path = require("node:path");
const [manifestPath, downloads] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
for (const asset of manifest.assets) {
  if (asset.path === undefined) continue;
  asset.url = `${downloads}/${path.basename(asset.path)}`;
}
fs.writeFileSync(path.join(path.dirname(manifestPath), "published.manifest.json"), JSON.stringify(manifest));
PATCH

BRANDING_FLAG=""
if [ "${BRANDING}" = "false" ]; then
  BRANDING_FLAG="--no-branding"
fi

cli comment \
  --target bitbucket \
  --graph "${WORK}/assets/drawn.graph.json" \
  --manifest "${WORK}/assets/published.manifest.json" \
  ${BRANDING_FLAG} \
  --out "${WORK}/comment.md"

MARKER="$(cli comment --print-marker --target bitbucket)"

# The token's own identity, by uuid — user references in API responses
# carry no username. A repository access token may lack the account scope
# to answer /user at all; ownership then falls back to the marker plus
# Bitbucket's own authorization at the write below.
WHOAMI_UUID="$({ api "https://api.bitbucket.org/2.0/user" | json 'console.log(JSON.parse(d).uuid||"")'; } 2>/dev/null || true)"

: > "${WORK}/comments.jsonl"
NEXT="${API}/pullrequests/${BITBUCKET_PR_ID}/comments?pagelen=100"
while [ -n "${NEXT}" ]; do
  api "${NEXT}" > "${WORK}/comments.page.json"
  json 'const p=JSON.parse(d);for(const c of p.values||[])console.log(JSON.stringify(c))' \
    < "${WORK}/comments.page.json" >> "${WORK}/comments.jsonl"
  NEXT="$(json 'console.log(JSON.parse(d).next||"")' < "${WORK}/comments.page.json")"
done

MINE="$(node - "${WORK}/comments.jsonl" "${WHOAMI_UUID}" "${MARKER}" <<'FIND'
const fs = require("node:fs");
const [commentsPath, whoami, marker] = process.argv.slice(2);
for (const line of fs.readFileSync(commentsPath, "utf8").split("\n")) {
  if (line === "") continue;
  const comment = JSON.parse(line);
  if (comment.deleted) continue;
  if (!comment.content?.raw?.startsWith(marker)) continue;
  // With no identity to compare, the marker is the only lead; the write
  // below lets the server refuse an edit that turns out not to be ours.
  if (whoami === "" || comment.user?.uuid === whoami) {
    console.log(comment.id);
    break;
  }
}
FIND
)"

# And again here, because the publishing and the listing cost seconds, and
# this is the check that guards the write.
if overtaken; then
  exit 0
fi

BODY_JSON="${WORK}/comment.json"
node -e 'const fs=require("node:fs");process.stdout.write(JSON.stringify({content:{raw:fs.readFileSync(process.argv[1],"utf8")}}))' \
  "${WORK}/comment.md" > "${BODY_JSON}"

if [ -n "${MINE}" ] && [ -n "${WHOAMI_UUID}" ]; then
  api -X PUT --header "Content-Type: application/json" --data "@${BODY_JSON}" \
    "${API}/pullrequests/${BITBUCKET_PR_ID}/comments/${MINE}" > /dev/null
elif [ -n "${MINE}" ]; then
  # Identityless match: attempt the edit and let Bitbucket's authorization
  # judge it. A refusal means the marker was somebody else's, and the answer
  # to that is a fresh comment of ours, exactly as if none had matched.
  if ! api -X PUT --header "Content-Type: application/json" --data "@${BODY_JSON}" \
    "${API}/pullrequests/${BITBUCKET_PR_ID}/comments/${MINE}" > /dev/null 2>&1; then
    api -X POST --header "Content-Type: application/json" --data "@${BODY_JSON}" \
      "${API}/pullrequests/${BITBUCKET_PR_ID}/comments" > /dev/null
  fi
else
  api -X POST --header "Content-Type: application/json" --data "@${BODY_JSON}" \
    "${API}/pullrequests/${BITBUCKET_PR_ID}/comments" > /dev/null
fi

echo "✓ the PR Lens comment is on pull request #${BITBUCKET_PR_ID}"
