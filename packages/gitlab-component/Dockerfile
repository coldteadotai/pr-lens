# The image the component is meant to run on: node, git, curl, and the PR
# Lens CLI already installed.
#
# The component works on a plain `node:20`, and then every pipeline fetches
# and executes the CLI at job time — whatever the registry serves that
# minute, inside a job that holds the project's CI/CD variables, with the
# install billed to the project's minutes. Pointing the `image` input here
# resolves the CLI once, at build time, at a version this tag is built
# against.
#
# No ENTRYPOINT: GitLab runs the job's own script, and an entrypoint would
# fight it.
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*

ARG CLI_VERSION=0.6.1
RUN npm install -g "@coldtea/pr-lens-cli@${CLI_VERSION}" \
  && npm cache clean --force

# What the component's script compares the requested version against before
# using the baked CLI instead of npx.
ENV PR_LENS_BAKED_CLI_VERSION=${CLI_VERSION}
