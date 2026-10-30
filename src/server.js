'use strict';
const path = require('node:path');
const { openDb, backupDb } = require('./db');
const webpush = require('web-push');
const { createApp } = require('./app');
const { databaseConfig } = require('./config');
const { hashPassword, validatePassword } = require('./passwords');

const env = process.env;
const production = env.NODE_ENV === 'production';

(async () => {
  const cfg = databaseConfig(env);
  const db = await openDb(cfg.url, cfg.authToken);
  console.log(`Database: ${cfg.file ? cfg.file : new URL(cfg.url).host}`);

  // إنشاء حساب المدير الأول من متغيرات البيئة (مرة واحدة فقط، ولا توجد كلمة مرور في الكود).
  const hasManager = await db.get("SELECT 1 AS x FROM users WHERE role = 'manager'");
  if (!hasManager) {
    if (env.ADMIN_USERNAME && env.ADMIN_PASSWORD) {
      const err = validatePassword(env.ADMIN_PASSWORD);
      if (err) { console.error('ADMIN_PASSWORD:', err); process.exit(1); }
      await db.run(`INSERT INTO users (username, password_hash, full_name, role, created_at)
                    VALUES (?, ?, ?, 'manager', ?)`,
      env.ADMIN_USERNAME, hashPassword(env.ADMIN_PASSWORD), env.ADMIN_NAME || 'المدير', new Date().toISOString());
      console.log(`Created manager account "${env.ADMIN_USERNAME}". You can now remove ADMIN_PASSWORD from the environment.`);
    } else {
      console.warn('No manager account yet. Set ADMIN_USERNAME and ADMIN_PASSWORD, or run: npm run create-manager');
    }
  }

  const app = createApp(db, {
    push: await setupPush(db),
    secureCookie: env.COOKIE_SECURE ? env.COOKIE_SECURE === '1' : production,
    trustProxy: env.TRUST_PROXY ? (/^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY) : false,
    accuracyWarnM: Number(env.ACCURACY_WARN_M) || 100,
  });

  // نسخ احتياطي تلقائي للملف المحلي: عند التشغيل ثم كل 24 ساعة. (Turso لها استرجاع زمني خاص بها.)
  if (cfg.file) {
    const backupDir = env.BACKUP_DIR || path.join(path.dirname(path.resolve(cfg.file)), 'backups');
    const runBackup = async () => {
      try { console.log('Backup:', await backupDb(db, backupDir, Number(env.BACKUP_KEEP) || 14)); }
      catch (e) { console.error('Backup failed:', e.message); }
    };
    runBackup();
    setInterval(runBackup, 24 * 3600 * 1000).unref();
  }

  const port = Number(env.PORT) || 3000;
  const host = env.HOST || '0.0.0.0';
  app.listen(port, host, () => console.log(`Attendance app listening on http://localhost:${port}`));
})().catch((e) => {
  console.error('Startup failed:', e.message);
  process.exit(1);
});

// مفاتيح VAPID لإشعارات الهاتف: من متغيرات البيئة إن وُجدت، وإلا تُولَّد مرة واحدة وتُحفظ في قاعدة البيانات
// حتى تبقى ثابتة بين عمليات النشر (تغيّرها يُبطل اشتراكات الأجهزة).
async function setupPush(db) {
  let publicKey = env.VAPID_PUBLIC_KEY;
  let privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    const read = async () => {
      const row = await db.get("SELECT value FROM app_settings WHERE key = 'vapid'");
      return row ? JSON.parse(row.value) : null;
    };
    let keys = await read();
    if (!keys) {
      const k = webpush.generateVAPIDKeys();
      await db.run("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('vapid', ?)", JSON.stringify(k));
      keys = await read();
    }
    ({ publicKey, privateKey } = keys);
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT || 'mailto:attendance-app@example.com', publicKey, privateKey);
  return { publicKey, send: (subscription, payload) => webpush.sendNotification(subscription, payload, { TTL: 6 * 3600, urgency: 'high' }) };
}
