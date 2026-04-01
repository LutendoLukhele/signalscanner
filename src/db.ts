import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { ScoredLead } from './types';

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_PATH  = path.join(DATA_DIR, 'signals.db');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable WAL for better concurrent read performance
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS scans (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT    NOT NULL,
    finished_at TEXT,
    lead_count  INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS leads (
    id            TEXT PRIMARY KEY,
    url           TEXT NOT NULL UNIQUE,
    source        TEXT NOT NULL,
    author        TEXT NOT NULL,
    text          TEXT NOT NULL,
    title         TEXT,
    upvotes       INTEGER,
    created_at    TEXT NOT NULL,
    query         TEXT NOT NULL,
    score         INTEGER NOT NULL,
    urgency       TEXT NOT NULL,
    pain_category TEXT NOT NULL,
    draft_reply   TEXT,
    replied_at    TEXT,
    scanned_at    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_leads_score      ON leads(score DESC);
  CREATE INDEX IF NOT EXISTS idx_leads_scanned_at ON leads(scanned_at DESC);
  CREATE INDEX IF NOT EXISTS idx_leads_source     ON leads(source);
  CREATE INDEX IF NOT EXISTS idx_leads_urgency    ON leads(urgency);
`);

// ── Scans ─────────────────────────────────────────────────────────────────────

export function startScan(): number {
  const stmt = db.prepare(
    `INSERT INTO scans (started_at) VALUES (?)`,
  );
  const info = stmt.run(new Date().toISOString());
  return info.lastInsertRowid as number;
}

export function finishScan(scanId: number, leadCount: number): void {
  db.prepare(
    `UPDATE scans SET finished_at = ?, lead_count = ? WHERE id = ?`,
  ).run(new Date().toISOString(), leadCount, scanId);
}

// ── Leads ─────────────────────────────────────────────────────────────────────

export function upsertLead(lead: ScoredLead): void {
  db.prepare(`
    INSERT INTO leads
      (id, url, source, author, text, title, upvotes, created_at, query,
       score, urgency, pain_category, draft_reply, replied_at, scanned_at)
    VALUES
      (@id, @url, @source, @author, @text, @title, @upvotes, @created_at,
       @query, @score, @urgency, @pain_category, @draft_reply, @replied_at,
       @scanned_at)
    ON CONFLICT(id) DO UPDATE SET
      score         = excluded.score,
      urgency       = excluded.urgency,
      pain_category = excluded.pain_category,
      scanned_at    = excluded.scanned_at
  `).run({
    id:           lead.id,
    url:          lead.url,
    source:       lead.source,
    author:       lead.author,
    text:         lead.text,
    title:        lead.title ?? null,
    upvotes:      lead.upvotes ?? null,
    created_at:   lead.createdAt.toISOString(),
    query:        lead.query,
    score:        lead.score,
    urgency:      lead.urgency,
    pain_category:lead.painCategory,
    draft_reply:  lead.draftReply ?? null,
    replied_at:   lead.repliedAt?.toISOString() ?? null,
    scanned_at:   lead.scannedAt.toISOString(),
  });
}

export interface LeadFilter {
  source?:      string;
  urgency?:     string;
  minScore?:    number;
  page?:        number;
  pageSize?:    number;
  unrepliedOnly?: boolean;
}

export interface LeadRow {
  id:           string;
  url:          string;
  source:       string;
  author:       string;
  text:         string;
  title:        string | null;
  upvotes:      number | null;
  created_at:   string;
  query:        string;
  score:        number;
  urgency:      string;
  pain_category:string;
  draft_reply:  string | null;
  replied_at:   string | null;
  scanned_at:   string;
}

export function getLeads(filter: LeadFilter = {}): { leads: LeadRow[]; total: number } {
  const {
    source,
    urgency,
    minScore = 1,
    page = 1,
    pageSize = 20,
    unrepliedOnly = false,
  } = filter;

  const conditions: string[] = ['score >= @minScore'];
  const params: Record<string, unknown> = { minScore };

  if (source) { conditions.push('source = @source'); params.source = source; }
  if (urgency) { conditions.push('urgency = @urgency'); params.urgency = urgency; }
  if (unrepliedOnly) { conditions.push('replied_at IS NULL'); }

  const where = conditions.join(' AND ');
  const offset = (page - 1) * pageSize;

  const total = (db.prepare(`SELECT COUNT(*) as cnt FROM leads WHERE ${where}`).get(params) as { cnt: number }).cnt;
  const leads  = db.prepare(
    `SELECT * FROM leads WHERE ${where} ORDER BY score DESC, scanned_at DESC LIMIT @pageSize OFFSET @offset`,
  ).all({ ...params, pageSize, offset }) as LeadRow[];

  return { leads, total };
}

export function getLead(id: string): LeadRow | undefined {
  return db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as LeadRow | undefined;
}

export function saveReply(id: string, reply: string): void {
  db.prepare(
    `UPDATE leads SET draft_reply = ?, replied_at = ? WHERE id = ?`,
  ).run(reply, new Date().toISOString(), id);
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface Stats {
  totalLeads:    number;
  highUrgency:   number;
  avgScore:      number;
  bySource:      Record<string, number>;
  byPainCategory:Record<string, number>;
  recentScans:   { id: number; started_at: string; finished_at: string | null; lead_count: number }[];
}

export function getStats(): Stats {
  const row = db.prepare(`
    SELECT
      COUNT(*)                           AS total,
      SUM(CASE WHEN urgency='HIGH' THEN 1 ELSE 0 END) AS high,
      ROUND(AVG(score), 2)              AS avg_score
    FROM leads
  `).get() as { total: number; high: number; avg_score: number };

  const bySource = Object.fromEntries(
    (db.prepare(`SELECT source, COUNT(*) as cnt FROM leads GROUP BY source`).all() as { source: string; cnt: number }[])
      .map(r => [r.source, r.cnt]),
  );

  const byPainCategory = Object.fromEntries(
    (db.prepare(`SELECT pain_category, COUNT(*) as cnt FROM leads GROUP BY pain_category`).all() as { pain_category: string; cnt: number }[])
      .map(r => [r.pain_category, r.cnt]),
  );

  const recentScans = db.prepare(
    `SELECT id, started_at, finished_at, lead_count FROM scans ORDER BY id DESC LIMIT 10`,
  ).all() as Stats['recentScans'];

  return {
    totalLeads:     row.total ?? 0,
    highUrgency:    row.high  ?? 0,
    avgScore:       row.avg_score ?? 0,
    bySource,
    byPainCategory,
    recentScans,
  };
}
