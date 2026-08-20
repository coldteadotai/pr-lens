#!/usr/bin/env bash
#
# Publishes a render to the data branch: an orphan branch that holds no code,
# one directory per pull request per commit.
#
# GitHub proxies comment images through a cache that never revalidates, so a
# changed diagram has to arrive as a new URL rather than as new bytes at the
# old one. The renderer names every file after the hash of its own contents,
# so a directory is written once and never rewritten.
set -euo pipefail

DIRECTORY="pr/${PR_NUMBER}/${HEAD_SHA}"
WORKSPACE="${RUNNER_TEMP}/pr-lens-publish"
PUSHED=""

# Every run of every pull request shares this one branch, so losing the race is
# ordinary rather than exceptional: pick the tip up again and replay onto it.
# Two runs never write the same path, so a retry only ever has to catch up.
for ATTEMPT in 1 2 3 4 5; do
  rm -rf "${WORKSPACE}"
  mkdir -p "${WORKSPACE}"
  cd "${WORKSPACE}"

  git init --quiet
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

  if git fetch --quiet --depth=1 origin "${DATA_BRANCH}" 2>/dev/null; then
    git checkout --quiet -b "${DATA_BRANCH}" FETCH_HEAD
  else
    git checkout --quiet --orphan "${DATA_BRANCH}"
  fi

  mkdir -p "${DIRECTORY}"
  cp "${RUNNER_TEMP}"/pr-lens/assets/*.svg "${DIRECTORY}/"
  git add "${DIRECTORY}"

  if git diff --quiet --cached; then
    echo "This render is already published."
    PUSHED="already"
    break
  fi

  git commit --quiet -m "PR Lens: #${PR_NUMBER} at ${HEAD_SHA}"

  if git push --quiet origin "${DATA_BRANCH}"; then
    PUSHED="yes"
    break
  fi

  echo "${DATA_BRANCH} moved under this run; retrying (${ATTEMPT}/5)."
  sleep "$(( ATTEMPT * 3 ))"
done

if [ -z "${PUSHED}" ]; then
  echo "::error::Could not publish the diagrams: ${DATA_BRANCH} kept moving. Give the workflow a per-pull-request concurrency group."
  exit 1
fi

echo "assets-url=https://raw.githubusercontent.com/${GITHUB_REPOSITORY}/${DATA_BRANCH}/${DIRECTORY}" >> "${GITHUB_OUTPUT}"
