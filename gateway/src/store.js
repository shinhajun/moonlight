// Accounts, sessions, keys, node tokens, listings and money. Everything SQLite, synchronous.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { newId, newSecret, now, sha256 } from './util.js';

export const PLATFORM_ID = 'platform';
// Pays for verification jobs, so they look and settle exactly like buyer jobs.
export const VERIFIER_ID = 'usr_verifier';

const SESSION_MS = 30 * 24 * 3600_000;
const scrypt = promisify(crypto.scrypt);

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function checkPassword(password, stored) {
  const [alg, salt, hex] = (stored || '').split('$');
  if (alg !== 'scrypt') return false;
  const key = await scrypt(password, Buffer.from(salt, 'hex'), 64);
  return crypto.timingSafeEqual(key, Buffer.from(hex, 'hex'));
}

const slug = (name) =>
  (name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20).replace(/-+$/, '') || 'user';

const prefixOf = (secret) => `${secret.slice(0, 10)}…${secret.slice(-4)}`;

const LISTING_COLS = ['kind', 'runtime', 'digest', 'size_bytes', 'quant', 'family', 'params_b', 'context', 'dims', 'license_id',
  'license_source', 'source_registry', 'source_ref', 'private', 'price', 'price_source', 'policy', 'reason'];

function parseListing(row) {
  if (!row) return null;
  return { ...row, private: !!row.private, paused: !!row.paused, attested: !!row.attested, price: JSON.parse(row.price) };
}

