#!/usr/bin/env bash
#
# The whole PR Lens run for a GitLab merge request pipeline: analyze the diff,
# render the diagrams, upload them as project attachments, and keep exactly
# one sticky comment on the merge request.
#
# Attachments rather than a data branch: CI_JOB_TOKEN cannot push by default,
# and raw URLs on a private project are invisible to other readers, while an
# uploaded image is served to anyone holding its unguessable URL.
set -euo pipefail

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

[ -n "${CI_MERGE_REQUEST_IID:-}" ] \
  || fail "PR Lens runs in merge request pipelines only. The consuming .gitlab-ci.yml must trigger them itself — for example workflow: rules: - if: \$CI_PIPELINE_SOURCE == \"merge_request_event\" — because rules inside an included component do not."

[ -n "${CI_MERGE_REQUEST_DIFF_BASE_SHA:-}" ] \
  || fail "CI_MERGE_REQUEST_DIFF_BASE_SHA is empty, so there is no diff to measure."

API_KEY="${!PR_LENS_API_KEY_VARIABLE:-}"
[ -n "${API_KEY}" ] \
  || fail "the CI/CD variable ${PR_LENS_API_KEY_VARIABLE} is empty. Put your model key there (Settings → CI/CD → Variables, masked), or name another variable with the api_key_variable input."
export PR_LENS_API_KEY="${API_KEY}"

TOKEN="${!PR_LENS_TOKEN_VARIABLE:-}"
if [ "${PR_LENS_COMMENT}" = "true" ] && [ -z "${TOKEN}" ]; then
  fail "posting the comment needs a project access token with the api scope in the CI/CD variable ${PR_LENS_TOKEN_VARIABLE}. CI_JOB_TOKEN cannot post notes — its API access is read-only for merge requests."
fi

git cat-file -e "${CI_MERGE_REQUEST_DIFF_BASE_SHA}^{commit}" 2>/dev/null \
  || fail "the diff base ${CI_MERGE_REQUEST_DIFF_BASE_SHA} is not in this clone. The component sets GIT_DEPTH \"0\"; a job that overrides it must fetch enough history to reach the base."

# In a merged results pipeline CI_COMMIT_SHA is an ephemeral merge-result
# commit the merge request API will never name, so comparing against it would
# read every run as overtaken — a permanent, silent no-op. The source branch
# head is what the comment describes; the variable below is non-empty exactly
# in merged results pipelines.
HEAD_SHA="${CI_MERGE_REQUEST_SOURCE_BRANCH_SHA:-${CI_COMMIT_SHA}}"

WORK="${PR_LENS_WORK:-$(mktemp -d)}"

cli() {
  npx --yes "@coldtea/pr-lens-cli@${PR_LENS_CLI_VERSION}" "$@"
}

cli analyze \
  --base "${CI_MERGE_REQUEST_DIFF_BASE_SHA}" \
  --head "${HEAD_SHA}" \
  --pr "${CI_MERGE_REQUEST_IID}" \
  --forge gitlab \
  --provider "${PR_LENS_MODEL_PROVIDER}" \
  --api-key-env PR_LENS_API_KEY \
  ${PR_LENS_MODEL:+--model "${PR_LENS_MODEL}"} \
  ${PR_LENS_BASE_URL:+--base-url "${PR_LENS_BASE_URL}"} \
  ${PR_LENS_LENS:+--lens "${PR_LENS_LENS}"} \
  --out "${WORK}/graph.json"

cli render "${WORK}/graph.json" --out "${WORK}/assets"

if [ "${PR_LENS_COMMENT}" != "true" ]; then
  echo "Comment disabled; the render is in ${WORK}/assets."
  exit 0
fi

api() {
  curl -fsS --header "PRIVATE-TOKEN: ${TOKEN}" "$@"
}

json() {
  node -e "let d=\"\";process.stdin.on(\"data\",c=>d+=c).on(\"end\",()=>{${1}})"
}

# Whether this run still describes the merge request as it stands. A run that
# was overtaken while it drew has nothing useful to say: its diagrams are of a
# commit that is no longer the head, and posting them would replace a newer
# comment with an older picture. Not knowing is a failure, not a reason to
# stay quiet, so a failed lookup exits rather than returning.
overtaken() {
  local current
  if ! current="$(api "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/merge_requests/${CI_MERGE_REQUEST_IID}" \
    | json 'const mr=JSON.parse(d);if(!mr.sha)process.exit(1);console.log(mr.sha)')"; then
    fail "could not ask GitLab what !${CI_MERGE_REQUEST_IID} points at, so this run cannot tell whether its diagram is still the current one."
  fi

  if [ "${current}" = "${HEAD_SHA}" ]; then
    return 1
  fi

  echo "!${CI_MERGE_REQUEST_IID} has moved on to ${current}; leaving the comment to the run that is drawing it."
  return 0
}

