#!/bin/sh
# Detiene y elimina el servicio. No borra ~/.andyos-worker (configuración y logs).
set -eu
PLIST="$HOME/Library/LaunchAgents/com.andyos.worker.plist"
launchctl bootout "gui/$(id -u)/com.andyos.worker" 2>/dev/null || true
rm -f "$PLIST"
echo "Servicio eliminado."