export function createStore(db, config) {
  const s = {
    account: (id) => db.get('SELECT * FROM accounts WHERE id = ?', id),
    accountByEmail: (email) => db.get('SELECT * FROM accounts WHERE email = ?', email),

    freeHandle(base) {
      for (let i = 1; ; i++) {
        const h = i === 1 ? base : `${base}-${i}`;
        if (!db.get('SELECT 1 FROM accounts WHERE handle = ?', h)) return h;
      }
    },

    insertAccount({ email = null, name, handle, passwordHash = null, googleSub = null, trusted = false, credit = config.demoCredit, id = newId('usr') }) {
      const t = now();
      db.tx(() => {
        db.run('INSERT INTO accounts (id, email, name, handle, password_hash, google_sub, balance, trusted, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          id, email, name, s.freeHandle(handle || slug(name)), passwordHash, googleSub, credit, trusted ? 1 : 0, t);
        if (credit) db.run('INSERT INTO ledger (ts, account_id, kind, amount) VALUES (?, ?, ?, ?)', t, id, 'grant', credit);
      });
      return s.account(id);
    },

    async signup({ email, password, name, credit }) {
      return s.insertAccount({ email, name, credit, passwordHash: await hashPassword(password) });
    },

    async login(email, password) {
      const a = s.accountByEmail(email);
      return a && (await checkPassword(password, a.password_hash)) ? a : null;
    },

    accountByGoogle: (sub) => db.get('SELECT * FROM accounts WHERE google_sub = ?', sub),
    linkGoogle(accountId, sub) {
      db.run('UPDATE accounts SET google_sub = ? WHERE id = ?', sub, accountId);
      return s.account(accountId);
    },

    createSession(accountId) {
      const token = crypto.randomBytes(32).toString('hex');
      const t = now();
      db.run('INSERT INTO sessions (hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)', sha256(token), accountId, t, t + SESSION_MS);
      return token;
    },
    accountBySession(token) {
      if (!token) return null;
      return db.get('SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.hash = ? AND s.expires_at > ?', sha256(token), now()) || null;
    },
    deleteSession: (token) => token && db.run('DELETE FROM sessions WHERE hash = ?', sha256(token)),

    createKey(accountId, kind = 'api', name = null, secret = null) {
      secret ||= newSecret(kind === 'seller' ? 'ml_st' : 'ml_sk');
      const id = newId('key');
      db.run('INSERT INTO keys (id, account_id, kind, name, hash, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, accountId, kind, name, sha256(secret), prefixOf(secret), now());
      return { key: s.keyOf(accountId, id), secret };
    },
    // API keys with their usage: requests made and micro-USD spent with each.
    keysOf: (accountId, keyId = null) => db.all(
      `SELECT k.id, k.name, k.prefix, k.created_at, k.last_used, COUNT(r.id) AS requests, COALESCE(SUM(r.cost), 0) AS spend_microusd
       FROM keys k LEFT JOIN requests r ON r.key_id = k.id AND r.status != 'error'
       WHERE k.account_id = ? AND k.kind = 'api' AND (? IS NULL OR k.id = ?) GROUP BY k.id ORDER BY k.created_at`,
      accountId, keyId, keyId,
    ).map((k) => ({ ...k })),
    keyOf: (accountId, id) => s.keysOf(accountId, id)[0] || null,
    countKeys: (accountId) => db.get("SELECT COUNT(*) AS n FROM keys WHERE account_id = ? AND kind = 'api'", accountId).n,
    renameKey: (accountId, id, name) => db.run("UPDATE keys SET name = ? WHERE id = ? AND account_id = ? AND kind = 'api'", name, id, accountId).changes > 0,
    deleteKey: (accountId, id) => db.run("DELETE FROM keys WHERE id = ? AND account_id = ? AND kind = 'api'", id, accountId).changes > 0,

    // ml_sk_ API key or ml_st_ seller token → {account, kind, keyId}.
    bySecret(secret) {
      if (typeof secret !== 'string' || !/^ml_(sk|st)_[0-9a-f]{32}$/.test(secret)) return null;
      const k = db.get('SELECT id, account_id, kind FROM keys WHERE hash = ?', sha256(secret));
      if (!k) return null;
      db.run('UPDATE keys SET last_used = ? WHERE id = ?', now(), k.id);
      return { account: s.account(k.account_id), kind: k.kind, keyId: k.id };
    },
    nodeByToken(token) {
      if (typeof token !== 'string' || !/^ml_nt_[0-9a-f]{32}$/.test(token)) return null;
      return db.get('SELECT * FROM nodes WHERE token_hash = ?', sha256(token)) || null;
    },

    // Platform accounts plus the operator's reference-node sellers from config.
    bootstrap() {
      const t = now();
      for (const [id, name] of [[PLATFORM_ID, 'Moonlight platform'], [VERIFIER_ID, 'Moonlight verifier']]) {
        db.run("INSERT OR IGNORE INTO accounts (id, role, name, created_at) VALUES (?, 'platform', ?, ?)", id, name, t);
      }
      config.trustedTokens.forEach((token, i) => {
        const found = s.bySecret(token);
        if (found) return db.run('UPDATE accounts SET trusted = 1 WHERE id = ?', found.account.id);
        const a = s.insertAccount({ name: 'Moonlight Reference', handle: i ? `moonlight-${i + 1}` : 'moonlight', trusted: true });
        s.createKey(a.id, 'seller', 'reference node', token);
      });
    },

    listing: (id) => parseListing(db.get('SELECT * FROM listings WHERE id = ?', id)),
    listingsOfNode: (nodeId) =>
      db.all('SELECT l.* FROM node_listings n JOIN listings l ON l.id = n.listing_id WHERE n.node_id = ? ORDER BY l.model_id', nodeId).map(parseListing),

    // Keyed by (seller, model_id), so reconnects and re-scans reuse the listing, its state and web edits.
    upsertListing(sellerId, l) {
      const t = now();
      const old = db.get('SELECT id, price_source FROM listings WHERE seller_id = ? AND model_id = ?', sellerId, l.model_id);
      const row = { ...l, private: l.private ? 1 : 0, price: JSON.stringify(l.price) };
      if (!old) {
        db.run(`INSERT INTO listings (id, seller_id, model_id, ${LISTING_COLS.join(', ')}, created_at, updated_at)
                VALUES (?, ?, ?, ${LISTING_COLS.map(() => '?').join(', ')}, ?, ?)`,
          newId('lst'), sellerId, l.model_id, ...LISTING_COLS.map((c) => row[c] ?? null), t, t);
      } else {
        // A price set in the web wins over whatever the agent sends.
        const cols = old.price_source === 'web' ? LISTING_COLS.filter((c) => c !== 'price' && c !== 'price_source') : LISTING_COLS;
        db.run(`UPDATE listings SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
          ...cols.map((c) => row[c] ?? null), t, old.id);
      }
      return parseListing(db.get('SELECT * FROM listings WHERE seller_id = ? AND model_id = ?', sellerId, l.model_id));
    },

    updateListing(id, fields) {
      const cols = Object.keys(fields);
      const vals = cols.map((c) => (c === 'price' ? JSON.stringify(fields[c]) : typeof fields[c] === 'boolean' ? +fields[c] : fields[c]));
      db.run(`UPDATE listings SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, ...vals, now(), id);
      return s.listing(id);
    },

    // One request's money: buyer debit, seller credit (minus fee), platform fee, in one transaction.
    settle({ requestId, buyerId, sellerId, listingId, nodeId, cost }) {
      if (cost <= 0) return { fee: 0, share: 0 };
      const fee = Math.round((cost * config.feeBps) / 10_000);
      const share = cost - fee;
      const t = now();
      db.tx(() => {
        db.run('UPDATE accounts SET balance = balance - ? WHERE id = ?', cost, buyerId);
        db.run('UPDATE accounts SET balance = balance + ? WHERE id = ?', fee, PLATFORM_ID);
        const row = 'INSERT INTO ledger (ts, request_id, account_id, listing_id, node_id, kind, amount) VALUES (?, ?, ?, ?, ?, ?, ?)';
        db.run(row, t, requestId, buyerId, listingId, nodeId, 'debit', -cost);
        db.run(row, t, requestId, sellerId, listingId, nodeId, 'earn', share);
        db.run(row, t, requestId, PLATFORM_ID, listingId, nodeId, 'fee', fee);
      });
      return { fee, share };
    },

    // Earnings on a flagged listing are held, including what it earned before it was flagged.
    earnings(sellerId, nodeId = null) {
      const dayStart = new Date().setUTCHours(0, 0, 0, 0);
      const r = db.get(
        `SELECT
           COALESCE(SUM(CASE WHEN l.state != 'flagged' THEN g.amount END), 0) AS total,
           COALESCE(SUM(CASE WHEN l.state != 'flagged' AND g.ts >= ? THEN g.amount END), 0) AS today,
           COALESCE(SUM(CASE WHEN l.state = 'flagged' THEN g.amount END), 0) AS held
         FROM ledger g JOIN listings l ON l.id = g.listing_id
         WHERE g.account_id = ? AND g.kind = 'earn' AND (? IS NULL OR g.node_id = ?)`,
        dayStart, sellerId, nodeId, nodeId,
      );
      return { total: r.total, today: r.today, held: r.held };
    },
  };
  return s;
}
