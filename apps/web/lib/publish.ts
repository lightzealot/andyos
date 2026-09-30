/** Textos para el usuario de los motivos por los que no se puede publicar (los códigos vienen de la API). */
export const PUBLISH_ERROR: Record<string, string> = {
  platform_not_instagram: 'La plataforma de esta tarjeta no es Instagram. Cámbiala a Instagram para publicar aquí.',
  not_approved: 'Falta tu aprobación: pásala a Aprobación y pulsa «Aprobar contenido». Si editaste algo después de aprobar, hay que aprobar de nuevo.',
  no_images: 'Sube al menos una imagen (JPG).',
  too_many_images: 'Un carrusel admite como máximo 10 imágenes.',
  bad_ratio: 'Alguna imagen tiene una proporción que Instagram no acepta (entre 4:5 y 1,91:1).',
  caption_too_long: 'El caption supera los 2.200 caracteres.',
  pending_placeholders: 'El caption todavía tiene marcadores por completar ([DATO], [VIVENCIA] o [CONFIRMAR]). Complétalos antes de publicar.',
  publication_in_progress: 'Ya hay una publicación en curso para esta tarjeta.',
  needs_resolution: 'Un intento anterior quedó en duda: no sé si salió. Mira Instagram y márcalo abajo («Sí salió» / «No salió»).',
  already_published: 'Este mismo contenido ya se publicó. Si quieres publicarlo otra vez, cambia algo (caption o imágenes).',
};
export const UPLOAD_ERROR: Record<string, string> = {
  not_a_jpeg: 'no es un JPG válido', bad_ratio: 'proporción no válida (Instagram acepta de 4:5 a 1,91:1)', too_large: 'pesa más de 8 MB',
  too_many: 'ya hay 10 imágenes', only_jpeg: 'solo se aceptan JPG', not_found: 'la tarjeta ya no existe',
};
export const PUBLICATION_LABEL: Record<string, string> = {
  dry_run: 'Simulación (no se envió)', publishing: 'En curso', published: 'Publicada', failed: 'Falló (no se publicó)', unknown: 'En duda: ¿salió?',
  resolved_published: 'Publicada (confirmada por ti)', resolved_not_published: 'No salió (confirmado por ti)',
};

export const JPEG_MAX_BYTES = 8 * 1024 * 1024;
/** Valida en el navegador lo evidente antes de subir (la API vuelve a validarlo todo). */
export function checkFile(f: { name: string; type: string; size: number }): string | null {
  if (!(f.type === 'image/jpeg' || /\.jpe?g$/i.test(f.name))) return 'solo se aceptan JPG';
  if (f.size > JPEG_MAX_BYTES) return 'pesa más de 8 MB';
  return null;
}
