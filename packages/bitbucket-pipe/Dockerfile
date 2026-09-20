# node for the CLI and the script's JSON handling; git and curl are the only
# other things the run needs.
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/*

COPY pipe/lens.sh /lens.sh

ENTRYPOINT ["bash", "/lens.sh"]
