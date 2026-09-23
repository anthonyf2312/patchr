#!/bin/sh
# Pulls the newest images for the tags in compose.yaml and .env, and restarts Patchr if they changed.
# Run it from cron (no root needed) or the systemd timer next to it. The server pulls, so this works
# behind NAT too: nothing has to reach in from GitHub.
#
# Quiet unless something changed, and it only removes images this Patchr stopped using, so other
# projects on the same machine are never touched.
set -eu

cd "${PATCHR_DIR:-$(dirname "$0")/..}"

before=$(docker compose images --quiet | sort)

# Compose prints pull progress even with --quiet, so output is kept only when a step fails.
if ! out=$(docker compose pull --quiet 2>&1); then
  echo "$(date -Iseconds) pull failed:"
  echo "$out"
  exit 1
fi

if ! out=$(docker compose up -d --remove-orphans 2>&1); then
  echo "$(date -Iseconds) update failed:"
  echo "$out"
  exit 1
fi

after=$(docker compose images --quiet | sort)
if [ "$before" != "$after" ]; then
  echo "$(date -Iseconds) updated: $(echo "$after" | tr '\n' ' ')"
  for image in $before; do
    # Fails harmlessly if anything still uses the image.
    docker image rm "$image" > /dev/null 2>&1 || true
  done
fi
