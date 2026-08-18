#!/usr/bin/env bash
# Metis AI macOS installer. Run as a file, not via `curl | bash`.
# Prefer: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/f1shyondrugs/metis-ai/master/install.sh)"
set -Eeuo pipefail

REPO_URL="${METIS_AI_REPO_URL:-https://github.com/f1shyondrugs/metis-ai.git}"
DEFAULT_DIR="${METIS_AI_INSTALL_DIR:-$HOME/metis-ai}"

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

can_prompt() {
  [[ -t 0 || -t 1 ]]
}

ask() {
  local prompt="$1" default="${2:-}" value
  if (( non_interactive )); then
    printf '%s' "$default"
    return 0
  fi
  can_prompt || die "Interactive installation needs a terminal. Use --non-interactive with --password."
  if [[ -t 0 ]]; then
    IFS= read -r -p "$prompt [$default]: " value
  else
    IFS= read -r -p "$prompt [$default]: " value < /dev/tty
  fi
  printf '%s' "${value:-$default}"
}

ask_secret() {
  local prompt="$1" value
  can_prompt || die "Interactive installation needs a terminal. Use --non-interactive with --password."
  if [[ -t 0 ]]; then
    IFS= read -r -s -p "$prompt" value
  else
    IFS= read -r -s -p "$prompt" value < /dev/tty
  fi
  printf '\n' >&2
  printf '%s' "$value"
}

confirm_install() {
  local name="$1" answer
  (( non_interactive )) && return 0
  can_prompt || die "Interactive installation needs a terminal. Use --non-interactive with --password."
  if [[ -t 0 ]]; then
    IFS= read -r -p "$name is missing or too old. Install/update it automatically? [Y/n] " answer
  else
    IFS= read -r -p "$name is missing or too old. Install/update it automatically? [Y/n] " answer < /dev/tty
  fi
  [[ -z "$answer" || "$answer" =~ ^([Yy][Ee][Ss]|[Yy])$ ]]
}

version_at_least_22() {
  command -v "$1" >/dev/null 2>&1 &&
    [[ "$("$1" -p 'process.versions.node.split(".")[0]')" -ge 22 ]]
}

write_env_line() {
  local key="$1" value="$2"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//\$/\\$}"
  printf '%s="%s"\n' "$key" "$value"
}

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  printf '%s' "$value"
}

json_str() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

wait_for_health() {
  local url="$1" attempt
  for attempt in $(seq 1 30); do
    if curl --fail --silent --max-time 2 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
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
  --dry-run               Collect configuration and print the plan, then exit
  -h, --help              Show this help
EOF
}

non_interactive=0
dry_run=0
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
    --dry-run) dry_run=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "Unknown option: $1 (use --help for usage)" ;;
  esac
done

install_dir="${install_dir/#\~/$HOME}"
agent_cwd="${agent_cwd/#\~/$HOME}"
data_dir="${data_dir/#\~/$HOME}"

if [[ -n "$password_file" ]]; then
  [[ -r "$password_file" ]] || die "--password-file is not readable: $password_file"
  IFS= read -r password < "$password_file" || true
fi

default_public_host() {
  local host
  host="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  printf '%s' "${host:-127.0.0.1}"
}

if (( non_interactive )); then
  [[ -n "$password" ]] || die "--password is required with --non-interactive."
  ai_chat_host="${ai_chat_host:-127.0.0.1}"
  data_dir="${data_dir:-$install_dir/data}"
