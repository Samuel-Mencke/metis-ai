#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
set -a
# shellcheck disable=SC1091
. "$ROOT/.env"
if [[ -f "$ROOT/.deploy.env" ]]; then
  # shellcheck disable=SC1091
  . "$ROOT/.deploy.env"
fi
set +a
export PATH="${METIS_NODE_HOME:+$METIS_NODE_HOME/bin:}$ROOT/.runtime/node/bin:$ROOT/node_modules/.bin:/usr/local/bin:/usr/bin:/bin${PATH:+:$PATH}"
cd "$ROOT"

dist_dir="${NEXT_DIST_DIR:-.next-a}"
if [[ "${2:-}" == "$ROOT/server.mjs" || "${1:-}" == "$ROOT/server.mjs" || "${1:-}" == "server.mjs" ]] && [[ ! -s "$ROOT/$dist_dir/BUILD_ID" ]]; then
  "$ROOT/scripts/ensure-production-build.sh"
fi

node_bin="${METIS_NODE_BIN:-$ROOT/.runtime/node/bin/node}"
exec "$node_bin" "$@"
