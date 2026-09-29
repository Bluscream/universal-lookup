#!/usr/bin/env bash
# Build, verify, publish and tag a release.
#
# Usage: scripts/update.sh [commit message]
set -euo pipefail

cd "$(dirname "$0")/.."

MESSAGE="${1:-}"

echo "=== Universal Lookup release ==="

echo "[1/5] Verifying (format, lint, typecheck, build, tests)..."
# The whole gate, not just a build. Nothing is published if any step fails.
npm run verify

echo "[2/5] Bumping version..."
npm version patch --no-git-tag-version
VERSION=$(node -p "require('./package.json').version")
echo "Bumped to $VERSION"

echo "[3/5] Committing..."
git add -u
git commit -m "chore: release v$VERSION${MESSAGE:+ — $MESSAGE}" || true

echo "[4/5] Building and pushing images..."
# Push images BEFORE pushing the commit: a failed build otherwise leaves a
# release commit on the remote that no image corresponds to.
TAGS=(
  "ghcr.io/bluscream/universal-lookup:latest"
  "ghcr.io/bluscream/universal-lookup:$VERSION"
  "docker.io/bluscream1/universal-lookup:latest"
  "docker.io/bluscream1/universal-lookup:$VERSION"
)

if command -v docker &>/dev/null && docker buildx version &>/dev/null; then
  docker buildx use universal-builder 2>/dev/null || docker buildx create --use --name universal-builder
  docker buildx build --platform linux/amd64,linux/arm64 \
    "${TAGS[@]/#/--tag=}" \
    --push .
elif command -v podman &>/dev/null; then
  podman manifest rm "universal-lookup:$VERSION" 2>/dev/null || true
  podman manifest create "universal-lookup:$VERSION"
  podman build --platform linux/amd64,linux/arm64 --manifest "universal-lookup:$VERSION" .
  for tag in "${TAGS[@]}"; do
    podman manifest push --all "universal-lookup:$VERSION" "docker://$tag"
  done
else
  echo "Neither Docker Buildx nor Podman found; cannot build container images." >&2
  exit 1
fi

echo "[5/5] Pushing commit..."
git push

cat <<EOF

=== Published v$VERSION ===

The NAS does NOT pull on rebuild. To deploy:

  ssh root@nas "docker pull bluscream1/universal-lookup:latest && \\
    /usr/local/emhttp/plugins/dynamix.docker.manager/scripts/rebuild_container universal-lookup"

Without the pull, rebuild_container recreates the container from the cached
image and silently keeps running the old build.
EOF
