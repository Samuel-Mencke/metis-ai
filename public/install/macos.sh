#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${METIS_AI_REPO_URL:-https://github.com/f1shyondrugs/metis-ai.git}"
DEFAULT_DIR="${METIS_AI_INSTALL_DIR:-$HOME/metis-ai}"
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
ask() {
  local prompt="$1" default="${2:-}" value
  read -r -p "$prompt [$default]: " value
  printf '%s' "${value:-$default}"
}
command -v brew >/dev/null 2>&1 || die "Homebrew is required on macOS. Install it from https://brew.sh."
command -v git >/dev/null 2>&1 || brew install git
command -v node >/dev/null 2>&1 || brew install node
command -v pnpm >/dev/null 2>&1 || brew install pnpm

install_dir="$(ask "Installation directory" "$DEFAULT_DIR")"
install_dir="${install_dir/#\~/$HOME}"
if [[ -e "$install_dir/.git" ]]; then
  git -C "$install_dir" pull --ff-only
elif [[ -e "$install_dir" && -n "$(ls -A "$install_dir" 2>/dev/null)" ]]; then
  die "Installation directory exists and is not an existing Metis AI checkout."
else
  mkdir -p "$(dirname "$install_dir")"
  git clone "$REPO_URL" "$install_dir"
fi

data_dir="$(ask "Data directory" "$install_dir/data")"
agent_cwd="$(ask "Agent workspace directory" "$HOME")"
port="$(ask "Web application port" "3100")"
mcp_port="$(ask "MCP gateway port" "8787")"
username="$(ask "Initial username" "admin")"
read -r -s -p "Initial password: " password; printf '\n'
read -r -s -p "Confirm password: " password_confirm; printf '\n'
[[ ${#password} -ge 8 && "$password" == "$password_confirm" ]] || die "Passwords must match and contain at least 8 characters."
service_name="$(ask "Service name" "metis-ai")"
public_url="$(ask "Public URL" "http://127.0.0.1:${port}")"
node_bin="$(command -v node)"
node_home="$(dirname "$(dirname "$node_bin")")"
chat_password="$(openssl rand -hex 32)"
secrets_key="$(openssl rand -hex 32)"
mcp_token="$(openssl rand -hex 32)"

mkdir -p "$data_dir" "$agent_cwd"
cat > "$install_dir/.env" <<EOF
APP_NAME=Metis AI
PORT=$port
CHAT_USERNAME=$username
CHAT_PASSWORD=$chat_password
CHAT_DATA_DIR=$data_dir
AGENT_CWD=$agent_cwd
AI_CHAT_ROOT=$install_dir
AI_CHAT_INSTALL_DIR=$install_dir
AI_CHAT_PUBLIC_URL=$public_url
AI_CHAT_SERVICE_NAME=$service_name
AI_CHAT_MCP_STATE_DIR=$data_dir/mcp-state
AI_CHAT_SECRETS_KEY=$secrets_key
MCP_PORT=$mcp_port
MCP_PUBLIC_URL=http://127.0.0.1:$mcp_port
MCP_BEARER_TOKEN=$mcp_token
MCP_ALLOW_REMOTE_ADMIN=false
MCP_ENABLE_REMOTE_SERVERS=false
MCP_ENABLE_OPTIONAL_SERVERS=false
EOF
chmod 600 "$install_dir/.env"

(
  set -a; source "$install_dir/.env"; set +a
  cd "$install_dir"
  pnpm install --frozen-lockfile
  METIS_AI_BOOTSTRAP_USERNAME="$username" METIS_AI_BOOTSTRAP_PASSWORD="$password" METIS_AI_BOOTSTRAP_OPTIONAL=1 pnpm exec tsx scripts/bootstrap-user.ts
  pnpm build
)

launch_dir="$HOME/Library/LaunchAgents"
mkdir -p "$launch_dir"
write_plist() {
  local suffix="$1" command="$2" label="${service_name}-${suffix}"
  cat > "$launch_dir/$label.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>-lc</string><string>set -a; source "$install_dir/.env"; set +a; exec $node_bin $command</string></array>
  <key>WorkingDirectory</key><string>$install_dir</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$data_dir/$label.log</string>
  <key>StandardErrorPath</key><string>$data_dir/$label.error.log</string>
</dict></plist>
EOF
  launchctl bootout "gui/$(id -u)" "$launch_dir/$label.plist" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$launch_dir/$label.plist"
}
write_plist app "$install_dir/server.mjs"
write_plist worker "$install_dir/node_modules/tsx/dist/cli.mjs $install_dir/worker.ts"
write_plist mcp "$install_dir/lib/mcp-core/gateway-core.mjs"
curl --fail --silent --show-error --retry 20 --retry-delay 1 "http://127.0.0.1:$port/api/status" >/dev/null ||
  die "The application did not become healthy. Check launchctl and the service logs."

cat > "$install_dir/.metis-ai-install.json" <<EOF
{"installDir":"$install_dir","dataDir":"$data_dir","agentCwd":"$agent_cwd","serviceName":"$service_name","os":"macos","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF
chmod 600 "$install_dir/.metis-ai-install.json"
cp "$install_dir/install/uninstall-macos.sh" "$install_dir/uninstall-macos.sh"
chmod 700 "$install_dir/uninstall-macos.sh"
printf '\nMetis AI installed successfully.\nOpen: %s\nUninstall: %s/install/uninstall-macos.sh --install-dir %q --keep-data\n' "$public_url" "$public_url" "$install_dir"
