#!/usr/bin/env bash
# Deploys the static site to a Coolify application of this machine: the
# image of deploy/Dockerfile (dist/, from scripts/dist.mjs), tagged with the
# commit, pushed to a registry of this machine (Coolify pulls the image it
# runs), then the application pointed at it and deployed.
#   scripts/deploy.sh APP_UUID      (after node scripts/dist.mjs)
# REGISTRY: default localhost:5000 (a registry:2 container, rocq-web-registry)
set -euo pipefail
cd "$(dirname "$0")/.."
app=$1
registry=${REGISTRY:-localhost:5000}
tag=$(git rev-parse --short HEAD)$(git diff --quiet HEAD -- scripts/serve.mjs deploy || echo -dirty)
[ -f dist/rocq/full/files.json ] || { echo "no dist/: node scripts/dist.mjs" >&2; exit 1; }
if ! docker ps --format '{{.Names}}' | grep -qx rocq-web-registry && [ "$registry" = localhost:5000 ]; then
  docker run -d --name rocq-web-registry --restart unless-stopped -p 127.0.0.1:5000:5000 \
    -v rocq-web-registry:/var/lib/registry registry:2
fi
docker build -q -f deploy/Dockerfile -t "$registry/rocq-web:$tag" .
docker push -q "$registry/rocq-web:$tag"
coolify app update "$app" --docker-image "$registry/rocq-web" --docker-tag "$tag" > /dev/null
deployment=$(coolify deploy uuid "$app" --format json | sed -n 's/.*"deployment_uuid":"\([^"]*\)".*/\1/p')
echo "deploying $registry/rocq-web:$tag ($deployment)"
for _ in $(seq 120); do
  status=$(coolify deploy get "$deployment" --format json | sed -n 's/.*"status":"\([^"]*\)".*/\1/p' | head -1)
  case $status in finished) echo deployed; exit 0 ;; failed | cancelled*) echo "deployment $status" >&2; exit 1 ;; esac
  sleep 5
done
echo "deployment still $status" >&2
exit 1
