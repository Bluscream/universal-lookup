#!/usr/bin/env bash
set -e

echo "=== Universal Lookup Linux Update Script ==="

echo "[1/4] Linting and Building..."
npm run format
npm run build

echo "[2/4] Bumping Version..."
npm version patch --no-git-tag-version
VERSION=$(node -p "require('./package.json').version")
echo "Bumped to $VERSION"

echo "[3/4] Committing to Git..."
git add .
git commit -m "chore: update to v$VERSION (statuspage refactor)" || true
git push

echo "[4/4] Building and Pushing Docker Images..."
# Use buildx if docker is available, otherwise podman
if command -v docker &> /dev/null && docker buildx version &> /dev/null; then
    docker buildx use universal-builder 2>/dev/null || docker buildx create --use --name universal-builder
    docker buildx build --platform linux/amd64,linux/arm64 \
      -t ghcr.io/bluscream/universal-lookup:latest \
      -t ghcr.io/bluscream/universal-lookup:$VERSION \
      -t bluscream1/universal-lookup:latest \
      -t bluscream1/universal-lookup:$VERSION \
      --push .
elif command -v podman &> /dev/null; then
    podman manifest rm universal-lookup:$VERSION 2>/dev/null || true
    podman manifest create universal-lookup:$VERSION
    podman build --platform linux/amd64,linux/arm64 --manifest universal-lookup:$VERSION .
    
    podman manifest push universal-lookup:$VERSION docker://ghcr.io/bluscream/universal-lookup:latest
    podman manifest push universal-lookup:$VERSION docker://ghcr.io/bluscream/universal-lookup:$VERSION
    podman manifest push universal-lookup:$VERSION docker://docker.io/bluscream1/universal-lookup:latest
    podman manifest push universal-lookup:$VERSION docker://docker.io/bluscream1/universal-lookup:$VERSION
else
    echo "Neither Docker Buildx nor Podman found! Cannot build container images."
    exit 1
fi

echo "=== Deployment Complete! ==="