else
  can_prompt || die "Interactive installation needs a terminal. Use --non-interactive with --password."
  install_dir="$(ask "Installation directory" "$install_dir")"
  install_dir="${install_dir/#\~/$HOME}"
  data_dir="$(ask "Data directory" "${data_dir:-$install_dir/data}")"
  data_dir="${data_dir/#\~/$HOME}"
  agent_cwd="$(ask "Agent workspace directory" "$agent_cwd")"
  agent_cwd="${agent_cwd/#\~/$HOME}"
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
  password="$(ask_secret "Initial password: ")"
  password_confirm="$(ask_secret "Confirm password: ")"
  [[ "$password" == "$password_confirm" ]] || die "Passwords do not match."
  service_name="$(ask "Service name" "$service_name")"
  public_url="$(ask "Public URL" "${public_url:-http://${public_host}:${port}}")"
fi

data_dir="${data_dir:-$install_dir/data}"
if [[ "$ai_chat_host" == "0.0.0.0" ]]; then
  public_host="$(default_public_host)"
else
  public_host="127.0.0.1"
fi
public_url="${public_url:-http://${public_host}:${port}}"

[[ ${#password} -ge 8 ]] || die "Password must contain at least 8 characters."
[[ "$port" =~ ^[0-9]+$ && "$port" -ge 1 && "$port" -le 65535 ]] || die "Web port must be a number between 1 and 65535."
[[ "$mcp_port" =~ ^[0-9]+$ && "$mcp_port" -ge 1 && "$mcp_port" -le 65535 ]] || die "MCP port must be a number between 1 and 65535."
[[ "$service_name" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]] || die "Service name may contain letters, numbers, underscores and hyphens."
[[ "$username" =~ ^[A-Za-z0-9_.-]{3,64}$ ]] || die "Username must be 3-64 characters: letters, numbers, underscore, dot or hyphen."

if (( dry_run )); then
  cat <<EOF
Dry run; no files or services will be changed.
  os:            macos
  install dir:   $install_dir
  data dir:      $data_dir
  agent cwd:     $agent_cwd
  bind:          $ai_chat_host:$port
  mcp port:      $mcp_port
  service name:  $service_name
  public url:    $public_url
  username:      $username
EOF
  exit 0
fi

install_homebrew() {
  command -v brew >/dev/null 2>&1 && return 0
  confirm_install "Homebrew" || die "Homebrew is required."
  command -v curl >/dev/null 2>&1 || die "curl is required to install Homebrew automatically."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  command -v brew >/dev/null 2>&1 || die "Homebrew installation completed but brew is not available."
}

install_homebrew
command -v git >/dev/null 2>&1 || { confirm_install "git" && brew install git || die "git is required."; }
if ! version_at_least_22 node; then
  confirm_install "Node.js 22 or newer" || die "Node.js 22 or newer is required."
  if command -v node >/dev/null 2>&1; then brew upgrade node || true; else brew install node; fi
fi
version_at_least_22 node || die "Node.js 22 or newer is required after installation."
command -v pnpm >/dev/null 2>&1 || { confirm_install "pnpm" && brew install pnpm || die "pnpm is required."; }

if [[ -e "$install_dir/.git" ]]; then
  git -C "$install_dir" pull --ff-only
elif [[ -e "$install_dir" && -n "$(ls -A "$install_dir" 2>/dev/null)" ]]; then
  die "Installation directory exists and is not an existing Metis AI checkout."
else
  mkdir -p "$(dirname "$install_dir")"
  git clone "$REPO_URL" "$install_dir"
fi

node_bin="$(command -v node)"
node_home="$(dirname "$(dirname "$node_bin")")"
chat_password="$(openssl rand -hex 32)"
secrets_key="$(openssl rand -hex 32)"
mcp_token="$(openssl rand -hex 32)"

mkdir -p "$data_dir" "$agent_cwd"
{
  write_env_line APP_NAME "Metis AI"
  write_env_line PORT "$port"
  write_env_line AI_CHAT_HOST "$ai_chat_host"
  write_env_line CHAT_USERNAME "$username"
  write_env_line CHAT_PASSWORD "$chat_password"
  write_env_line CHAT_DATA_DIR "$data_dir"
  write_env_line AGENT_CWD "$agent_cwd"
  write_env_line AI_CHAT_ROOT "$install_dir"
  write_env_line AI_CHAT_INSTALL_DIR "$install_dir"
  write_env_line AI_CHAT_PUBLIC_URL "$public_url"
  write_env_line AI_CHAT_SERVICE_NAME "$service_name"
  write_env_line AI_CHAT_MCP_STATE_DIR "$data_dir/mcp-state"
  write_env_line AI_CHAT_SECRETS_KEY "$secrets_key"
  write_env_line MCP_PORT "$mcp_port"
  write_env_line MCP_PUBLIC_URL "http://127.0.0.1:$mcp_port"
  write_env_line AI_CHAT_INTERNAL_URL "http://127.0.0.1:$port/api/internal/mcp-question"
  write_env_line MCP_BEARER_TOKEN "$mcp_token"
  printf 'MCP_ALLOW_REMOTE_ADMIN=false\n'
  printf 'MCP_ENABLE_REMOTE_SERVERS=false\n'
  printf 'MCP_ENABLE_OPTIONAL_SERVERS=false\n'
  write_env_line METIS_NODE_BIN "$node_bin"
  write_env_line METIS_NODE_HOME "$node_home"
} > "$install_dir/.env"
chmod 600 "$install_dir/.env"

cat > "$install_dir/run-service.sh" <<'EOF'
#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
set -a
# shellcheck disable=SC1091
. "$ROOT/.env"
set +a
export PATH="${METIS_NODE_HOME:+$METIS_NODE_HOME/bin:}$ROOT/node_modules/.bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin${PATH:+:$PATH}"
cd "$ROOT"
exec "${METIS_NODE_BIN:?METIS_NODE_BIN is missing from .env}" "$@"
EOF
chmod 700 "$install_dir/run-service.sh"

(
  unset NODE_ENV
  set -a
  # shellcheck disable=SC1091
  . "$install_dir/.env"
  set +a
  cd "$install_dir"
  pnpm install --frozen-lockfile
  METIS_AI_BOOTSTRAP_USERNAME="$username" METIS_AI_BOOTSTRAP_PASSWORD="$password" METIS_AI_BOOTSTRAP_OPTIONAL=1 \
    pnpm exec tsx scripts/bootstrap-user.ts
  pnpm build
)

launch_dir="$HOME/Library/LaunchAgents"
mkdir -p "$launch_dir"
write_plist() {
  local suffix label
  suffix="$1"
  shift
  label="${service_name}-${suffix}"
  {
    printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>'
    printf '%s\n' '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
    printf '%s\n' '<plist version="1.0"><dict>'
    printf '  <key>Label</key><string>%s</string>\n' "$(xml_escape "$label")"
    printf '  <key>ProgramArguments</key><array>\n'
    printf '    <string>%s</string>\n' "$(xml_escape "$install_dir/run-service.sh")"
    local arg
    for arg in "$@"; do
      printf '    <string>%s</string>\n' "$(xml_escape "$arg")"
    done
    printf '  </array>\n'
    printf '  <key>WorkingDirectory</key><string>%s</string>\n' "$(xml_escape "$install_dir")"
    printf '  <key>EnvironmentVariables</key><dict>\n'
    printf '    <key>HOME</key><string>%s</string>\n' "$(xml_escape "$HOME")"
    printf '    <key>PATH</key><string>%s</string>\n' "$(xml_escape "$node_home/bin:$install_dir/node_modules/.bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")"
    printf '  </dict>\n'
    printf '  <key>RunAtLoad</key><true/>\n'
    printf '  <key>KeepAlive</key><true/>\n'
    printf '  <key>StandardOutPath</key><string>%s</string>\n' "$(xml_escape "$data_dir/$label.log")"
    printf '  <key>StandardErrorPath</key><string>%s</string>\n' "$(xml_escape "$data_dir/$label.error.log")"
    printf '%s\n' '</dict></plist>'
  } > "$launch_dir/$label.plist"
  launchctl bootout "gui/$(id -u)" "$launch_dir/$label.plist" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$launch_dir/$label.plist"
}
write_plist app "$install_dir/node_modules/tsx/dist/cli.mjs" "$install_dir/server.mjs"
write_plist worker "$install_dir/node_modules/tsx/dist/cli.mjs" "$install_dir/worker.ts"
write_plist mcp "$install_dir/lib/mcp-core/gateway-core.mjs"
wait_for_health "http://127.0.0.1:$port/api/status" ||
  die "The application did not become healthy. Check launchctl and the service logs."

{
  printf '{'
  printf '"installDir":%s,' "$(json_str "$install_dir")"
  printf '"dataDir":%s,' "$(json_str "$data_dir")"
  printf '"agentCwd":%s,' "$(json_str "$agent_cwd")"
  printf '"serviceName":%s,' "$(json_str "$service_name")"
  printf '"host":%s,' "$(json_str "$ai_chat_host")"
  printf '"os":"macos",'
  printf '"createdAt":%s' "$(json_str "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
  printf '}\n'
} > "$install_dir/.metis-ai-install.json"
chmod 600 "$install_dir/.metis-ai-install.json"
cp "$install_dir/install/uninstall-macos.sh" "$install_dir/uninstall-macos.sh"
chmod 700 "$install_dir/uninstall-macos.sh"
if [[ "$ai_chat_host" == "0.0.0.0" ]]; then
  printf 'Warning: the web application is reachable on the local network. Use strong credentials and a firewall or trusted TLS reverse proxy.\n'
fi
printf '\nMetis AI installed successfully.\nOpen: %s\nUninstall: %s --install-dir %q --keep-data\n' \
  "$public_url" "$install_dir/uninstall-macos.sh" "$install_dir"
