'use strict';
const path = require('node:path');
const { openDb, backupDb } = require('./db');
const { createApp } = require('./app');
const { hashPassword, validatePassword } = require('./passwords');

const env = process.env;
const production = env.NODE_ENV === 'production';
const db = openDb(env.DB_PATH || './data/attendance.db');

// إنشاء حساب المدير الأول من متغيرات البيئة (مرة واحدة فقط، ولا توجد كلمة مرور في الكود).
const hasManager = db.prepare("SELECT 1 FROM users WHERE role = 'manager'").get();
if (!hasManager) {
  if (env.ADMIN_USERNAME && env.ADMIN_PASSWORD) {
    const err = validatePassword(env.ADMIN_PASSWORD);
    if (err) { console.error('ADMIN_PASSWORD:', err); process.exit(1); }
    db.prepare(`INSERT INTO users (username, password_hash, full_name, role, created_at)
                VALUES (?, ?, ?, 'manager', ?)`)
      .run(env.ADMIN_USERNAME, hashPassword(env.ADMIN_PASSWORD), env.ADMIN_NAME || 'المدير', new Date().toISOString());
    console.log(`Created manager account "${env.ADMIN_USERNAME}". You can now remove ADMIN_PASSWORD from the environment.`);
  } else {
    console.warn('No manager account yet. Set ADMIN_USERNAME and ADMIN_PASSWORD, or run: npm run create-manager');
  }
}

const app = createApp(db, {
  secureCookie: env.COOKIE_SECURE ? env.COOKIE_SECURE === '1' : production,
  trustProxy: env.TRUST_PROXY ? (/^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY) : false,
  accuracyWarnM: Number(env.ACCURACY_WARN_M) || 100,
});

// نسخ احتياطي تلقائي: عند التشغيل ثم كل 24 ساعة (BACKUP_DIR بجانب قاعدة البيانات افتراضيًا).
const backupDir = env.BACKUP_DIR || path.join(path.dirname(path.resolve(env.DB_PATH || './data/attendance.db')), 'backups');
const runBackup = () => {
  try { console.log('Backup:', backupDb(db, backupDir, Number(env.BACKUP_KEEP) || 14)); }
  catch (e) { console.error('Backup failed:', e.message); }
};
runBackup();
setInterval(runBackup, 24 * 3600 * 1000).unref();

const port = Number(env.PORT) || 3000;
const host = env.HOST || '0.0.0.0';
app.listen(port, host, () => console.log(`Attendance app listening on http://localhost:${port}`));
