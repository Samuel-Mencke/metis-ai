#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
cd "${AI_CHAT_ROOT:-$PROJECT_ROOT}"

# A service restart must never try to serve an incomplete build. Deploys that
# were interrupted leave .next without BUILD_ID; rebuild it as the service
# account before Next.js starts.
if [[ ! -s .next/BUILD_ID ]]; then
  exec pnpm build
fi
