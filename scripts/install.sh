#!/usr/bin/env bash
set -Eeuo pipefail

VERSION="1"
REPOSITORY="${METIS_AI_REPOSITORY:-f1shyondrugs/metis-ai}"
BRANCH="${METIS_AI_BRANCH:-master}"
INSTALL_DIR="${METIS_AI_INSTALL_DIR:-${HOME}/.local/share/metis-ai}"
DATA_DIR=""
AGENT_CWD=""
APP_NAME="${METIS_AI_APP_NAME:-Metis AI}"
CHAT_USERNAME="${METIS_AI_CHAT_USERNAME:-admin}"
CHAT_PASSWORD="${METIS_AI_CHAT_PASSWORD:-}"
MCP_TOKEN="${METIS_AI_MCP_TOKEN:-}"
CURSOR_API_KEY="${CURSOR_API_KEY:-}"
SOURCE="${METIS_AI_SOURCE:-github}"
PORT="${METIS_AI_PORT:-3100}"
MCP_PORT="${METIS_AI_MCP_PORT:-8787}"
PUBLIC_URL="${METIS_AI_PUBLIC_URL:-}"
SERVICE_NAME="${METIS_AI_SERVICE_NAME:-metis-ai-worker}"
NON_INTERACTIVE=false
YES=false
DRY_RUN=false
JSON_OUTPUT=false
SKIP_BUILD=false
ENABLE_SERVICE=false
START_APP=false
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
TMP_DIR=""

cleanup() {
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then rm -rf "$TMP_DIR"; fi
}
trap cleanup EXIT

usage() {
  cat <<'EOF'
Metis AI native installer

Usage:
  install.sh [options]

Options:
  --help                       Show this help.
  --non-interactive            Never prompt; all required values must be supplied.
  --yes                        Confirm overwrite and setup decisions.
  --dry-run                    Validate and print the planned actions without changing files.
  --json                       Emit machine-readable result output.
  --install-dir PATH           Absolute application directory.
  --data-dir PATH              Absolute data directory (default: INSTALL_DIR/data).
  --agent-cwd PATH             Absolute agent workspace (default: INSTALL_DIR).
  --source github|URL|DIR      Source repository, archive URL, or local directory.
  --version BRANCH             Git branch or release selector (default: master).
  --app-name NAME              Application name.
  --chat-username NAME         Initial chat username.
  --chat-password VALUE        Chat password; prefer METIS_AI_CHAT_PASSWORD.
  --cursor-api-key VALUE       Cursor API key; prefer CURSOR_API_KEY.
  --mcp-token VALUE             MCP bearer token; prefer METIS_AI_MCP_TOKEN.
  --port NUMBER                Web port (default: 3100).
  --mcp-port NUMBER            MCP port (default: 8787).
  --public-url URL             Public MCP URL.
  --service-name NAME          systemd service name.
  --enable-service             Install and enable the worker service.
  --start                      Start the web app after installation.
  --skip-build                 Do not run the production build.

Examples:
  ./install.sh
  ./install.sh --non-interactive --yes --install-dir /opt/metis-ai --enable-service
  ./install.sh --non-interactive --source github --chat-password "$CHAT_PASSWORD"
  ./install.sh --dry-run --json --install-dir "$HOME/.local/share/metis-ai"
EOF
}

error() {
  printf 'Error: %s\n' "$*" >&2
  exit 2
}

info() { printf '%s\n' "$*"; }

run_step() {
  if [[ "$JSON_OUTPUT" == true ]]; then
    local log_file
    log_file="$(mktemp)"
    if ! "$@" >"$log_file" 2>&1; then
      cat "$log_file" >&2
      rm -f "$log_file"
      return 1
    fi
    rm -f "$log_file"
  else
    "$@"
  fi
}

