#!/bin/sh
# Arranca como root solo para dejar el volumen de datos escribible y luego baja a `node`.
set -e
if [ "$(id -u)" = "0" ]; then
  DATA_DIR="$(dirname "${DB_PATH:-/data/andyos.db}")"
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
