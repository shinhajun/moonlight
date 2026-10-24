import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'user',  -- user | platform
  email TEXT UNIQUE,
  name TEXT NOT NULL,
  handle TEXT UNIQUE,                 -- namespace for private models
  password_hash TEXT,
  balance INTEGER NOT NULL DEFAULT 0,
  trusted INTEGER NOT NULL DEFAULT 0, -- operator-owned reference nodes
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- api (ml_sk_) | seller (ml_st_)
  name TEXT,
  hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used INTEGER
);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  name TEXT NOT NULL,
  info TEXT NOT NULL,
  agent_version TEXT,
  token_hash TEXT UNIQUE,             -- ml_nt_ from device pairing
  trusted INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  online_ms INTEGER NOT NULL DEFAULT 0,
  UNIQUE (seller_id, name)
);
CREATE TABLE IF NOT EXISTS pairings (
  code TEXT PRIMARY KEY,
  poll_hash TEXT NOT NULL UNIQUE,
  info TEXT NOT NULL,
  status TEXT NOT NULL,               -- pending | approved
  account_id TEXT,
  node_id TEXT,
  node_token TEXT,                    -- handed to the polling agent once, then cleared
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS refs (     -- digests trusted nodes reported, per public model
  model_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  node_id TEXT NOT NULL,
  set_at INTEGER NOT NULL,
  PRIMARY KEY (model_id, digest)
);
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- chat | embedding | decision
  runtime TEXT,
  digest TEXT,
  size_bytes INTEGER,
  quant TEXT,
  family TEXT,
  params_b REAL,
  context INTEGER,
  dims INTEGER,
  license_id TEXT,
  license_source TEXT,
  source_registry TEXT,
  source_ref TEXT,
  private INTEGER NOT NULL,
  price TEXT NOT NULL,                -- JSON {in_per_m?, out_per_m?, per_call?}
  price_source TEXT NOT NULL,         -- market | hello | web
  policy TEXT NOT NULL,               -- live | needs_attestation | blocked:license | blocked:policy
  reason TEXT,
  attested INTEGER NOT NULL DEFAULT 0,
  paused INTEGER NOT NULL DEFAULT 0,
  verify_rate REAL,
  state TEXT NOT NULL DEFAULT 'new',  -- new | verified | flagged
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (seller_id, model_id)
);
CREATE TABLE IF NOT EXISTS node_listings (  -- what each node advertised in its last hello/models
  node_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  PRIMARY KEY (node_id, listing_id)
);
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  ts INTEGER NOT NULL,
  buyer_id TEXT NOT NULL,
  model_id TEXT NOT NULL,             -- the model that served it
  requested_model TEXT NOT NULL,      -- may be an auto/* alias
  kind TEXT NOT NULL,
  listing_id TEXT,
  seller_id TEXT,
  node_id TEXT,
  job_id TEXT,
  status TEXT NOT NULL,               -- ok | error | cancelled | seller_lost
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost INTEGER NOT NULL DEFAULT 0,
  earned INTEGER NOT NULL DEFAULT 0,
  ttft_ms INTEGER,
  latency_ms INTEGER,
  queue_ms INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  failovers INTEGER NOT NULL DEFAULT 0,
  verification INTEGER NOT NULL DEFAULT 0,
  badge TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS requests_ts ON requests (ts);
CREATE INDEX IF NOT EXISTS requests_buyer ON requests (buyer_id, ts);
CREATE INDEX IF NOT EXISTS requests_seller ON requests (seller_id, ts);
CREATE INDEX IF NOT EXISTS requests_node ON requests (node_id, ts);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  request_id TEXT,
  account_id TEXT NOT NULL,
  listing_id TEXT,
  node_id TEXT,
  kind TEXT NOT NULL,                 -- grant | debit | earn | fee
  amount INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_account ON ledger (account_id, ts);
CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  listing_id TEXT NOT NULL,
  node_id TEXT,
  method TEXT NOT NULL,               -- canary | replay | peer | consistency
  metric TEXT NOT NULL,               -- agreement | max_dp | cosine | match
  passed INTEGER NOT NULL,
  score REAL,
  threshold REAL,
  state_after TEXT,
  ref_node_id TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS checks_listing ON checks (listing_id, id);
CREATE INDEX IF NOT EXISTS checks_ts ON checks (ts);
`;

// Node's built-in SQLite: no native dependency to build on the VM.
export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  raw.exec(SCHEMA);
  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) cache.set(sql, (s = raw.prepare(sql)));
    return s;
  };
  let depth = 0;
  return {
    raw,
    get: (sql, ...p) => stmt(sql).get(...p),
    all: (sql, ...p) => stmt(sql).all(...p),
    run: (sql, ...p) => stmt(sql).run(...p),
    // Nested calls join the outer transaction.
    tx(fn) {
      if (depth++) {
        try {
          return fn();
        } finally {
          depth--;
        }
      }
      raw.exec('BEGIN');
      try {
        const r = fn();
        raw.exec('COMMIT');
        return r;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      } finally {
        depth--;
      }
    },
    close: () => raw.close(),
  };
}
