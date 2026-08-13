#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${METIS_AI_REPO_URL:-https://github.com/f1shyondrugs/metis-ai.git}"
DEFAULT_DIR="${METIS_AI_INSTALL_DIR:-$HOME/metis-ai}"
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
confirm_install() {
  local name="$1" answer
  [[ "${non_interactive:-0}" == "1" ]] && return 0
  read -r -p "$name is missing or too old. Install/update it automatically? [Y/n] " answer
  [[ -z "$answer" || "$answer" =~ ^([Yy][Ee][Ss]|[Yy])$ ]]
}
version_at_least_20() {
  command -v "$1" >/dev/null 2>&1 &&
    [[ "$("$1" -p 'process.versions.node.split(".")[0]')" -ge 20 ]]
}
usage() {
  cat <<'EOF'
Usage:
  macos.sh                                  Guided installation
  macos.sh --non-interactive --password P  Argument-only installation

Options:
  --install-dir DIR       Application checkout (default: ~/metis-ai)
  --data-dir DIR          Runtime data directory (default: INSTALL_DIR/data)
  --agent-cwd DIR         Agent workspace (default: $HOME)
  --port PORT             Web port (default: 3100)
  --host HOST             Bind address (default: 127.0.0.1)
  --mcp-port PORT         MCP gateway port (default: 8787)
  --username NAME         Initial login name (default: admin)
  --password PASSWORD     Initial login password (minimum 8 characters)
  --password-file FILE    Read the initial password from a file
  --service-name NAME     launchd service prefix (default: metis-ai)
  --public-url URL        URL shown to users
  --non-interactive       Never read prompts; all values come from arguments/defaults
  -h, --help              Show this help
EOF
}
ask() {
  local prompt="$1" default="${2:-}" value
  [[ -r /dev/tty ]] || die "Interactive installation needs a terminal. Use --non-interactive with --password."
  IFS= read -r -p "$prompt [$default]: " value < /dev/tty
  printf '%s' "${value:-$default}"
}
non_interactive=0
install_dir="$DEFAULT_DIR"
data_dir=""
agent_cwd="$HOME"
port="3100"
ai_chat_host=""
mcp_port="8787"
username="admin"
password=""
password_file=""
service_name="metis-ai"
public_url=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir) [[ $# -ge 2 ]] || die "--install-dir requires a value"; install_dir="$2"; shift 2 ;;
    --data-dir) [[ $# -ge 2 ]] || die "--data-dir requires a value"; data_dir="$2"; shift 2 ;;
    --agent-cwd) [[ $# -ge 2 ]] || die "--agent-cwd requires a value"; agent_cwd="$2"; shift 2 ;;
    --port) [[ $# -ge 2 ]] || die "--port requires a value"; port="$2"; shift 2 ;;
    --host) [[ $# -ge 2 ]] || die "--host requires a value"; ai_chat_host="$2"; shift 2 ;;
    --mcp-port) [[ $# -ge 2 ]] || die "--mcp-port requires a value"; mcp_port="$2"; shift 2 ;;
    --username) [[ $# -ge 2 ]] || die "--username requires a value"; username="$2"; shift 2 ;;
    --password) [[ $# -ge 2 ]] || die "--password requires a value"; password="$2"; shift 2 ;;
    --password-file) [[ $# -ge 2 ]] || die "--password-file requires a value"; password_file="$2"; shift 2 ;;
    --service-name) [[ $# -ge 2 ]] || die "--service-name requires a value"; service_name="$2"; shift 2 ;;
    --public-url) [[ $# -ge 2 ]] || die "--public-url requires a value"; public_url="$2"; shift 2 ;;
    --non-interactive) non_interactive=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (use --help for usage)" ;;
  esac
done
install_dir="${install_dir/#\~/$HOME}"
if (( non_interactive )); then
  if [[ -n "$password_file" ]]; then
    [[ -r "$password_file" ]] || die "--password-file is not readable: $password_file"
    IFS= read -r password < "$password_file" || true
  fi
  [[ -n "$password" ]] || die "--password is required with --non-interactive."
  ai_chat_host="${ai_chat_host:-127.0.0.1}"
else
  install_dir="$(ask "Installation directory" "$install_dir")"
  install_dir="${install_dir/#\~/$HOME}"
fi
default_public_host() {
  local host
  host="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  printf '%s' "${host:-127.0.0.1}"
}
command -v brew >/dev/null 2>&1 || die "Homebrew is required on macOS. Install it from https://brew.sh."
command -v git >/dev/null 2>&1 || { confirm_install "git" && brew install git || die "git is required."; }
if ! version_at_least_20 node; then
  confirm_install "Node.js 20 or newer" || die "Node.js 20 or newer is required."
  if command -v node >/dev/null 2>&1; then brew upgrade node || true; else brew install node; fi
fi
version_at_least_20 node || die "Node.js 20 or newer is required after installation."
command -v pnpm >/dev/null 2>&1 || { confirm_install "pnpm" && brew install pnpm || die "pnpm is required."; }

if [[ -e "$install_dir/.git" ]]; then
  git -C "$install_dir" pull --ff-only
elif [[ -e "$install_dir" && -n "$(ls -A "$install_dir" 2>/dev/null)" ]]; then
  die "Installation directory exists and is not an existing Metis AI checkout."
else
  mkdir -p "$(dirname "$install_dir")"
  git clone "$REPO_URL" "$install_dir"
fi

if (( ! non_interactive )); then
  data_dir="$(ask "Data directory" "${data_dir:-$install_dir/data}")"
  agent_cwd="$(ask "Agent workspace directory" "$agent_cwd")"
  port="$(ask "Web application port" "$port")"
  host_mode="$(ask "Host web application on local network? (y/N)" "n")"
  if [[ "$host_mode" =~ ^([Yy][Ee][Ss]|[Yy]|1|[Tt][Rr][Uu][Ee])$ ]]; then
    ai_chat_host="0.0.0.0"
    public_host="$(default_public_host)"
  else
    ai_chat_host="127.0.0.1"
    public_host="127.0.0.1"
  fi
  mcp_port="$(ask "MCP gateway port" "$mcp_port")"
  username="$(ask "Initial username" "$username")"
  read -r -s -p "Initial password: " password < /dev/tty; printf '\n'
  read -r -s -p "Confirm password: " password_confirm < /dev/tty; printf '\n'
  [[ ${#password} -ge 8 && "$password" == "$password_confirm" ]] || die "Passwords must match and contain at least 8 characters."
  service_name="$(ask "Service name" "$service_name")"
  public_url="$(ask "Public URL" "${public_url:-http://${public_host}:${port}}")"
else
  data_dir="${data_dir:-$install_dir/data}"
  public_host="${ai_chat_host#0.0.0.0}"
  public_host="${public_host:-127.0.0.1}"
  public_url="${public_url:-http://${public_host}:${port}}"
fi
[[ ${#password} -ge 8 ]] || die "Password must contain at least 8 characters."
node_bin="$(command -v node)"
node_home="$(dirname "$(dirname "$node_bin")")"
chat_password="$(openssl rand -hex 32)"
secrets_key="$(openssl rand -hex 32)"
mcp_token="$(openssl rand -hex 32)"

mkdir -p "$data_dir" "$agent_cwd"
{
  printf 'APP_NAME=%q\n' 'Metis AI'
  printf 'PORT=%q\n' "$port"
  printf 'AI_CHAT_HOST=%q\n' "$ai_chat_host"
  printf 'CHAT_USERNAME=%q\n' "$username"
  printf 'CHAT_PASSWORD=%q\n' "$chat_password"
  printf 'CHAT_DATA_DIR=%q\n' "$data_dir"
  printf 'AGENT_CWD=%q\n' "$agent_cwd"
  printf 'AI_CHAT_ROOT=%q\n' "$install_dir"
  printf 'AI_CHAT_INSTALL_DIR=%q\n' "$install_dir"
  printf 'AI_CHAT_PUBLIC_URL=%q\n' "$public_url"
  printf 'AI_CHAT_SERVICE_NAME=%q\n' "$service_name"
  printf 'AI_CHAT_MCP_STATE_DIR=%q\n' "$data_dir/mcp-state"
  printf 'AI_CHAT_SECRETS_KEY=%q\n' "$secrets_key"
  printf 'MCP_PORT=%q\n' "$mcp_port"
  printf 'MCP_PUBLIC_URL=%q\n' "http://127.0.0.1:$mcp_port"
  printf 'AI_CHAT_INTERNAL_URL=%q\n' "http://127.0.0.1:$port/api/internal/mcp-question"
  printf 'MCP_BEARER_TOKEN=%q\n' "$mcp_token"
  printf 'MCP_ALLOW_REMOTE_ADMIN=false\n'
  printf 'MCP_ENABLE_REMOTE_SERVERS=false\n'
  printf 'MCP_ENABLE_OPTIONAL_SERVERS=false\n'
} > "$install_dir/.env"
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
  local suffix command label shell_command arg
  suffix="$1"
  shift
  label="${service_name}-${suffix}"
  shell_command="set -a; source $(printf '%q' "$install_dir/.env"); set +a; exec $(printf '%q' "$node_bin")"
  for arg in "$@"; do
    shell_command+=" $(printf '%q' "$arg")"
  done
  cat > "$launch_dir/$label.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>-lc</string><string>$shell_command</string></array>
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
write_plist app "$install_dir/node_modules/tsx/dist/cli.mjs" "$install_dir/server.mjs"
write_plist worker "$install_dir/node_modules/tsx/dist/cli.mjs" "$install_dir/worker.ts"
write_plist mcp "$install_dir/lib/mcp-core/gateway-core.mjs"
curl --fail --silent --show-error --retry 20 --retry-delay 1 --retry-connrefused --max-time 10 "http://127.0.0.1:$port/api/status" >/dev/null ||
  die "The application did not become healthy. Check launchctl and the service logs."

cat > "$install_dir/.metis-ai-install.json" <<EOF
{"installDir":"$install_dir","dataDir":"$data_dir","agentCwd":"$agent_cwd","serviceName":"$service_name","host":"$ai_chat_host","os":"macos","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF
chmod 600 "$install_dir/.metis-ai-install.json"
cp "$install_dir/install/uninstall-macos.sh" "$install_dir/uninstall-macos.sh"
chmod 700 "$install_dir/uninstall-macos.sh"
if [[ "$ai_chat_host" == "0.0.0.0" ]]; then
  printf 'Warning: the web application is reachable on the local network. Use strong credentials and a firewall or trusted TLS reverse proxy.\n'
fi
printf '\nMetis AI installed successfully.\nOpen: %s\nUninstall: %s/install/uninstall-macos.sh --install-dir %q --keep-data\n' "$public_url" "$public_url" "$install_dir"
