import Database from 'better-sqlite3';
import { seedVoice } from './voice.js';

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

CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  input TEXT NOT NULL,
  target_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','canceled')),
  requested_provider TEXT NOT NULL DEFAULT 'claude' CHECK (requested_provider IN ('claude','codex')),
  provider TEXT,
  model TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  not_before TEXT,
  lease_until TEXT,
  output TEXT,
  usage TEXT,
  error_class TEXT,
  error TEXT,
  accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_status ON ai_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_started ON ai_jobs (started_at);

CREATE TABLE IF NOT EXISTS queue_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  paused INTEGER NOT NULL DEFAULT 0,
  paused_reason TEXT,
  paused_until TEXT,
  max_per_day INTEGER NOT NULL DEFAULT 15,
  max_per_week INTEGER NOT NULL DEFAULT 60,
  concurrency INTEGER NOT NULL DEFAULT 1,
  five_hour_pause_at REAL NOT NULL DEFAULT 0.8,
  seven_day_pause_at REAL NOT NULL DEFAULT 0.85,
  usage_snapshot TEXT,
  usage_snapshot_at TEXT,
  updated_at TEXT
);
INSERT OR IGNORE INTO queue_state (id) VALUES (1);

CREATE TABLE IF NOT EXISTS voice_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  guide TEXT NOT NULL,
  facts TEXT NOT NULL,
  banned TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_examples (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('hook','script','caption')),
  text TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('semilla','usuario')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_links (
  from_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  to_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('inspired_by','derived_from','repurposed_from')),
  PRIMARY KEY (from_id, to_id, kind)
);
`;

/** Migraciones aditivas: añade una columna si falta (las tablas existentes de producción no se recrean). */
function ensureColumn(db: Db, table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}

export function openDb(path: string): Db {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  
  ensureColumn(db, 'queue_state', 'auto_tag', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'ai_jobs', 'dismissed_at', 'TEXT');
  ensureColumn(db, 'ai_jobs', 'review', 'TEXT');
  ensureColumn(db, 'content_details', 'carousel_folder', 'TEXT');
  ensureColumn(db, 'content_details', 'carousel_state', 'TEXT');
  seedVoice(db);
  return db;
}
