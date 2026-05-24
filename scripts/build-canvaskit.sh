#!/usr/bin/env bash
#
# Build a PDF-enabled CanvasKit WASM bundle and copy the artifacts into
# public/canvaskit/.
#
# Prereqs: Docker daemon running. The Skia build takes ~30-60 minutes on
# a modern laptop and consumes several GB of disk inside the container.
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTEXT="${REPO_ROOT}/docker/canvaskit-build"
OUT_DIR="${REPO_ROOT}/public/canvaskit"
IMAGE_TAG="canvaskit-pdf:latest"

if ! command -v docker >/dev/null 2>&1; then
    echo "error: docker is not installed or not on PATH" >&2
    exit 1
fi

mkdir -p "${OUT_DIR}"

echo "[build-canvaskit] building docker image (${IMAGE_TAG})..."
docker build -t "${IMAGE_TAG}" "${CONTEXT}"

echo "[build-canvaskit] running build container, output -> ${OUT_DIR}"
docker run --rm -v "${OUT_DIR}:/out" "${IMAGE_TAG}"

echo "[build-canvaskit] done. Artifacts in ${OUT_DIR}:"
ls -lh "${OUT_DIR}"
