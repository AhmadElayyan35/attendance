'use strict';
// مكان قاعدة البيانات: DATABASE_URL (مثل libsql://xxx.turso.io مع DATABASE_AUTH_TOKEN)،
// وإلا ملف محلي من DB_PATH (افتراضيًا ./data/attendance.db).
function databaseConfig(env = process.env) {
  const file = env.DB_PATH || './data/attendance.db';
  return {
    url: env.DATABASE_URL || `file:${file}`,
    authToken: env.DATABASE_AUTH_TOKEN || undefined,
    file: env.DATABASE_URL ? null : file,
  };
}

module.exports = { databaseConfig };
