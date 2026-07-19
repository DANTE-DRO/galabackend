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

// ---- Seed default data on first run ----
const catCount = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
if (catCount === 0) {
  const seed = [
    { id: 'mc', title: 'Best MC of the Year', nominees: [
      ['MC Kirinyaga', 'Radio & Events'],
      ['MC Wanjiru', 'Corporate Host'],
      ['MC Mwangi', 'Weddings Specialist'],
      ['MC Njoroge', 'Comedy MC'],
    ]},
    { id: 'dj', title: 'Best DJ of the Year', nominees: [
      ['DJ Karim', 'Club Circuit'],
      ['DJ Lyta Kenya', 'Radio Mix'],
      ['DJ Muriuki', 'Weddings & Corporate'],
      ['DJ Wa Mumbi', 'Gospel Sets'],
    ]},
    { id: 'photographer', title: 'Best Photographer', nominees: [
      ['Kimani Studios', 'Weddings'],
      ['Njeri Frames', 'Portraits'],
      ['Focus Kirinyaga', 'Events'],
      ['Highland Lens', 'Landscape'],
    ]},
    { id: 'videographer', title: 'Best Videographer', nominees: [
      ['Cinema Kirinyaga', 'Documentary'],
      ['Wangari Films', 'Weddings'],
      ['Mt Kenya Motion', 'Music Videos'],
      ['Aerial 254', 'Drone Cinematography'],
    ]},
    { id: 'artist', title: 'Best Musical Artist', nominees: [
      ['Kevo Wa Mumbi', 'Mugithi'],
      ['Sister Wanjiku', 'Gospel'],
      ['Young Kirinyaga', 'Afrobeat'],
      ['Mama Nyawira', 'Traditional'],
    ]},
    { id: 'teacher', title: 'Teacher of the Year', nominees: [
      ['Mr. Kariuki', 'Kerugoya Boys'],
      ['Madam Wangari', 'Kianyaga Girls'],
      ['Mr. Mutugi', 'Baricho High'],
      ['Madam Njoki', 'Kutus Primary'],
    ]},
    { id: 'school', title: 'School of the Year', nominees: [
      ['Kerugoya Boys High School', 'Secondary'],
      ['Kianyaga Girls', 'Secondary'],
      ['Baricho Boys', 'Secondary'],
      ['Mutira Girls', 'Secondary'],
    ]},
    { id: 'leader', title: 'Community Leader of the Year', nominees: [
      ['Hon. Waiguru', 'Governor'],
      ['Hon. Wachira', 'MP'],
      ['Bishop Muriuki', 'Faith Leader'],
      ['Mama Njeri', 'Community Elder'],
    ]},
    { id: 'entrepreneur', title: 'Entrepreneur of the Year', nominees: [
      ['Kirinyaga Coffee Co.', 'Agribusiness'],
      ['Highland Motors', 'Automotive'],
      ['Njeri Fashion House', 'Retail'],
      ['Mt Kenya Foods', 'Manufacturing'],
    ]},
    { id: 'restaurant', title: 'Best Restaurant', nominees: [
      ['Kerugoya Grill', 'Casual Dining'],
      ['Highland Bites', 'African Cuisine'],
      ['Kutus Kitchen', 'Family Restaurant'],
      ['Baricho Bistro', 'Fine Dining'],
    ]},
    { id: 'salon', title: 'Best Beauty Salon', nominees: [
      ['Njeri Beauty Lounge', 'Bridal'],
      ['Highland Hair', 'Braiding'],
      ['Glam Kirinyaga', 'Nails & Lashes'],
      ['Wanjiru Spa', 'Full Service'],
    ]},
    { id: 'boutique', title: 'Best Fashion Boutique', nominees: [
      ['Kirinyaga Threads', 'Casual Wear'],
      ['Njeri Couture', 'Bridal'],
      ['Highland Fits', 'Menswear'],
      ['Mama Wanjiku Fabrics', 'Traditional'],
    ]},
    { id: 'gym', title: 'Best Gym / Fitness Coach', nominees: [
      ['Peak Kirinyaga Gym', 'Full Gym'],
      ['Coach Mwangi', 'Personal Trainer'],
      ['Highland Fit Club', 'Group Classes'],
      ['Warrior Fitness', 'Boxing'],
    ]},
    { id: 'youth', title: 'Youth Group of the Year', nominees: [
      ['Kirinyaga Youth SACCO', 'Finance'],
      ['Highland Green Warriors', 'Environment'],
      ['Kutus Rising', 'Empowerment'],
      ['Baricho Talents', 'Arts'],
    ]},
    { id: 'nurse', title: 'Nurse of the Year', nominees: [
      ['Sister Wangui', 'Kerugoya County Hospital'],
      ['Nurse Mwangi', 'Kianyaga Sub-County'],
      ['Sister Nyawira', 'Kimbimbi Hospital'],
      ['Nurse Muthoni', 'Kutus Health Centre'],
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
