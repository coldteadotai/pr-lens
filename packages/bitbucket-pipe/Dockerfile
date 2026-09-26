# node for the CLI and the script's JSON handling; git and curl are the only
# other things the run needs.
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*

# The CLI is baked in rather than fetched per run. A pipe that downloads and
# executes fresh code on every pipeline puts whatever the registry served
# that minute inside the customer's CI, where their repository variables
# live, and charges them the install time on top. Pinned here, resolved once,
# at a version this image is built and tagged against.
ARG CLI_VERSION=0.10.0
RUN npm install -g "@coldtea/pr-lens-cli@${CLI_VERSION}" \
  && npm cache clean --force

# The script compares against this to decide whether the baked CLI is the one
# asked for, and falls back to npx only when a run overrides the version.
ENV PR_LENS_BAKED_CLI_VERSION=${CLI_VERSION}

COPY pipe/lens.sh /lens.sh

ENTRYPOINT ["bash", "/lens.sh"]
