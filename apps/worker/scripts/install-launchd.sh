#!/bin/sh
# Instala el worker como LaunchAgent del usuario (se inicia solo y se reinicia si cae).
# Uso: apps/worker/scripts/install-launchd.sh [--dry-run]
set -eu
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
HOME_DIR="${HOME}"
BASE="$HOME_DIR/.andyos-worker"
ENV_FILE="$BASE/worker.env"
PLIST="$HOME_DIR/Library/LaunchAgents/com.andyos.worker.plist"
NODE="$(command -v node)"; CLAUDE="$(command -v claude || true)"; CODEX="$(command -v codex || true)"
[ -n "$CLAUDE" ] || { echo "No encuentro el binario 'claude' en el PATH" >&2; exit 1; }

mkdir -p "$BASE/work" "$BASE/logs"; chmod 700 "$BASE" "$BASE/work" "$BASE/logs"
if [ ! -f "$ENV_FILE" ]; then
  umask 077
  cat > "$ENV_FILE" <<ENV
# Configuración del worker (permisos 600). No la subas a git.
API_URL=https://api.andresgomez.store
WORKER_TOKEN=PON_AQUI_EL_WORKER_TOKEN
CLAUDE_BIN=$CLAUDE
CODEX_BIN=${CODEX:-codex}
ENABLE_CODEX=false
WORK_DIR=$BASE/work
POLL_INTERVAL_S=15
ENV
  echo "Creado $ENV_FILE: edítalo y pon el WORKER_TOKEN real antes de continuar."
fi
chmod 600 "$ENV_FILE"

# PATH mínimo: el directorio de node y de claude, más los del sistema
PATH_VALUE="$(dirname "$NODE"):$(dirname "$CLAUDE"):/usr/local/bin:/usr/bin:/bin"
sed -e "s|@NODE@|$NODE|g" -e "s|@ENV_FILE@|$ENV_FILE|g" -e "s|@REPO@|$REPO|g" \
    -e "s|@PATH@|$PATH_VALUE|g" -e "s|@HOME@|$HOME_DIR|g" \
    "$REPO/apps/worker/launchd/com.andyos.worker.plist.template" > "${PLIST}.tmp"
plutil -lint "${PLIST}.tmp" >/dev/null

if [ "${1:-}" = "--dry-run" ]; then cat "${PLIST}.tmp"; rm -f "${PLIST}.tmp"; exit 0; fi
if grep -q PON_AQUI_EL_WORKER_TOKEN "$ENV_FILE"; then rm -f "${PLIST}.tmp"; echo "Falta el WORKER_TOKEN en $ENV_FILE" >&2; exit 1; fi

mv "${PLIST}.tmp" "$PLIST"
launchctl bootout "gui/$(id -u)/com.andyos.worker" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/com.andyos.worker"
echo "Worker instalado. Log: $BASE/logs/worker.log"
