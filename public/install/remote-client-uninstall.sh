#!/usr/bin/env bash
set -Eeuo pipefail

install_dir="${1:-${METIS_REMOTE_CLIENT_DIR:-$HOME/.metis-ai/remote-client}}"
service_name="metis-ai-remote-client"
if command -v launchctl >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.metis-ai.remote-client.plist" >/dev/null 2>&1 || true
  rm -f "$HOME/Library/LaunchAgents/com.metis-ai.remote-client.plist"
fi
if command -v systemctl >/dev/null 2>&1; then
  systemctl --user disable --now "$service_name.service" >/dev/null 2>&1 || true
  sudo systemctl disable --now "$service_name.service" >/dev/null 2>&1 || true
fi
pkill -f "$install_dir/client.mjs" >/dev/null 2>&1 || true
rm -rf -- "$install_dir"
printf 'Remote client removed: %s\n' "$install_dir"

