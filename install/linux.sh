#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="Metis AI"
REPO_URL="${METIS_AI_REPO_URL:-https://github.com/f1shyondrugs/metis-ai.git}"
NODE_VERSION="${METIS_NODE_VERSION:-22.16.0}"
DEFAULT_DIR="${METIS_AI_INSTALL_DIR:-$HOME/metis-ai}"

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
confirm_install() {
  local name="$1" answer
  read -r -p "$name is missing or too old. Install/update it automatically? [Y/n] " answer
  [[ -z "$answer" || "$answer" =~ ^([Yy][Ee][Ss]|[Yy])$ ]]
}
install_system_package() {
  local package="$1"
  if command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y "$package"
  elif command -v dnf >/dev/null 2>&1; then
    sudo dnf install -y "$package"
  elif command -v pacman >/dev/null 2>&1; then
    sudo pacman -Sy --noconfirm "$package"
  else
    return 1
  fi
}
ask() {
  local prompt="$1" default="${2:-}" value
  if [[ -n "$default" ]]; then
    read -r -p "$prompt [$default]: " value
    printf '%s' "${value:-$default}"
  else
    read -r -p "$prompt: " value
    printf '%s' "$value"
  fi
}
default_public_host() {
  local host
  host="$(hostname -I 2>/dev/null | awk '{print $1}')"
  printf '%s' "${host:-127.0.0.1}"
}
version_at_least_20() {
  command -v "$1" >/dev/null 2>&1 || return 1
  [[ "$( "$1" -p 'process.versions.node.split(".")[0]' )" -ge 20 ]]
}
install_node() {
  local dir="$1/.runtime" arch url archive
  if version_at_least_20 node; then
    printf '%s' "$(command -v node)"
    return
  fi
  confirm_install "Node.js 20 or newer" || die "Node.js 20 or newer is required."
  mkdir -p "$dir"
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    armv7l) arch=armv7l ;;
    *) die "Unsupported Linux architecture: $(uname -m)" ;;
  esac
  url="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${arch}.tar.xz"
  archive="$dir/node.tar.xz"
  if ! command -v curl >/dev/null 2>&1; then
    confirm_install "curl" && install_system_package curl ||
      die "curl is required to install Node.js automatically."
  fi
  curl -fsSL "$url" -o "$archive"
  tar -xJf "$archive" -C "$dir"
  mv "$dir/node-v${NODE_VERSION}-linux-${arch}" "$dir/node"
  rm -f "$archive"
  printf '%s' "$dir/node/bin/node"
}

if ! command -v git >/dev/null 2>&1; then
  confirm_install "git" && install_system_package git ||
    die "git is required."
fi
install_dir="$(ask "Installation directory" "$DEFAULT_DIR")"
install_dir="${install_dir/#\~/$HOME}"
if [[ -e "$install_dir/.git" ]]; then
  git -C "$install_dir" pull --ff-only
elif [[ -e "$install_dir" && -n "$(ls -A "$install_dir" 2>/dev/null)" ]]; then
  die "Installation directory exists and is not an existing Metis AI checkout: $install_dir"
else
  mkdir -p "$(dirname "$install_dir")"
  git clone "$REPO_URL" "$install_dir"
fi

node_bin="$(install_node "$install_dir")"
node_home="$(dirname "$(dirname "$node_bin")")"
export PATH="$node_home/bin:$install_dir/node_modules/.bin:$PATH"
command -v corepack >/dev/null 2>&1 && corepack enable >/dev/null 2>&1 || true
command -v pnpm >/dev/null 2>&1 || "$node_home/bin/npm" install --global pnpm@9

data_dir="$(ask "Data directory" "$install_dir/data")"
agent_cwd="$(ask "Agent workspace directory" "$HOME")"
port="$(ask "Web application port" "3100")"
host_mode="$(ask "Host web application on local network? (y/N)" "n")"
if [[ "$host_mode" =~ ^([Yy][Ee][Ss]|[Yy]|1|[Tt][Rr][Uu][Ee])$ ]]; then
  ai_chat_host="0.0.0.0"
  public_host="$(default_public_host)"
else
  ai_chat_host="127.0.0.1"
  public_host="127.0.0.1"
