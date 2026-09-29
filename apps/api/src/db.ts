import Database from 'better-sqlite3';

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'content' CHECK (type IN ('idea','content','task','reference')),
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_work_items_type_status ON work_items (type, status);

CREATE TABLE IF NOT EXISTS content_details (
  work_item_id TEXT PRIMARY KEY REFERENCES work_items(id) ON DELETE CASCADE,
  platform TEXT,
  format TEXT,
  pillar TEXT,
  hook TEXT NOT NULL DEFAULT '',
  script TEXT NOT NULL DEFAULT '{}',
  caption TEXT NOT NULL DEFAULT '',
  scheduled_at TEXT,
  published_at TEXT,
  published_url TEXT,
  asset_links TEXT NOT NULL DEFAULT '[]',
  cta_keyword TEXT,
  approved_at TEXT,
  ai_generated INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS idea_details (
  work_item_id TEXT PRIMARY KEY REFERENCES work_items(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_id TEXT,
  promoted_to TEXT REFERENCES work_items(id),
  UNIQUE (source, source_id)
);

CREATE TABLE IF NOT EXISTS reference_details (
  work_item_id TEXT PRIMARY KEY REFERENCES work_items(id) ON DELETE CASCADE,
  url TEXT,
  creator TEXT NOT NULL DEFAULT '',
  platform TEXT,
  format TEXT,
  why_it_works TEXT NOT NULL DEFAULT '',
  hook_pattern TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS item_links (
  from_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('inspired_by','derived_from','repurposed_from')),
  PRIMARY KEY (from_id, to_id, kind)
);
`;

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
