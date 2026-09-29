# Workflows de n8n

Instancia: `https://n8n.andresgomez.store`. Importar: *Workflows → Import from file*.
**Estos JSON no incluyen secretos**: las credenciales se crean en n8n y se seleccionan tras importar.

## `inbox-telegram.json` — Captura de ideas por Telegram
`Telegram Trigger → Trae texto → Guardar en AndyOS → Guardada → responde en Telegram`

1. Habla con **@BotFather** → `/newbot` → guarda el token (no lo pegues en chats ni en el repo).
2. En n8n crea la credencial **Telegram API** («Telegram AndyOS») con ese token.
3. Averigua tu chat id (escribe al bot y mira la ejecución del trigger: `message.chat.id`) y ponlo en el nodo *Telegram Trigger → Additional Fields → Chat IDs*. **Sin esto, cualquiera que encuentre tu bot podría enviarte ideas.**
4. Genera el secreto: `openssl rand -hex 32`. Ponlo en el servicio de la API (Easypanel) como `INBOX_WEBHOOK_SECRET`.
5. En n8n crea la credencial **Header Auth** («AndyOS Inbox Secret»): *Name* `X-Webhook-Secret`, *Value* el mismo secreto.
6. Ajusta la URL del nodo *Guardar en AndyOS* si tu API no está en `https://api.andresgomez.net`.
7. Activa el workflow (el Telegram Trigger registra su webhook al activarse; n8n debe ser accesible por HTTPS público).

Comportamiento: guarda solo texto; un mensaje repetido (reintento) no duplica la idea (clave `chat_id:message_id`); el nodo HTTP reintenta 3 veces y, si falla, avisa por Telegram. **No publica ni envía nada fuera de tu chat.**

Estado de verificación: estructura y nombres de parámetros contrastados con las definiciones de tipos de tu instancia (Telegram Trigger 1.5, Telegram 1.2, HTTP Request 4.5, If 2.3). **Aún no se ha importado ni ejecutado en n8n.**
