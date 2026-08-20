#!/bin/sh
set -eu
mkdir -p /data /workspace
if [ -n "${METIS_AI_BOOTSTRAP_USERNAME:-}" ] && [ -n "${METIS_AI_BOOTSTRAP_PASSWORD:-}" ]; then
  METIS_AI_BOOTSTRAP_OPTIONAL=1 pnpm exec tsx scripts/bootstrap-user.ts || true
fi
exec "$@"
