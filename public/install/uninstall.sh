#!/usr/bin/env bash
set -Eeuo pipefail

KEEP_DATA=false
DRY_RUN=false
YES=false
INSTALL_DIR="${METIS_AI_INSTALL_DIR:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    --keep-data) KEEP_DATA=true; shift ;;
    --remove-data) KEEP_DATA=false; shift ;;
    --dry-run) DRY_RUN=true; shift ;;
    --yes) YES=true; shift ;;
    -h|--help) echo "Usage: uninstall.sh --install-dir DIR [--keep-data|--remove-data] [--dry-run] [--yes]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$INSTALL_DIR" ]] || { echo "--install-dir is required." >&2; exit 2; }
INSTALL_DIR="${INSTALL_DIR/#\~/$HOME}"
MANIFEST="$INSTALL_DIR/.metis-ai-install.json"
[[ -f "$MANIFEST" ]] || { echo "Install manifest not found: $MANIFEST" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 is required to read the install manifest." >&2; exit 1; }
IFS=$'\t' read -r SERVICE DATA_DIR < <(python3 - "$MANIFEST" <<'PY'
import json, sys
data=json.load(open(sys.argv[1]))
print(data.get("serviceName", "metis-ai"), data.get("dataDir", ""), sep="\t")
PY
)
[[ "$INSTALL_DIR" != "/" && "$INSTALL_DIR" != "$HOME" ]] || { echo "Refusing to remove unsafe install directory." >&2; exit 1; }
if [[ "$YES" != true ]]; then
  printf 'Remove Metis AI installation at %s? ' "$INSTALL_DIR"
  read -r answer
  [[ "$answer" == "yes" ]] || { echo "Aborted."; exit 0; }
fi
run() { if [[ "$DRY_RUN" == true ]]; then printf '+ %s\n' "$*"; else "$@"; fi; }
if command -v systemctl >/dev/null 2>&1; then
  for unit in "$SERVICE.service" "$SERVICE-worker.service" "$SERVICE-mcp.service"; do
    run sudo systemctl disable --now "$unit" >/dev/null 2>&1 || true
    run sudo rm -f "/etc/systemd/system/$unit"
  done
  run sudo systemctl daemon-reload
fi
if [[ "$KEEP_DATA" != true && -n "$DATA_DIR" && "$DATA_DIR" != "/" && "$DATA_DIR" != "$INSTALL_DIR" ]]; then
  run rm -rf -- "$DATA_DIR"
fi
if [[ "$KEEP_DATA" != true && "$DATA_DIR" == "$INSTALL_DIR" ]]; then
  echo "Refusing to remove data because it is inside the installation directory; use a separate data directory." >&2
  exit 1
fi
run rm -rf -- "$INSTALL_DIR"
echo "Metis AI uninstalled. Data kept: $KEEP_DATA"