arg_value() {
  local name="$1" value
  if [[ "$2" == "$name="* ]]; then
    printf '%s' "${2#*=}"
    return 0
  fi
  value="${3:-}"
  [[ -n "$value" && "$value" != --* ]] || error "$name requires a value"
  printf '%s' "$value"
}

is_true() {
  case "${1,,}" in
    1|true|yes|on) return 0 ;;
    0|false|no|off|"") return 1 ;;
    *) error "invalid boolean value: $1" ;;
  esac
}

parse_args() {
  while (($#)); do
    case "$1" in
      --help|-h) usage; exit 0 ;;
      --non-interactive) NON_INTERACTIVE=true ;;
      --yes|-y) YES=true ;;
      --dry-run) DRY_RUN=true ;;
      --json) JSON_OUTPUT=true ;;
      --skip-build) SKIP_BUILD=true ;;
      --enable-service) ENABLE_SERVICE=true ;;
      --start) START_APP=true ;;
      --install-dir|--install-dir=*) INSTALL_DIR="$(arg_value --install-dir "$1" "${2:-}")"; [[ "$1" == *=* ]] || shift ;;
      --data-dir|--data-dir=*) DATA_DIR="$(arg_value --data-dir "$1" "${2:-}")"; [[ "$1" == *=* ]] || shift ;;
      --agent-cwd|--agent-cwd=*) AGENT_CWD="$(arg_value --agent-cwd "$1" "${2:-}")"; [[ "$1" == *=* ]] || shift ;;
      --source|--source=*) SOURCE="$(arg_value --source "$1" "${2:-}")"; [[ "$1" == *=* ]] || shift ;;
      --version|--version=*) BRANCH="$(arg_value --version "$1" "${2:-}")"; [[ "$1" == *=* ]] || shift ;;
      --app-name|--app-name=*) APP_NAME="$(arg_value --app-name "$1" "${2:-}")"; [[ "$1" == *=* ]] || shift ;;
      --chat-username|--chat-username=*) CHAT_USERNAME="$(arg_value --chat-username "$1" "${2:-}")"; [[ "$1" == *=* ]] || shift ;;
      --chat-password|--chat-password=*) CHAT_PASSWORD="$(arg_value --chat-password "$1" "${2:-}")"; [[ "$1" == *=* ]] || shift ;;
      --cursor-api-key|--cursor-api-key=*) CURSOR_API_KEY="$(arg_value --cursor-api-key "$1" "${2:-}")"; [[ "$1" == *=* ]] || shift ;;
      --mcp-token|--mcp-token=*) MCP_TOKEN="$(arg_value --mcp-token "$1" "${2:-}")"; [[ "$1" == *=* ]] || shift ;;
      --port|--port=*) PORT="$(arg_value --port "$1" "${2:-}")"; [[ "$1" == *=* ]] || shift ;;
      --mcp-port|--mcp-port=*) MCP_PORT="$(arg_value --mcp-port "$1" "${2:-}")"; [[ "$1" == *=* ]] || shift ;;
      --public-url|--public-url=*) PUBLIC_URL="$(arg_value --public-url "$1" "${2:-}")"; [[ "$1" == *=* ]] || shift ;;
      --service-name|--service-name=*) SERVICE_NAME="$(arg_value --service-name "$1" "${2:-}")"; [[ "$1" == *=* ]] || shift ;;
      *) error "unknown option: $1 (use --help)" ;;
    esac
    shift
  done
}

read_tty() {
  local prompt="$1" default="${2:-}" value
  if [[ -n "$default" ]]; then
    read -r -p "$prompt [$default]: " value < /dev/tty || true
    printf '%s' "${value:-$default}"
  else
    read -r -p "$prompt: " value < /dev/tty || true
    printf '%s' "$value"
  fi
}

read_secret_tty() {
  local prompt="$1" value
  read -r -s -p "$prompt: " value < /dev/tty || true
  printf '\n' > /dev/tty
  printf '%s' "$value"
}

