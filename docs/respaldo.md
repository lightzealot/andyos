# Respaldo y restauración

## Qué se respalda y cómo
Toda la información vive en **un archivo SQLite** (`/data/andyos.db`, volumen de Easypanel). Cada día a las 03:00 un workflow de n8n (`AndyOS - Respaldo diario`):

1. Llama a `GET https://api.andresgomez.store/webhooks/backup` con la cabecera `X-Webhook-Secret` (secreto propio `BACKUP_WEBHOOK_SECRET`, distinto del del Inbox).
2. La API genera una **copia consistente** con la API de respaldo de SQLite (válida aunque haya escrituras), comprueba `quick_check`, la comprime en gzip y la envía. Sin `BACKUP_WEBHOOK_SECRET` el endpoint no existe.
3. n8n sube `andyos-AAAA-MM-DD.db.gz` a Google Drive (fuera del servidor).
4. Si falla la descarga o la subida, n8n avisa por Telegram.

La cookie de sesión **no** sirve para este endpoint, y el secreto del Inbox tampoco (hay tests).

## Retención
No se borra nada automáticamente (cada archivo pesa muy poco). Revisa y poda la carpeta de Drive a mano una vez al año o cuando el tamaño moleste.

## Restaurar (probado en test con una copia real)
1. Descarga el `.db.gz` más reciente (o el que quieras) de Drive.
2. Descomprime: `gunzip andyos-2026-09-29.db.gz` → `andyos-2026-09-29.db`.
3. Comprueba: `sqlite3 andyos-2026-09-29.db "PRAGMA integrity_check; SELECT COUNT(*) FROM work_items;"` (debe decir `ok` y un número razonable). La copia conserva el modo WAL: ábrela con acceso normal, **no** en solo lectura (`mode=ro`), porque así no abre. El recuento incluye las filas archivadas (el archivado es lógico).
4. En Easypanel: **para** el servicio `andyos-api`.
5. Sustituye el archivo del volumen `/data`: copia el `.db` como `/data/andyos.db` y **borra** `/data/andyos.db-wal` y `/data/andyos.db-shm` si existen (son de la base vieja). Se puede hacer desde la consola del servicio o montando el volumen en un contenedor temporal.
6. Arranca el servicio y comprueba `https://api.andresgomez.store/health` y que el login muestra tus tarjetas.

## Comprobación periódica
Una vez al mes: baja el último respaldo y ejecuta el paso 3. Un respaldo que nunca se ha abierto no es un respaldo.

## Limitaciones
- La base se respalda cada 24 h: en el peor caso se pierde un día de cambios.
- Depende de que n8n y Drive estén disponibles; el aviso de Telegram solo salta si el workflow llega a ejecutarse (si n8n está caído no avisa).
