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
`;

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
