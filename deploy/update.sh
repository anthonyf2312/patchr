#!/bin/sh
# Pulls the newest image for the tag in compose.yaml and restarts Patchr if it changed.
# Run it from a systemd timer (see patchr-update.timer) or cron. Because the server pulls,
# this works behind NAT too: nothing has to reach in from GitHub.
set -eu

cd "${PATCHR_DIR:-$(dirname "$0")/..}"

docker compose pull --quiet
docker compose up -d --remove-orphans
docker image prune --force > /dev/null
