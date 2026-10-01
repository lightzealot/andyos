import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkFile, PUBLICATION_LABEL, PUBLISH_ERROR, UPLOAD_ERROR } from '../lib/publish';

describe('publicar: textos y validación en el navegador', () => {
  it('hay texto para TODOS los motivos de rechazo que puede devolver la API', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'api', 'src', 'publish.ts'), 'utf8');
    const union = /export type PublishError =([^;]+);/.exec(src)![1];
    const codes = [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(codes.length).toBeGreaterThanOrEqual(10);
    for (const c of codes) expect(PUBLISH_ERROR[c], `falta el texto de «${c}»`).toBeTruthy();
  });
  it('hay texto para cada error de subida y cada estado de publicación', () => {
    const media = readFileSync(join(__dirname, '..', '..', 'api', 'src', 'media.ts'), 'utf8');
    for (const c of [...media.matchAll(/send\(\{ error: '([a-z_]+)'/g)].map((m) => m[1]).filter((c) => !['unauthorized', 'not_found', 'invalid'].includes(c))) {
      expect(UPLOAD_ERROR[c], `falta el texto de subida «${c}»`).toBeTruthy();
    }
    const db = readFileSync(join(__dirname, '..', '..', 'api', 'src', 'db.ts'), 'utf8');
    const statuses = [...(/CHECK \(status IN \(([^)]*'published'[^)]*)\)\)/.exec(db)![1]).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    for (const s of statuses) expect(PUBLICATION_LABEL[s], `falta la etiqueta de «${s}»`).toBeTruthy();
  });
  it('rechaza lo que no es JPG o pesa más de 8 MB antes de subir', () => {
    expect(checkFile({ name: 'a.jpg', type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(checkFile({ name: 'A.JPEG', type: '', size: 1000 })).toBeNull();
    expect(checkFile({ name: 'a.png', type: 'image/png', size: 1000 })).toMatch(/JPG/);
    expect(checkFile({ name: 'a.jpg', type: 'image/jpeg', size: 8 * 1024 * 1024 + 1 })).toMatch(/8 MB/);
  });
});
