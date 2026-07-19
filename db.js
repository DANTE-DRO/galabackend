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

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_tx_created ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_nom_cat ON nominees(category_id);
`);

// Backward-compatible schema migration for existing Render disks.
const txColumns = db.prepare('PRAGMA table_info(transactions)').all().map(c => c.name);
if (!txColumns.includes('device_id')) db.exec('ALTER TABLE transactions ADD COLUMN device_id TEXT');
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_success_device_vote ON transactions(device_id) WHERE status = 'success' AND device_id IS NOT NULL");

// ---- Seed default data on first run ----
const catCount = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
if (catCount === 0) {
  const seed = [
    { id: 'mc', title: 'Best MC', nominees: [
      ['MC Alex Mwaniki', ''], ['MC Chapo', ''], ['MC Mike On The Mic', ''],
      ['MC Chape Chape', ''], ['MC Frank Manga', ''], ['MC Hype Mash', ''],
    ]},
    { id: 'photographer', title: 'Best Photographer', nominees: [
      ['Drip Art', ''], ['Kingde', ''], ['Lemmy Photography', ''], ['Trimpix', ''], ['Gabi Shoots', ''],
      ['Joe Media', ''], ['Spencer Photography', ''], ['RS Photography', ''], ['Jimtech Studio', ''], ['Manu Photography', ''],
    ]},
    { id: 'club-mc', title: 'Best Club MC', nominees: [
      ['MC Mtapelli', ''], ['MC Jones', ''], ['MC Dagi', ''], ['MC Trizy', ''],
    ]},
    { id: 'dj', title: 'Best DJ', nominees: [
      ['DJ Springdee', ''], ['DJ A', ''], ['DJ B', ''], ['DJ C', ''], ['DJ D', ''],
    ]},
    { id: 'teacher', title: 'Best Teacher', nominees: [
      ['Mr Njogu', 'Kavote Secondary School'], ['Mr Josphat Wamae', 'Multiple Comprehensive'], ['Mr Munene', 'Kiaga'],
      ['Mr Alex Gakuru', 'Kianyaga Boys'], ['Tr Emily', 'Kabare Girls'], ['Mr Gitahi', 'Kamwiru Boys'],
      ['Tr Sharon', 'Karimaini Junior School'], ['Mr Kariuki', 'Ngurubani Junior School'], ['Mr Njanja', 'Baricho Boys'], ['Tr Lucy', 'Kiaragana Girls'],
    ]},
    { id: 'private-school', title: 'Best Private School', nominees: [
      ['Multiple Comprehensive School', ''], ['Kerugoya Municipality', ''], ['Kerugoya Goodshepherd', ''], ['Jufred Comprehensive School', ''],
      ['Alber School Kutus', ''], ['Kerugoya PCEA Academy', ''], ['Kutus Municipality Comprehensive School', ''],
    ]},
    { id: 'leader-kirinyaga', title: 'Most Popular Leader — Kirinyaga', nominees: [
      ['Gachoki Gitari', ''], ['Hon Kawangui', ''], ['Edward Chomba', ''], ['Wakili Wambugu', ''],
    ]},
    { id: 'leader-ndia', title: 'Most Popular Leader — Ndia', nominees: [
      ['GK Kariuki', 'GK'], ['Jedidah Waguthii Muchoki', ''], ['Christopher Muriithi', ''], ['Muteti Murimi', ''],
    ]},
    { id: 'leader-gichugu', title: 'Most Popular Leader — Gichugu', nominees: [
      ['Gichimu Githinji', ''], ['Njogu Barua', ''], ['Michael Muchiri', ''], ['Justus Munene', ''], ['Njomo Muchira', ''], ['Faith Wakio', ''], ['Njeri Mbogo', ''],
    ]},
    { id: 'leader-mwea', title: 'Most Popular Leader — Mwea', nominees: [
      ['Kabinga wa Thaayu', ''], ['Wangeci Warui', ''], ['Mary Maingi', ''], ['Ken Daktari', ''], ['Jinaro Njamumo', ''],
    ]},
    { id: 'kirinyaga-kingpin', title: 'Kirinyaga Kingpin', nominees: [
      ['Hon Kamau Murango', ''], ['Hon Martha Karua', ''], ['Hon Ann Waiguru', ''], ['Hon GK Kariuki', ''], ['Karanja Kibicho', ''],
    ]},
    { id: 'mt-kenya-kingpin', title: 'Mt Kenya Kingpin', nominees: [
      ['H.E Prof Kithure Kindiki', ''], ['H.E Rigathi Gachagua', ''],
    ]},
    { id: 'tertiary', title: 'Best Tertiary Institution', nominees: [
      ['Ndia Technical', ''], ['Kiharu Technical College', ''], ['Mathenge Institute', ''],
    ]},
    { id: 'karaoke-host', title: 'Best Karaoke Host', nominees: [
      ['Liz Beib', ''], ['MC Sophie Ka Wairimu', ''], ['Miss Lady Carol', ''], ['Jackie', 'Sandra Ithaga Riene'], ['MC Vee', ''],
    ]},
  ];

  const insertCat = db.prepare('INSERT INTO categories (id, title, ordinal) VALUES (?, ?, ?)');
  const insertNom = db.prepare('INSERT INTO nominees (id, category_id, name, detail, ordinal) VALUES (?, ?, ?, ?, ?)');
  const { v4: uuid } = require('uuid');

  const tx = db.transaction(() => {
    seed.forEach((cat, ci) => {
      insertCat.run(cat.id, cat.title, ci + 1);
      cat.nominees.forEach((n, ni) => {
        insertNom.run(uuid(), cat.id, n[0], n[1], ni + 1);
      });
    });
  });
  tx();
  console.log('[db] Seeded default categories and nominees.');
}

// Countdown init
const cdRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('countdown_end');
if (!cdRow) {
  const days = parseInt(process.env.COUNTDOWN_DAYS || '20', 10);
  const end = Date.now() + days * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('countdown_end', String(end));
}

module.exports = db;
