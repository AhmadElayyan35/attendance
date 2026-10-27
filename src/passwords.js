'use strict';
// تجزئة كلمات المرور بـ scrypt من مكتبة crypto المدمجة (بدون مكتبات أصلية).
const crypto = require('node:crypto');

const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, PARAMS);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, PARAMS);
  return crypto.timingSafeEqual(actual, expected);
}

// تُستخدم عند عدم وجود المستخدم حتى لا يكشف زمن الاستجابة وجود الاسم.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'كلمة المرور يجب أن تكون 8 أحرف على الأقل';
  if (pw.length > 200) return 'كلمة المرور طويلة جدًا';
  return null;
}

module.exports = { hashPassword, verifyPassword, DUMMY_HASH, validatePassword };
