'use strict';
// قاعدة البيانات: SQLite المدمجة في Node (node:sqlite) — ملف دائم على القرص.
// القيود الأساسية مفروضة داخل قاعدة البيانات نفسها (قيود CHECK، فهرس فريد جزئي، ومشغّلات triggers)
// حتى لو تجاوز أحدٌ منطق الخادم.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0)
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(username) BETWEEN 3 AND 40),
  password_hash TEXT NOT NULL,
  full_name     TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
  role          TEXT NOT NULL CHECK (role IN ('employee', 'manager')),
  company_id    INTEGER REFERENCES companies(id),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at    TEXT NOT NULL,
  CHECK (role = 'manager' OR company_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- الأوقات نصوص ISO-8601 بتوقيت UTC (تنتهي بـ Z) وتُقارن نصيًا بشكل صحيح.
CREATE TABLE IF NOT EXISTS attendance (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  company_id    INTEGER NOT NULL REFERENCES companies(id),
  check_in_at   TEXT NOT NULL CHECK (check_in_at LIKE '____-__-__T__:__:__.___Z'),
  in_lat        REAL NOT NULL CHECK (in_lat BETWEEN -90 AND 90),
  in_lng        REAL NOT NULL CHECK (in_lng BETWEEN -180 AND 180),
  in_accuracy   REAL NOT NULL CHECK (in_accuracy >= 0),
  check_out_at  TEXT CHECK (check_out_at LIKE '____-__-__T__:__:__.___Z'),
  out_lat       REAL CHECK (out_lat BETWEEN -90 AND 90),
  out_lng       REAL CHECK (out_lng BETWEEN -180 AND 180),
  out_accuracy  REAL CHECK (out_accuracy >= 0),
  CHECK (
    (check_out_at IS NULL AND out_lat IS NULL AND out_lng IS NULL AND out_accuracy IS NULL)
    OR
    (check_out_at IS NOT NULL AND out_lat IS NOT NULL AND out_lng IS NOT NULL AND out_accuracy IS NOT NULL
     AND check_out_at >= check_in_at)
  )
);
CREATE INDEX IF NOT EXISTS attendance_user_time ON attendance(user_id, check_in_at);
CREATE INDEX IF NOT EXISTS attendance_time ON attendance(check_in_at);
-- جلسة مفتوحة واحدة فقط لكل موظف، حتى مع وصول طلبين في اللحظة نفسها.
CREATE UNIQUE INDEX IF NOT EXISTS attendance_one_open ON attendance(user_id) WHERE check_out_at IS NULL;

-- الدخول مسموح فقط لموظف نشط، وبشركته الحالية.
CREATE TRIGGER IF NOT EXISTS attendance_insert_guard BEFORE INSERT ON attendance
BEGIN
  SELECT RAISE(ABORT, 'attendance: user must be an active employee of this company')
  WHERE NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = NEW.user_id AND role = 'employee' AND active = 1 AND company_id = NEW.company_id
  );
END;

-- السجل المكتمل لا يُعدّل، وبيانات الدخول لا تُعدّل أبدًا؛ المسموح فقط إغلاق سجل مفتوح.
CREATE TRIGGER IF NOT EXISTS attendance_update_guard BEFORE UPDATE ON attendance
BEGIN
  SELECT RAISE(ABORT, 'attendance: completed records are immutable')
  WHERE OLD.check_out_at IS NOT NULL;
  SELECT RAISE(ABORT, 'attendance: check-in data is immutable')
  WHERE NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.company_id IS NOT OLD.company_id
     OR NEW.check_in_at IS NOT OLD.check_in_at OR NEW.in_lat IS NOT OLD.in_lat
     OR NEW.in_lng IS NOT OLD.in_lng OR NEW.in_accuracy IS NOT OLD.in_accuracy;
END;

CREATE TRIGGER IF NOT EXISTS attendance_delete_guard BEFORE DELETE ON attendance
BEGIN
  SELECT RAISE(ABORT, 'attendance: records cannot be deleted');
END;

-- الحسابات تُعطَّل ولا تُحذف، حتى تبقى السجلات مرتبطة بأصحابها.
CREATE TRIGGER IF NOT EXISTS users_delete_guard BEFORE DELETE ON users
BEGIN
  SELECT RAISE(ABORT, 'users: deactivate accounts instead of deleting them');
END;
`;

// ترحيلات مرقّمة (PRAGMA user_version). أضف أي تغيير مستقبلي في الجدول كعنصر جديد في آخر القائمة.
const MIGRATIONS = [
  // 1: شعار لكل شركة
  `ALTER TABLE companies ADD COLUMN logo TEXT;
   UPDATE companies SET logo = 'company-' || id || '.png' WHERE id IN (1, 2) AND logo IS NULL;`,
];

function migrate(db) {
  let version = db.prepare('PRAGMA user_version').get().user_version;
  for (; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

function openDb(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);

  const count = db.prepare('SELECT COUNT(*) AS n FROM companies').get().n;
  if (count === 0) {
    const ins = db.prepare('INSERT INTO companies (name) VALUES (?)');
    ins.run(process.env.COMPANY_1_NAME || 'شركة التيسير');
    ins.run(process.env.COMPANY_2_NAME || 'اتحاد مقاولين المياه');
  }
  migrate(db);
  return db;
}

// نسخة احتياطية يومية متسقة (VACUUM INTO) مع الاحتفاظ بآخر `keep` نسخة.
function backupDb(db, dir, keep = 14) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `attendance-${stamp}.db`);
  if (!fs.existsSync(file)) db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const old = fs.readdirSync(dir).filter((f) => /^attendance-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -keep);
  for (const f of old) fs.rmSync(path.join(dir, f));
  return file;
}

module.exports = { openDb, backupDb };