# Once here, to spend nothing on uploads that will not be shown.
if overtaken; then
  exit 0
fi

# ponytail: every push adds attachments nothing deletes — storage only,
# invisible to readers; clean up via the project uploads delete API if it
# ever matters.
for FILE in "${WORK}"/assets/*.svg; do
  api --form "file=@${FILE}" "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/uploads" > "${FILE}.upload.json" \
    || fail "could not upload $(basename "${FILE}")"
done

# Each asset gets the absolute URL its upload came back with; the composer
# prefers an asset's own url over any base-url prefix.
node - "${WORK}/assets/manifest.json" "${CI_SERVER_URL}" <<'PATCH'
const fs = require("node:fs");
const path = require("node:path");
const [manifestPath, serverUrl] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
for (const asset of manifest.assets) {
  if (asset.path === undefined) continue;
  const upload = JSON.parse(
    fs.readFileSync(path.join(path.dirname(manifestPath), `${asset.path}.upload.json`), "utf8"),
  );
  if (!upload.full_path) {
    console.error(`the upload for ${asset.path} returned no full_path`);
    process.exit(1);
  }
  asset.url = serverUrl + upload.full_path;
}
fs.writeFileSync(path.join(path.dirname(manifestPath), "uploaded.manifest.json"), JSON.stringify(manifest));
PATCH

BRANDING_FLAG=""
if [ "${PR_LENS_BRANDING}" = "false" ]; then
  BRANDING_FLAG="--no-branding"
fi

cli comment \
  --target gitlab \
  --graph "${WORK}/assets/drawn.graph.json" \
  --manifest "${WORK}/assets/uploaded.manifest.json" \
  ${BRANDING_FLAG} \
  --out "${WORK}/comment.md"

MARKER="$(cli comment --print-marker --target gitlab)"

# The token's own bot user: ownership decides what may be edited, and a
# marker on somebody else's note is simply not ours.
WHOAMI="$(api "${CI_API_V4_URL}/user" | json 'console.log(JSON.parse(d).username||"")')"
[ -n "${WHOAMI}" ] || fail "GitLab did not name the user behind ${PR_LENS_TOKEN_VARIABLE}."

: > "${WORK}/notes.jsonl"
PAGE=1
while :; do
  api "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/merge_requests/${CI_MERGE_REQUEST_IID}/notes?per_page=100&page=${PAGE}" \
    | json 'for(const n of JSON.parse(d))console.log(JSON.stringify(n))' >> "${WORK}/notes.jsonl"
  LINES="$(wc -l < "${WORK}/notes.jsonl")"
  if [ "${LINES}" -lt $(( PAGE * 100 )) ]; then
    break
  fi
  PAGE=$(( PAGE + 1 ))
done

MINE="$(node - "${WORK}/notes.jsonl" "${WHOAMI}" "${MARKER}" <<'FIND'
const fs = require("node:fs");
const [notesPath, whoami, marker] = process.argv.slice(2);
for (const line of fs.readFileSync(notesPath, "utf8").split("\n")) {
  if (line === "") continue;
  const note = JSON.parse(line);
  if (note.author?.username === whoami && typeof note.body === "string" && note.body.startsWith(marker)) {
    console.log(note.id);
    break;
  }
}
FIND
)"

# And again here, because the uploads and the listing cost seconds, and this
# is the check that guards the write.
if overtaken; then
  exit 0
fi

BODY_JSON="${WORK}/note.json"
node -e 'const fs=require("node:fs");process.stdout.write(JSON.stringify({body:fs.readFileSync(process.argv[1],"utf8")}))' \
  "${WORK}/comment.md" > "${BODY_JSON}"

if [ -n "${MINE}" ]; then
  api -X PUT --header "Content-Type: application/json" --data "@${BODY_JSON}" \
    "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/merge_requests/${CI_MERGE_REQUEST_IID}/notes/${MINE}" > /dev/null
else
  api -X POST --header "Content-Type: application/json" --data "@${BODY_JSON}" \
    "${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/merge_requests/${CI_MERGE_REQUEST_IID}/notes" > /dev/null
fi

echo "✓ the PR Lens comment is on !${CI_MERGE_REQUEST_IID}"
