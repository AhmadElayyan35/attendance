'use strict';
// قاعدة البيانات: SQLite عبر libSQL — ملف محلي (file:...) أو قاعدة سحابية على Turso (libsql://...).
// القيود الأساسية مفروضة داخل قاعدة البيانات نفسها (قيود CHECK، فهرس فريد جزئي، ومشغّلات triggers)
// حتى لو تجاوز أحدٌ منطق الخادم.
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@libsql/client');

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

// ترحيلات مرقّمة. أضف أي تغيير مستقبلي في الجداول كعنصر جديد (قائمة جمل SQL) في آخر القائمة.
const MIGRATIONS = [
  // 1: شعار لكل شركة
  [
    'ALTER TABLE companies ADD COLUMN logo TEXT',
    "UPDATE companies SET logo = 'company-' || id || '.png' WHERE id IN (1, 2) AND logo IS NULL",
  ],
  // 2: موقع مكتب كل شركة ونطاقه بالمتر (لتقدير داخل/خارج المكتب)
  [
    'ALTER TABLE companies ADD COLUMN office_lat REAL',
    'ALTER TABLE companies ADD COLUMN office_lng REAL',
    'ALTER TABLE companies ADD COLUMN office_radius_m REAL',
    // شركة التيسير — شويكة، طولكرم (مكتب ~150 م²)
    'UPDATE companies SET office_lat = 32.3192253, office_lng = 35.0257683, office_radius_m = 50 WHERE id = 1 AND office_lat IS NULL',
    // اتحاد مقدمي خدمات المياه — البالوع، البيرة (مكتب ~140 م²)
    'UPDATE companies SET office_lat = 31.914379, office_lng = 35.209045, office_radius_m = 50 WHERE id = 2 AND office_lat IS NULL',
  ],
];

// غلاف بسيط يعيد صفوفًا كائنات عادية.
function wrap(client, url) {
  const toObjects = (r) => r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])));
  return {
    url,
    isLocalFile: url.startsWith('file:'),
    async get(sql, ...args) { return toObjects(await client.execute({ sql, args }))[0]; },
    async all(sql, ...args) { return toObjects(await client.execute({ sql, args })); },
    async run(sql, ...args) {
      const r = await client.execute({ sql, args });
      return { changes: r.rowsAffected, lastInsertRowid: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid) };
    },
    exec(sql) { return client.executeMultiple(sql); },
    batch(statements) { return client.batch(statements, 'write'); },
    close() { client.close(); },
  };
}

async function migrate(db) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  let row = await db.get('SELECT version FROM schema_version');
  if (!row) {
    // قواعد بيانات أنشأتها نسخ سابقة كانت تحفظ الرقم في PRAGMA user_version
    let legacy = 0;
    try { legacy = (await db.get('PRAGMA user_version'))?.user_version || 0; } catch { /* غير مدعوم */ }
    await db.run('INSERT INTO schema_version (version) VALUES (?)', legacy);
    row = { version: legacy };
  }
  for (let v = row.version; v < MIGRATIONS.length; v++) {
    // كل ترحيل يُطبّق كاملًا أو لا يُطبّق (معاملة واحدة)
    await db.batch([...MIGRATIONS[v], { sql: 'UPDATE schema_version SET version = ?', args: [v + 1] }]);
  }
}

// url: "file:./data/attendance.db" أو "libsql://<db>.turso.io" (مع authToken)
async function openDb(url, authToken) {
  if (url.startsWith('file:')) {
    const file = url.slice('file:'.length);
    if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  const db = wrap(createClient({ url, authToken }), url);
  if (db.isLocalFile) await db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  await db.exec('PRAGMA foreign_keys = ON;');
  await db.exec(SCHEMA);

  const count = (await db.get('SELECT COUNT(*) AS n FROM companies')).n;
  if (count === 0) {
    await db.run('INSERT INTO companies (name) VALUES (?)', process.env.COMPANY_1_NAME || 'شركة التيسير');
    await db.run('INSERT INTO companies (name) VALUES (?)', process.env.COMPANY_2_NAME || 'اتحاد مقاولين المياه');
  }
  await migrate(db);
  return db;
}

// نسخة احتياطية يومية متسقة (VACUUM INTO) لقاعدة البيانات المحلية، مع الاحتفاظ بآخر `keep` نسخة.
// قاعدة Turso السحابية لها استرجاع زمني خاص بها، فلا تحتاج هذا.
async function backupDb(db, dir, keep = 14) {
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const file = path.join(dir, `attendance-${stamp}.db`);
  if (!fs.existsSync(file)) await db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const old = fs.readdirSync(dir).filter((f) => /^attendance-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -keep);
  for (const f of old) fs.rmSync(path.join(dir, f));
  return file;
}

module.exports = { openDb, backupDb };
