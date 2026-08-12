#!/usr/bin/env bash
set -Eeuo pipefail

server=""
token=""
install_dir="${METIS_REMOTE_CLIENT_DIR:-$HOME/.metis-ai/remote-client}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --server) server="${2:-}"; shift 2 ;;
    --enrollment-token) token="${2:-}"; shift 2 ;;
    --install-dir) install_dir="${2:-}"; shift 2 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done
[[ -n "$server" && -n "$token" ]] || { printf '%s\n' '--server and --enrollment-token are required' >&2; exit 2; }
command -v node >/dev/null 2>&1 || { printf '%s\n' 'Node.js 20 or newer is required' >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { printf '%s\n' 'curl is required' >&2; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' || exit 1

mkdir -p "$install_dir"
base_url="${server%/}"
response="$(curl -fsSL -X POST "$base_url/api/remote-clients/enroll" \
  -H 'Content-Type: application/json' \
  --data "$(node -e 'console.log(JSON.stringify({token:process.argv[1],name:require("node:os").hostname(),os:"macos",architecture:process.arch,version:"1.0.0",hostname:require("node:os").hostname(),capabilities:["get_info","list_directory","read_file","execute_command","pty_open","pty_input","pty_close"]}))' "$token")")"
node -e 'const value=JSON.parse(process.argv[1]); if (!value.client?.id || !value.credential) process.exit(1)' "$response"
node -e 'const fs=require("node:fs"),path=require("node:path"),value=JSON.parse(process.argv[1]),file=process.argv[2]; fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify({server:process.argv[3],clientId:value.client.id,credential:value.credential},null,2)+"\n",{mode:0o600}); fs.chmodSync(file,0o600)' \
  "$response" "$install_dir/config.json" "$base_url"
curl -fsSL "$base_url/install/remote-client.mjs" -o "$install_dir/client.mjs"
curl -fsSL "$base_url/install/remote-client-uninstall.sh" -o "$install_dir/uninstall.sh"
chmod 700 "$install_dir/client.mjs" "$install_dir/uninstall.sh"
(cd "$install_dir" && npm init -y >/dev/null 2>&1 && npm install --omit=dev --no-audit --no-fund ws >/dev/null)

launch_agents="$HOME/Library/LaunchAgents"
plist="$launch_agents/com.metis-ai.remote-client.plist"
mkdir -p "$launch_agents"
cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.metis-ai.remote-client</string>
  <key>ProgramArguments</key><array>
    <string>$(command -v node)</string><string>$install_dir/client.mjs</string><string>--config</string><string>$install_dir/config.json</string>
  </array>
  <key>WorkingDirectory</key><string>$install_dir</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$install_dir/client.log</string>
  <key>StandardErrorPath</key><string>$install_dir/client-error.log</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$plist"
printf 'Remote client enrolled successfully: %s\n' "$install_dir"
printf 'Remove with: %s/uninstall.sh\n' "$install_dir"

