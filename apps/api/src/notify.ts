export interface AlertEvent {
  type: string;
  message: string;
  until?: string | null;
}
export type Notify = (evt: AlertEvent) => void;

/**
 * Avisos al webhook de n8n (que los reenvía a Telegram). Mejor esfuerzo: un fallo del aviso
 * se registra pero nunca rompe la cola. No sigue redirecciones (el secreto va en una cabecera propia).
 */
export function makeNotifier(cfg?: { url: string; secret: string }): Notify {
  if (!cfg) return () => undefined;
  return (evt) => {
    fetch(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-webhook-secret': cfg.secret },
      body: JSON.stringify({ source: 'andyos', ...evt }),
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    }).catch((err: Error) => console.error('[notify] no se pudo enviar el aviso:', err.message));
  };
}
