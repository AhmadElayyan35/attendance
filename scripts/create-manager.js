'use strict';
// إنشاء حساب مدير أو إعادة تعيين كلمة مروره من سطر الأوامر على الخادم.
// الاستخدام: npm run create-manager
const readline = require('node:readline');
const { openDb } = require('../src/db');
const { hashPassword, validatePassword } = require('../src/passwords');

(async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (prompt) => { process.stdout.write(prompt); const r = await lines.next(); return r.done ? '' : r.value; };
  const username = (await ask('Manager username: ')).trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) { console.error('Invalid username'); process.exit(1); }
  const fullName = (await ask('Display name [المدير]: ')).trim() || 'المدير';
  const password = await ask('Password (min 8 chars): ');
  rl.close();
  const err = validatePassword(password);
  if (err) { console.error('Password must be at least 8 characters'); process.exit(1); }

  const db = openDb(process.env.DB_PATH || './data/attendance.db');
  const existing = db.prepare('SELECT id, role FROM users WHERE username = ?').get(username);
  if (existing && existing.role !== 'manager') { console.error('That username belongs to an employee'); process.exit(1); }
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ?, full_name = ?, active = 1 WHERE id = ?')
      .run(hashPassword(password), fullName, existing.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
    console.log(`Updated manager "${username}".`);
  } else {
    db.prepare(`INSERT INTO users (username, password_hash, full_name, role, created_at)
                VALUES (?, ?, ?, 'manager', ?)`)
      .run(username, hashPassword(password), fullName, new Date().toISOString());
    console.log(`Created manager "${username}".`);
  }
})();
