// db.js — SQLite persistence layer
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'gala.db');
// Ensure directory exists
const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---- Schema ----
db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  ordinal INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nominees (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  name TEXT NOT NULL,
  detail TEXT,
  base_votes INTEGER DEFAULT 0,
  paid_votes INTEGER DEFAULT 0,
  ordinal INTEGER DEFAULT 0,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  checkout_id TEXT UNIQUE,
  user_id TEXT,
  device_id TEXT,
  nominee_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  amount INTEGER NOT NULL,
  votes INTEGER NOT NULL,
  status TEXT NOT NULL,        -- pending | success | failed
  mpesa_receipt TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (nominee_id) REFERENCES nominees(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS device_votes (
  device_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  nominee_id TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, category_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_nom_cat ON nominees(category_id);
`);

// ---- Lightweight migration for older DBs that already have `transactions` without device_id ----
try {
  const cols = db.prepare(`PRAGMA table_info(transactions)`).all();
  if (!cols.some(c => c.name === 'device_id')) {
    db.exec(`ALTER TABLE transactions ADD COLUMN device_id TEXT`);
  }
} catch (e) { /* ignore */ }

// ---- Migration: device_votes now keyed by (device_id, category_id) so a device can vote once PER CATEGORY ----
try {
  const dvCols = db.prepare(`PRAGMA table_info(device_votes)`).all();
  const hasCategory = dvCols.some(c => c.name === 'category_id');
  if (dvCols.length > 0 && !hasCategory) {
    // Old schema had device_id as PRIMARY KEY. Rebuild the table.
    db.exec(`
      BEGIN;
      CREATE TABLE device_votes_new (
        device_id TEXT NOT NULL,
        category_id TEXT NOT NULL,
        nominee_id TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (device_id, category_id)
      );
      INSERT INTO device_votes_new (device_id, category_id, nominee_id, created_at)
        SELECT dv.device_id,
               COALESCE(n.category_id, 'legacy') AS category_id,
               dv.nominee_id,
               dv.created_at
        FROM device_votes dv
        LEFT JOIN nominees n ON n.id = dv.nominee_id;
      DROP TABLE device_votes;
      ALTER TABLE device_votes_new RENAME TO device_votes;
      COMMIT;
    `);
    console.log('[db] Migrated device_votes to per-category schema.');
  }
} catch (e) { console.error('[db] device_votes migration error:', e); }

// ---- Seed data (Kirinyaga Gala Awards — from Gala awards.html, "Best Barber Shop" excluded) ----
const SEED_VERSION = 'v4-2026-kirinyaga-galla';

const seedCategories = [
  { id: 'best-mc', title: 'Best MC', nominees: [
    ['MC Alex Mwaniki', ''],
    ['MC Chapo', ''],
    ['MC Mike On The Mic', ''],
    ['MC Chape Chape', ''],
    ['MC Frank Manga', ''],
    ['MC Hype Mash', ''],
  ]},
  { id: 'best-photographer', title: 'Best Photographer', nominees: [
    ['Drip Art', ''],
    ['Kingde', ''],
    ['Lemmy Photography', ''],
    ['Trimpix', ''],
    ['Gabi Shoots', ''],
    ['Joe Media', ''],
    ['Spencer Photography', ''],
    ['RS Photography', ''],
    ['Jimtech Studio', ''],
    ['Manu Photography', ''],
  ]},
  { id: 'best-club-mc', title: 'Best Club MC', nominees: [
    ['MC Mtapelli', ''],
    ['MC Jones', ''],
    ['MC Dagi', ''],
    ['MC Trizy', ''],
  ]},
  { id: 'best-dj', title: 'Best DJ', nominees: [
    ['DJ Springdee', ''],
    ['DJ Snipes', ''],
    ['DJ Laxy', ''],
  ]},
  { id: 'best-influencer', title: 'Best Influencer', nominees: [
    ['Temu Awoo', ''],
    ['The Influencer', ''],
    ['Justin Kinyua', ''],
    ['Kirinyaga Superstars', ''],
  ]},
  { id: 'best-teacher', title: 'Best Teacher', nominees: [
    ['Mr Njogu', 'Kavote Secondary School'],
    ['Mr Josphat Wamae', 'Multiple Comprehensive'],
    ['Mr Munene', 'Kiaga'],
    ['Mr Alex Gakuru', 'Kianyaga Boys'],
    ['Tr Emily', 'Kabare Girls'],
    ['Mr Gitahi', 'Kamwiru Boys'],
    ['Tr Sharon', 'Karimaini Junior School'],
    ['Mr Kariuki (Determined)', ''],
    ['Mr Njanja', 'Baricho Boys'],
    ['Tr Lucy', 'Kiaragana Girls'],
  ]},
  { id: 'best-private-school', title: 'Best Private School', nominees: [
    ['Multiple Comprehensive School', ''],
    ['Kerugoya Municipality', ''],
    ['Kerugoya Goodshepherd', ''],
    ['Jufred Comprehensive School', ''],
    ['Alber School Kutus', ''],
    ['Kerugoya PCEA Academy', ''],
    ['Kutus Municipality Comprehensive School', ''],
  ]},
  { id: 'leader-kirinyaga', title: 'Most Popular Leader — Kirinyaga Central', nominees: [
    ['Gachoki Gitari', ''],
    ['Hon Kawangui', ''],
    ['Edward Chomba', ''],
    ['Wakili Wambugu', ''],
  ]},
  { id: 'leader-ndia', title: 'Most Popular Leader — Ndia', nominees: [
    ['GK Kariuki', 'GK'],
    ['Jedidah Waguthii Muchoki', ''],
    ['Christopher Muriithi', ''],
    ['Muteti Murimi', ''],
  ]},
  { id: 'leader-gichugu', title: 'Most Popular Leader — Gichugu', nominees: [
    ['Gichimu Githinji', ''],
    ['Njogu Barua', ''],
    ['Michael Muchiri', ''],
    ['Justus Munene', ''],
    ['Njomo Muchira', ''],
    ['Faith Wakio', ''],
    ['Njeri Mbogo', ''],
  ]},
  { id: 'leader-mwea', title: 'Most Popular Leader — Mwea', nominees: [
    ['Kabinga wa Thaayu', ''],
    ['Wangeci Warui', ''],
    ['Mary Maingi', ''],
    ['Ken Daktari', ''],
    ['Jinaro Njamumo', ''],
  ]},
  { id: 'kirinyaga-kingpin', title: 'Kirinyaga Kingpin', nominees: [
    ['Hon Kamau Murango', ''],
    ['Hon Martha Karua', ''],
    ['Hon Ann Waiguru', ''],
    ['Hon GK Kariuki', ''],
    ['Karanja Kibicho', ''],
  ]},
  { id: 'mt-kenya-kingpin', title: 'Mt Kenya Kingpin', nominees: [
    ['H.E Prof Kithure Kindiki', ''],
    ['H.E Rigathi Gachagua', ''],
  ]},
  { id: 'best-tertiary', title: 'Best Tertiary Institution', nominees: [
    ['Ndia Technical', ''],
    ['Kiharu Technical College', ''],
    ['Mathenge Institute', ''],
  ]},
  { id: 'best-karaoke-host', title: 'Best Karaoke Host', nominees: [
    ['Liz Beib', ''],
    ['MC Sophie Ka Wairimu', ''],
    ['Miss Lady Carol', ''],
    ['Jackie', 'Sandra Ithaga Riene'],
    ['MC Vee', ''],
  ]},
];

const { v4: uuid } = require('uuid');

function seedAll() {
  const insertCat = db.prepare('INSERT INTO categories (id, title, ordinal) VALUES (?, ?, ?)');
  const insertNom = db.prepare('INSERT INTO nominees (id, category_id, name, detail, ordinal) VALUES (?, ?, ?, ?, ?)');
  const tx = db.transaction(() => {
    seedCategories.forEach((cat, ci) => {
      insertCat.run(cat.id, cat.title, ci + 1);
      cat.nominees.forEach((n, ni) => {
        insertNom.run(uuid(), cat.id, n[0], n[1] || '', ni + 1);
      });
    });
  });
  tx();
}

const catCount = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
const seedRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('seed_version');
const currentSeed = seedRow ? seedRow.value : null;

if (catCount === 0) {
  seedAll();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('seed_version', SEED_VERSION);
  console.log('[db] Seeded Kirinyaga Gala Awards categories and nominees.');
} else if (currentSeed !== SEED_VERSION) {
  // Existing DB from an older seed — replace category/nominee catalogue but keep votes/transactions history intact.
  const wipe = db.transaction(() => {
    db.prepare('DELETE FROM nominees').run();
    db.prepare('DELETE FROM categories').run();
  });
  wipe();
  seedAll();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('seed_version', SEED_VERSION);
  console.log('[db] Re-seeded categories/nominees to ' + SEED_VERSION);
}

// Countdown init
const cdRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('countdown_end');
if (!cdRow) {
  const days = parseInt(process.env.COUNTDOWN_DAYS || '20', 10);
  const end = Date.now() + days * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('countdown_end', String(end));
}

module.exports = db;
