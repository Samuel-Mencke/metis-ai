#!/usr/bin/env bash
set -euo pipefail

cd /home/f1shy312/ai-chat

# A service restart must never try to serve an incomplete build. Deploys that
# were interrupted leave .next without BUILD_ID; rebuild it as the service
# account before Next.js starts.
if [[ ! -s .next/BUILD_ID ]]; then
  exec pnpm build
fi