choose() {
  local prompt="$1" selected=0 key option
  shift
  local options=("$@")
  while true; do
    printf '\033[2J\033[H' > /dev/tty
    printf '%s\n\n' "$prompt" > /dev/tty
    for option_index in "${!options[@]}"; do
      if ((option_index == selected)); then printf '  > %s\n' "${options[$option_index]}" > /dev/tty
      else printf '    %s\n' "${options[$option_index]}" > /dev/tty
      fi
    done
    IFS= read -rsn1 key < /dev/tty || true
    if [[ "$key" == $'\x1b' ]]; then
      IFS= read -rsn2 key < /dev/tty || true
      case "$key" in
        "[A") ((selected = (selected - 1 + ${#options[@]}) % ${#options[@]})) ;;
        "[B") ((selected = (selected + 1) % ${#options[@]})) ;;
      esac
    elif [[ "$key" == "" ]]; then
      printf '%s' "${options[$selected]}"
      return 0
    fi
  done
}

interactive_setup() {
  [[ "$NON_INTERACTIVE" == true ]] && return
  [[ -t 0 || -e /dev/tty ]] || error "stdin is not a TTY; use --non-interactive with explicit arguments"
  local service_choice
  INSTALL_DIR="$(read_tty "Install directory" "$INSTALL_DIR")"
  DATA_DIR="$(read_tty "Data directory" "${DATA_DIR:-$INSTALL_DIR/data}")"
  AGENT_CWD="$(read_tty "Agent workspace" "${AGENT_CWD:-$INSTALL_DIR/workspace}")"
  PORT="$(read_tty "Web port" "$PORT")"
  MCP_PORT="$(read_tty "MCP port" "$MCP_PORT")"
  APP_NAME="$(read_tty "Application name" "$APP_NAME")"
  CHAT_USERNAME="$(read_tty "Chat username" "$CHAT_USERNAME")"
  if [[ -z "$CHAT_PASSWORD" ]]; then CHAT_PASSWORD="$(read_secret_tty "Chat password (empty generates one)")"; fi
  if [[ "$(uname -s)" != "Darwin" ]]; then
    service_choice="$(choose "Worker service setup" "No service" "Install systemd service")"
    [[ "$service_choice" == "Install systemd service" ]] && ENABLE_SERVICE=true
  else
    info "macOS detected: systemd service setup is not available; continuing without a worker service."
  fi
  if [[ -z "$SOURCE" || "$SOURCE" == "github" ]]; then
    SOURCE="$(read_tty "Source (github, archive URL, or local directory)" "${SOURCE:-github}")"
  fi
}

validate() {
  [[ "$INSTALL_DIR" = /* ]] || error "--install-dir must be an absolute path"
  [[ -z "$DATA_DIR" || "$DATA_DIR" = /* ]] || error "--data-dir must be an absolute path"
  [[ -z "$AGENT_CWD" || "$AGENT_CWD" = /* ]] || error "--agent-cwd must be an absolute path"
  [[ "$PORT" =~ ^[0-9]+$ && "$PORT" -ge 1 && "$PORT" -le 65535 ]] || error "--port must be between 1 and 65535"
  [[ "$MCP_PORT" =~ ^[0-9]+$ && "$MCP_PORT" -ge 1 && "$MCP_PORT" -le 65535 ]] || error "--mcp-port must be between 1 and 65535"
  [[ "$SERVICE_NAME" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{1,63}$ ]] || error "invalid --service-name"
  DATA_DIR="${DATA_DIR:-$INSTALL_DIR/data}"
  AGENT_CWD="${AGENT_CWD:-$INSTALL_DIR}"
}

confirm_existing() {
  [[ ! -e "$INSTALL_DIR" || -z "$(find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]] && return
  [[ "$YES" == true ]] && return
  [[ "$NON_INTERACTIVE" == true ]] && error "$INSTALL_DIR is not empty; pass --yes to allow an update"
  local answer
  answer="$(read_tty "$INSTALL_DIR is not empty. Continue and overlay files? (y/N)" "N")"
  [[ "${answer,,}" == "y" || "${answer,,}" == "yes" ]] || error "installation cancelled"
}

ensure_node() {
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    local major
    major="$(node -p 'process.versions.node.split(".")[0]')"
    [[ "$major" -ge 20 ]] || error "Node.js 20 or newer is required (found $major)"
    return
  fi
  if [[ "$NON_INTERACTIVE" == true ]]; then
    error "Node.js 20+ and npm are required; install them before retrying"
  fi
  info "Node.js 20+ and npm are required. Install them with your OS package manager, then rerun this installer."
  if [[ "$(uname -s)" == "Darwin" ]]; then info "macOS example: brew install node"; else info "Linux example: sudo apt-get update && sudo apt-get install -y nodejs npm"; fi
  error "missing Node.js/npm"
}

download_source() {
  TMP_DIR="$(mktemp -d)"
  local source_dir="$TMP_DIR/source" archive="$TMP_DIR/source.tar.gz"
  mkdir -p "$source_dir"
  case "$SOURCE" in
    github)
      if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
        gh repo clone "$REPOSITORY" "$source_dir" -- --branch "$BRANCH" --depth 1 >/dev/null
      else
        [[ -n "$GITHUB_TOKEN" ]] || {
          [[ "$NON_INTERACTIVE" == true ]] && error "private GitHub source requires GITHUB_TOKEN or authenticated gh";
          GITHUB_TOKEN="$(read_secret_tty "GitHub token for $REPOSITORY (read-only)")"
        }
        [[ -n "$GITHUB_TOKEN" ]] || error "GitHub token is required"
        curl -fsSL -H "Authorization: Bearer $GITHUB_TOKEN" "https://github.com/$REPOSITORY/archive/refs/heads/$BRANCH.tar.gz" -o "$archive"
        tar -xzf "$archive" -C "$TMP_DIR"
        local extracted
        extracted="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d -name '*-*' -print -quit)"
        [[ -n "$extracted" ]] || error "GitHub archive did not contain a source directory"
        cp -a "$extracted"/. "$source_dir"/
      fi
      ;;
    http://*|https://*)
      curl -fsSL "$SOURCE" -o "$archive"
      case "$SOURCE" in
        *.zip) unzip -q "$archive" -d "$TMP_DIR";;
        *) tar -xzf "$archive" -C "$TMP_DIR";;
      esac
      local extracted
      extracted="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d ! -name source -print -quit)"
      [[ -n "$extracted" ]] || error "archive did not contain a source directory"
      cp -a "$extracted"/. "$source_dir"/
      ;;
    *)
      [[ -d "$SOURCE" ]] || error "--source must be github, an archive URL, or an existing directory"
      cp -a "$SOURCE"/. "$source_dir"/
      ;;
  esac
  [[ -f "$source_dir/package.json" ]] || error "source does not contain package.json"
  mkdir -p "$INSTALL_DIR"
  cp -a "$source_dir"/. "$INSTALL_DIR"/
}

write_env() {
  local chat_password="$CHAT_PASSWORD" mcp_token="$MCP_TOKEN"
  if [[ -z "$chat_password" ]]; then chat_password="$(openssl rand -hex 24 2>/dev/null || node scripts/install-common.mjs random-secret)"; fi
  if [[ -z "$mcp_token" ]]; then mcp_token="$(openssl rand -hex 32 2>/dev/null || node scripts/install-common.mjs random-secret)"; fi
  if [[ -f "$INSTALL_DIR/.env" && "$YES" != true ]]; then
    [[ "$NON_INTERACTIVE" == true ]] && return
    info "Keeping existing $INSTALL_DIR/.env"
    return
  fi
  umask 077
  cat > "$INSTALL_DIR/.env" <<EOF
APP_NAME=$APP_NAME
APP_DESCRIPTION=A private, configurable AI agent workspace.
PORT=$PORT
CHAT_USERNAME=$CHAT_USERNAME
CHAT_PASSWORD=$chat_password
CHAT_DATA_DIR=$DATA_DIR
AGENT_CWD=$AGENT_CWD
AI_CHAT_ROOT=$INSTALL_DIR
AI_CHAT_MCP_STATE_DIR=$DATA_DIR/mcp-state
AI_CHAT_INTERNAL_URL=http://127.0.0.1:$PORT/api/internal/mcp-question
MCP_PORT=$MCP_PORT
MCP_PUBLIC_URL=${PUBLIC_URL:-http://127.0.0.1:$MCP_PORT}
MCP_BEARER_TOKEN=$mcp_token
MCP_ALLOW_REMOTE_ADMIN=false
MCP_ENABLE_REMOTE_SERVERS=false
MCP_ENABLE_OPTIONAL_SERVERS=false
${CURSOR_API_KEY:+CURSOR_API_KEY=$CURSOR_API_KEY}
EOF
  info "Wrote $INSTALL_DIR/.env"
}

install_dependencies() {
  cd "$INSTALL_DIR"
  if [[ -f pnpm-lock.yaml ]] && command -v corepack >/dev/null 2>&1; then
    run_step corepack pnpm install --frozen-lockfile
    $SKIP_BUILD || run_step corepack pnpm run build
  else
    run_step npm install
    $SKIP_BUILD || run_step npm run build
  fi
}

install_service() {
  [[ "$ENABLE_SERVICE" == true ]] || return
  [[ "$INSTALL_DIR" != *[[:space:]]* ]] || error "--install-dir cannot contain spaces when --enable-service is used"
  command -v systemctl >/dev/null 2>&1 || error "--enable-service requires systemd"
  command -v sudo >/dev/null 2>&1 || error "--enable-service requires sudo"
  local service_file
  service_file="$(mktemp)"
  sed \
    -e "s|__METIS_USER__|$USER|g" \
    -e "s|__METIS_DIR__|$INSTALL_DIR|g" \
    -e "s|__METIS_ENV__|$INSTALL_DIR/.env|g" \
    -e "s|__METIS_SERVICE__|$SERVICE_NAME|g" \
    "$INSTALL_DIR/deploy/metis-ai-worker.service" > "$service_file"
  if [[ "$DRY_RUN" == true ]]; then
    cat "$service_file"
    rm -f "$service_file"
    return
  fi
  sudo install -m 0644 "$service_file" "/etc/systemd/system/$SERVICE_NAME.service"
  rm -f "$service_file"
  sudo systemctl daemon-reload
  sudo systemctl enable --now "$SERVICE_NAME.service"
}

emit_result() {
  local status="$1"
  if [[ "$JSON_OUTPUT" == true ]]; then
    printf '{"status":"%s","installDir":"%s","dataDir":"%s","port":%s,"mcpPort":%s,"service":"%s"}\n' \
      "$status" "$INSTALL_DIR" "$DATA_DIR" "$PORT" "$MCP_PORT" "$SERVICE_NAME"
  else
    info "status: $status"
    info "install_dir: $INSTALL_DIR"
    info "data_dir: $DATA_DIR"
    info "web_url: http://127.0.0.1:$PORT"
    info "mcp_url: ${PUBLIC_URL:-http://127.0.0.1:$MCP_PORT}"
    info "service: $SERVICE_NAME"
    info "Start the web app with: cd \"$INSTALL_DIR\" && npm run start"
  fi
}

main() {
  parse_args "$@"
  interactive_setup
  validate
  ensure_node
  confirm_existing
  if [[ "$DRY_RUN" == true ]]; then
    emit_result dry-run
    return
  fi
  download_source
  write_env
  install_dependencies
  install_service
  emit_result installed
  if [[ "$START_APP" == true ]]; then
    cd "$INSTALL_DIR"
    exec npm run start
  fi
}

main "$@"
