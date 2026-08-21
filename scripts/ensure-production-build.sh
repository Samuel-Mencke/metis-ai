#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
cd "${AI_CHAT_ROOT:-$PROJECT_ROOT}"

BUILD_DIR="${NEXT_DIST_DIR:-.next-a}"
case "$BUILD_DIR" in
  .next-a|.next-b) ;;
  *) echo "Invalid NEXT_DIST_DIR for Metis production: $BUILD_DIR" >&2; exit 2 ;;
esac

[[ -s "$BUILD_DIR/BUILD_ID" ]] && exit 0

lock_file="${XDG_RUNTIME_DIR:-/tmp}/metis-ai-production-build.lock"
exec 9>"$lock_file"
flock -w 1200 9

# Another start/deploy may have completed the build while we waited.
[[ -s "$BUILD_DIR/BUILD_ID" ]] && exit 0

exec "$SCRIPT_DIR/build-production-slot.sh" "$BUILD_DIR"
