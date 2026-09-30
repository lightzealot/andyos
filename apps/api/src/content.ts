import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';

export interface NewContent {
  title: string;
  status: string;
  notes: string;
  tags: string[];
  platform?: string | null;
  format?: string | null;
  pillar?: string | null;
  hook?: string;
  script?: object;
  caption?: string;
  scheduled_at?: string | null;
  published_at?: string | null;
  published_url?: string | null;
  asset_links?: string[];
  cta_keyword?: string | null;
  carousel_folder?: string | null;
  carousel_state?: string | null;
}

export function insertContent(db: Db, d: NewContent): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`INSERT INTO work_items (id, type, title, status, notes, tags, created_at, updated_at)
                VALUES (?, 'content', ?, ?, ?, ?, ?, ?)`)
      .run(id, d.title, d.status, d.notes, JSON.stringify(d.tags), now, now);
    db.prepare(`INSERT INTO content_details (work_item_id, platform, format, pillar, hook, script, caption,
                scheduled_at, published_at, published_url, asset_links, cta_keyword, carousel_folder, carousel_state)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, d.platform ?? null, d.format ?? null, d.pillar ?? null, d.hook ?? '',
        JSON.stringify(d.script ?? {}), d.caption ?? '', d.scheduled_at ?? null,
        d.published_at ?? null, d.published_url ?? null, JSON.stringify(d.asset_links ?? []),
        d.cta_keyword ?? null, d.carousel_folder ?? null, d.carousel_state ?? null);
  })();
  return id;
}