fi
mcp_port="$(ask "MCP gateway port" "8787")"
username="$(ask "Initial username" "admin")"
read -r -s -p "Initial password: " password; printf '\n'
[[ ${#password} -ge 8 ]] || die "Password must contain at least 8 characters."
read -r -s -p "Confirm password: " password_confirm; printf '\n'
[[ "$password" == "$password_confirm" ]] || die "Passwords do not match."
chat_password="$(openssl rand -hex 32 2>/dev/null || "$node_home/bin/node" -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
secrets_key="$(openssl rand -hex 32 2>/dev/null || "$node_home/bin/node" -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')"
service_name="$(ask "Service name" "metis-ai")"
public_url="$(ask "Public URL" "http://${public_host}:${port}")"

mkdir -p "$data_dir" "$agent_cwd"
cat > "$install_dir/.env" <<EOF
APP_NAME=Metis AI
PORT=$port
AI_CHAT_HOST=$ai_chat_host
CHAT_USERNAME=$username
CHAT_PASSWORD=$chat_password
CHAT_DATA_DIR=$data_dir
AGENT_CWD=$agent_cwd
AI_CHAT_ROOT=$install_dir
AI_CHAT_INSTALL_DIR=$install_dir
AI_CHAT_PUBLIC_URL=$public_url
AI_CHAT_SERVICE_NAME=$service_name
AI_CHAT_MCP_STATE_DIR=$data_dir/mcp-state
AI_CHAT_INTERNAL_URL=http://127.0.0.1:$port/api/internal/mcp-question
AI_CHAT_SECRETS_KEY=$secrets_key
MCP_PORT=$mcp_port
MCP_PUBLIC_URL=http://127.0.0.1:$mcp_port
MCP_BEARER_TOKEN=$(openssl rand -hex 32 2>/dev/null || "$node_home/bin/node" -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))')
MCP_ALLOW_REMOTE_ADMIN=false
MCP_ENABLE_REMOTE_SERVERS=false
MCP_ENABLE_OPTIONAL_SERVERS=false
EOF
chmod 600 "$install_dir/.env"

(
  set -a
  source "$install_dir/.env"
  set +a
  cd "$install_dir"
  pnpm install --frozen-lockfile
  METIS_AI_BOOTSTRAP_USERNAME="$username" METIS_AI_BOOTSTRAP_PASSWORD="$password" METIS_AI_BOOTSTRAP_OPTIONAL=1 \
    pnpm exec tsx scripts/bootstrap-user.ts
  pnpm build
)

if command -v systemctl >/dev/null 2>&1; then
  command -v sudo >/dev/null 2>&1 || die "sudo is required to install system services."
  service_dir="/etc/systemd/system"
  sudo tee "$service_dir/${service_name}.service" >/dev/null <<EOF
[Unit]
Description=Metis AI
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
Group=$(id -gn)
WorkingDirectory=$install_dir
EnvironmentFile=$install_dir/.env
Environment=HOME=$HOME
Environment=NODE_ENV=production
Environment=PATH=$node_home/bin:$install_dir/node_modules/.bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$node_bin $install_dir/node_modules/tsx/dist/cli.mjs $install_dir/server.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  sudo tee "$service_dir/${service_name}-worker.service" >/dev/null <<EOF
[Unit]
Description=Metis AI worker
After=network-online.target

[Service]
Type=simple
User=$USER
Group=$(id -gn)
WorkingDirectory=$install_dir
EnvironmentFile=$install_dir/.env
Environment=HOME=$HOME
Environment=NODE_ENV=production
Environment=PATH=$node_home/bin:$install_dir/node_modules/.bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$node_bin $install_dir/node_modules/tsx/dist/cli.mjs $install_dir/worker.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  sudo tee "$service_dir/${service_name}-mcp.service" >/dev/null <<EOF
[Unit]
Description=Metis AI MCP gateway
After=network-online.target

[Service]
Type=simple
User=$USER
Group=$(id -gn)
WorkingDirectory=$install_dir
EnvironmentFile=$install_dir/.env
Environment=HOME=$HOME
Environment=NODE_ENV=production
Environment=PATH=$node_home/bin:$install_dir/node_modules/.bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$node_bin $install_dir/lib/mcp-core/gateway-core.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  sudo systemctl daemon-reload
  sudo systemctl enable --now "${service_name}.service" "${service_name}-worker.service" "${service_name}-mcp.service"
fi
if command -v curl >/dev/null 2>&1; then
  curl --fail --silent --show-error --retry 20 --retry-delay 1 "http://127.0.0.1:$port/api/status" >/dev/null ||
    die "The application did not become healthy. Check systemctl status ${service_name}.service."
fi

cat > "$install_dir/.metis-ai-install.json" <<EOF
{"installDir":"$install_dir","dataDir":"$data_dir","agentCwd":"$agent_cwd","serviceName":"$service_name","host":"$ai_chat_host","os":"linux","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF
chmod 600 "$install_dir/.metis-ai-install.json"
cp "$install_dir/install/uninstall.sh" "$install_dir/uninstall.sh"
chmod 700 "$install_dir/uninstall.sh"
if [[ "$ai_chat_host" == "0.0.0.0" ]]; then
  printf 'Warning: the web application is reachable on the local network. Use strong credentials and a firewall or trusted TLS reverse proxy.\n'
fi
printf '\n%s installed successfully.\nOpen: %s\nUninstall: %s/install/uninstall.sh --install-dir %q --keep-data\n' "$APP_NAME" "$public_url" "$public_url" "$install_dir"
