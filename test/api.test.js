'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');
const { hashPassword } = require('../src/passwords');
const T = require('../src/time');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-test-'));
const db = openDb(path.join(dir, 'test.db'));
let base, server;
const LOC = { lat: 31.5326, lng: 35.0998, accuracy: 12.4 };

test.before(async () => {
  db.prepare(`INSERT INTO users (username, password_hash, full_name, role, created_at) VALUES ('boss', ?, 'المدير', 'manager', ?)`)
    .run(hashPassword('boss-pass-123'), new Date().toISOString());
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function call(method, url, { cookie, body, headers = {} } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* csv */ }
  return { status: res.status, json, text, headers: res.headers };
}
async function login(username, password) {
  const r = await call('POST', '/api/login', { body: { username, password } });
  assert.equal(r.status, 200, `login ${username}: ${r.text}`);
  return r.headers.get('set-cookie').split(';')[0];
}

let mgr, emp1, emp2, emp1Id, emp2Id;

test('login: wrong password rejected, manager login works', async () => {
  assert.equal((await call('POST', '/api/login', { body: { username: 'boss', password: 'nope-nope' } })).status, 401);
  assert.equal((await call('POST', '/api/login', { body: { username: 'ghost', password: 'whatever1' } })).status, 401);
  mgr = await login('boss', 'boss-pass-123');
  const me = await call('GET', '/api/me', { cookie: mgr });
  assert.equal(me.json.user.role, 'manager');
});

test('manager creates employees in both companies', async () => {
  const ov = await call('GET', '/api/admin/overview', { cookie: mgr });
  assert.equal(ov.json.companies.length, 2);
  const [c1, c2] = ov.json.companies;
  let r = await call('POST', '/api/admin/users', { cookie: mgr, body: { full_name: 'أحمد', username: 'ahmad', password: 'pass-1234', company_id: c1.id } });
  assert.equal(r.status, 201); emp1Id = r.json.id;
  r = await call('POST', '/api/admin/users', { cookie: mgr, body: { full_name: 'سارة', username: 'sara', password: 'pass-5678', company_id: c2.id } });
  assert.equal(r.status, 201); emp2Id = r.json.id;
  r = await call('POST', '/api/admin/users', { cookie: mgr, body: { full_name: 'مكرر', username: 'AHMAD', password: 'pass-1234', company_id: c1.id } });
  assert.equal(r.status, 409, 'duplicate username (case-insensitive)');
  r = await call('POST', '/api/admin/users', { cookie: mgr, body: { full_name: 'قصير', username: 'shorty', password: '123', company_id: c1.id } });
  assert.equal(r.status, 400, 'weak password');
  emp1 = await login('ahmad', 'pass-1234');
  emp2 = await login('sara', 'pass-5678');
});

test('permissions are enforced on the server', async () => {
  assert.equal((await call('GET', '/api/admin/overview')).status, 401);
  assert.equal((await call('GET', '/api/my/records')).status, 401);
  assert.equal((await call('GET', '/api/admin/overview', { cookie: emp1 })).status, 403);
  assert.equal((await call('GET', '/api/admin/records', { cookie: emp1 })).status, 403);
  assert.equal((await call('GET', '/api/admin/records.xlsx', { cookie: emp1 })).status, 403);
  assert.equal((await call('POST', '/api/admin/users', { cookie: emp1, body: { full_name: 'x', username: 'xxx', password: 'pass-1234', company_id: 1 } })).status, 403);
  assert.equal((await call('PATCH', `/api/admin/users/${emp1Id}`, { cookie: emp1, body: { company_id: 2 } })).status, 403);
  assert.equal((await call('POST', '/api/my/check-in', { cookie: mgr, body: LOC })).status, 403, 'manager has no attendance');
  const forged = await call('POST', '/api/my/check-in', { cookie: emp1, body: LOC, headers: { Origin: 'https://evil.example' } });
  assert.equal(forged.status, 403, 'cross-origin POST blocked');
  const formPost = await fetch(base + '/api/my/check-in', { method: 'POST', headers: { Cookie: emp1, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'lat=1&lng=1&accuracy=1' });
  assert.equal(formPost.status, 415, 'non-JSON POST blocked');
});

test('check-out without an open check-in is refused', async () => {
  const r = await call('POST', '/api/my/check-out', { cookie: emp1, body: LOC });
  assert.equal(r.status, 409);
});

test('missing or invalid location saves nothing', async () => {
  for (const body of [{}, { lat: 31, lng: 35 }, { lat: 'x', lng: 35, accuracy: 5 }, { lat: 91, lng: 35, accuracy: 5 }]) {
    assert.equal((await call('POST', '/api/my/check-in', { cookie: emp1, body })).status, 400);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance').get().n, 0);
});

test('check-in uses server time and own company; client cannot override', async () => {
  const before = Date.now();
  const r = await call('POST', '/api/my/check-in', { cookie: emp1, body: { ...LOC, check_in_at: '2000-01-01T00:00:00.000Z', company_id: 2, user_id: emp2Id } });
  assert.equal(r.status, 201);
  const t = Date.parse(r.json.record.check_in_at);
  assert.ok(t >= before - 1000 && t <= Date.now() + 1000, 'server time used');
  assert.equal(r.json.record.user_id, emp1Id);
  assert.equal(r.json.record.company_id, 1);
  assert.equal(db.prepare('SELECT in_accuracy FROM attendance WHERE id = ?').get(r.json.record.id).in_accuracy, 12.4, 'accuracy stored for the manager');
  assert.equal(r.json.record.status, 'open');
  const me = await call('GET', '/api/me', { cookie: emp1 });
  assert.equal(me.json.open_record.id, r.json.record.id);
});

test('concurrent duplicate check-ins create exactly one open record', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, () => call('POST', '/api/my/check-in', { cookie: emp2, body: LOC })));
  const codes = results.map((r) => r.status).sort();
  assert.equal(codes.filter((c) => c === 201).length, 1, codes.join(','));
  assert.equal(codes.filter((c) => c === 409).length, 7);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance WHERE user_id = ? AND check_out_at IS NULL').get(emp2Id).n, 1);
});

test('concurrent check-outs close the record exactly once', async () => {
  const results = await Promise.all(Array.from({ length: 6 }, () => call('POST', '/api/my/check-out', { cookie: emp2, body: { lat: 31.9, lng: 35.2, accuracy: 250 } })));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  const ok = results.find((r) => r.status === 200).json.record;
  assert.equal(ok.status, 'completed');
  assert.equal(db.prepare('SELECT out_accuracy FROM attendance WHERE id = ?').get(ok.id).out_accuracy, 250);
  assert.ok(ok.check_out_at >= ok.check_in_at);
  // جلسة ثانية في اليوم نفسه مسموحة
  assert.equal((await call('POST', '/api/my/check-in', { cookie: emp2, body: LOC })).status, 201);
  assert.equal((await call('POST', '/api/my/check-out', { cookie: emp2, body: LOC })).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM attendance WHERE user_id = ?').get(emp2Id).n, 2);
});

test('employees see only their own records', async () => {
  const r1 = await call('GET', '/api/my/records', { cookie: emp1 });
  const r2 = await call('GET', '/api/my/records', { cookie: emp2 });
  assert.ok(r1.json.records.length >= 1 && r1.json.records.every((r) => r.user_id === emp1Id));
  assert.ok(r2.json.records.length === 2 && r2.json.records.every((r) => r.user_id === emp2Id));
});

test('database rejects edits, deletes and a second open record', () => {
  const done = db.prepare('SELECT * FROM attendance WHERE check_out_at IS NOT NULL LIMIT 1').get();
  assert.throws(() => db.prepare('UPDATE attendance SET check_out_at = ? WHERE id = ?').run('2030-01-01T00:00:00.000Z', done.id), /immutable/);
  assert.throws(() => db.prepare('DELETE FROM attendance WHERE id = ?').run(done.id), /cannot be deleted/);
  const open = db.prepare('SELECT * FROM attendance WHERE check_out_at IS NULL LIMIT 1').get();
  assert.throws(() => db.prepare('UPDATE attendance SET check_in_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', open.id), /immutable/);
  assert.throws(() => db.prepare('INSERT INTO attendance (user_id, company_id, check_in_at, in_lat, in_lng, in_accuracy) VALUES (?, 1, ?, 1, 1, 1)')
    .run(open.user_id, new Date().toISOString()), /UNIQUE/);
  assert.throws(() => db.prepare('INSERT INTO attendance (user_id, company_id, check_in_at, in_lat, in_lng, in_accuracy) VALUES (?, 1, ?, 1, 1, 1)')
    .run(emp2Id, new Date().toISOString()), /active employee of this company/, 'wrong company');
  assert.throws(() => db.prepare('DELETE FROM users WHERE id = ?').run(emp1Id), /deactivate/);
});

test('duration across midnight, Hebron dates, and totals exclude open records', async () => {
  // سجلات تاريخية تُدخل مباشرة (وقت شتوي: Asia/Hebron = UTC+2)
  const ins = db.prepare('INSERT INTO attendance (user_id, company_id, check_in_at, in_lat, in_lng, in_accuracy) VALUES (?, ?, ?, 31.5, 35.1, 8)');
  const close = db.prepare('UPDATE attendance SET check_out_at = ?, out_lat = 31.5, out_lng = 35.1, out_accuracy = 9 WHERE id = ?');
  // 2026-01-14 21:30 محليًا → 2026-01-15 02:15 محليًا = 4س 45د
  const a = ins.run(emp2Id, 2, '2026-01-14T19:30:00.000Z').lastInsertRowid; close.run('2026-01-15T00:15:00.000Z', a);
  // 2026-01-15 00:30 محليًا (ما زال 14 يناير بتوقيت UTC) → 08:00 = 7س 30د
  const b = ins.run(emp2Id, 2, '2026-01-14T22:30:00.000Z').lastInsertRowid; close.run('2026-01-15T06:00:00.000Z', b);

  assert.equal(T.durationMinutes('2026-01-14T19:30:00.000Z', '2026-01-15T00:15:00.000Z'), 285);
  assert.equal(T.localDate('2026-01-14T22:30:00.000Z'), '2026-01-15');
  assert.equal(T.localMidnightToUtc('2026-01-15').toISOString(), '2026-01-14T22:00:00.000Z');
  assert.equal(T.localMidnightToUtc('2026-07-15').toISOString(), '2026-07-14T21:00:00.000Z', 'summer time UTC+3');

  let r = await call('GET', `/api/admin/records?employee=${emp2Id}&from=2026-01-14&to=2026-01-14`, { cookie: mgr });
  assert.deepEqual(r.json.records.map((x) => x.id), [Number(a)]);
  assert.equal(r.json.records[0].duration_minutes, 285);
  assert.equal(r.json.records[0].shift_date, '2026-01-14');

  r = await call('GET', `/api/admin/records?employee=${emp2Id}&from=2026-01-15&to=2026-01-15`, { cookie: mgr });
  assert.deepEqual(r.json.records.map((x) => x.id), [Number(b)]);
  assert.equal(r.json.records[0].duration_minutes, 450);

  r = await call('GET', `/api/admin/records?employee=${emp2Id}&from=2026-01-01&to=2026-01-31&status=completed`, { cookie: mgr });
  assert.equal(r.json.totals[0].completed_minutes, 285 + 450);

  // emp1 لديه سجل مفتوح: يظهر لكن لا يُجمع
  r = await call('GET', `/api/admin/records?employee=${emp1Id}`, { cookie: mgr });
  assert.equal(r.json.records[0].status, 'open');
  assert.equal(r.json.records[0].duration_minutes, null);
  assert.equal(r.json.totals[0].completed_minutes, 0);
  assert.equal(r.json.totals[0].open_count, 1);

  r = await call('GET', '/api/admin/records?company=1', { cookie: mgr });
  assert.ok(r.json.records.every((x) => x.company_id === 1));
  assert.equal((await call('GET', '/api/admin/records?from=yesterday', { cookie: mgr })).status, 400);
});

test('overview counts who is currently checked in', async () => {
  const r = await call('GET', '/api/admin/overview', { cookie: mgr });
  assert.equal(r.json.present_count, 1);
  assert.equal(r.json.employees.find((e) => e.id === emp1Id).open_record != null, true);
  assert.equal(r.json.employees.find((e) => e.id === emp2Id).open_record, null);
});

test('Excel export: RTL sheet with times and duration only, plus totals sheet', async () => {
  const ExcelJS = require('exceljs');
  const res = await fetch(`${base}/api/admin/records.xlsx?employee=${emp2Id}&from=2026-01-14&to=2026-01-15`, { headers: { Cookie: mgr } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /spreadsheetml/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()));
  const ws = wb.getWorksheet('الحضور');
  assert.equal(ws.views[0].rightToLeft, true);
  const rows = [];
  ws.eachRow((row) => rows.push(row.values.slice(1)));
  assert.deepEqual(rows[0], ['الموظف', 'الشركة', 'التاريخ', 'وقت الدخول', 'وقت الخروج', 'مدة العمل', 'الحالة']);
  assert.equal(rows.length, 3);
  // دوام عبر منتصف الليل: 9:30 م → 2:15 ص في اليوم التالي = 4 س 45 د
  assert.deepEqual(rows[2], ['سارة', 'اتحاد مقاولين المياه', '2026-01-14', '9:30 م', '2:15 ص (2026-01-15)', '4 س 45 د', 'مكتمل']);
  const totals = [];
  wb.getWorksheet('مجموع الساعات').eachRow((row) => totals.push(row.values.slice(1)));
  assert.deepEqual(totals[1], ['سارة', 'اتحاد مقاولين المياه', 2, '12 س 15 د']);
});

test('employees see only times — no location, accuracy or durations', async () => {
  const r = await call('GET', '/api/my/records', { cookie: emp2 });
  assert.ok(r.json.records.length > 0);
  for (const rec of r.json.records) {
    assert.deepEqual(Object.keys(rec).sort(), ['check_in_at', 'check_out_at', 'company_id', 'id', 'status', 'user_id']);
  }
  const me = await call('GET', '/api/me', { cookie: emp1 });
  assert.equal(me.json.open_record.in_lat, undefined);
  assert.equal(me.json.accuracy_warn_m, undefined);
  assert.equal((await call('GET', '/api/my/records.csv', { cookie: emp2 })).status, 404, 'no employee export');
});

test('multiple managers: add, both see everything, safe deactivation', async () => {
  let r = await call('POST', '/api/admin/users', { cookie: mgr, body: { role: 'manager', full_name: 'مدير ثانٍ', username: 'boss2', password: 'boss2-pass-1' } });
  assert.equal(r.status, 201);
  const boss2Id = r.json.id;
  const mgr2 = await login('boss2', 'boss2-pass-1');
  r = await call('GET', '/api/admin/overview', { cookie: mgr2 });
  assert.equal(r.status, 200);
  assert.equal(r.json.managers.length, 2);
  assert.equal(r.json.employees.length, 2);
  // لا يمكن إيقاف النفس، ولا ربط المدير بشركة
  assert.equal((await call('PATCH', `/api/admin/users/${boss2Id}`, { cookie: mgr2, body: { active: false } })).status, 400);
  assert.equal((await call('PATCH', `/api/admin/users/${boss2Id}`, { cookie: mgr, body: { company_id: 1 } })).status, 400);
  // مدير يوقف الآخر → تنتهي جلسته
  assert.equal((await call('PATCH', `/api/admin/users/${boss2Id}`, { cookie: mgr, body: { active: false } })).status, 200);
  assert.equal((await call('GET', '/api/admin/overview', { cookie: mgr2 })).status, 401);
  // المدير الوحيد المتبقي لا يمكن إيقافه
  const bossId = db.prepare("SELECT id FROM users WHERE username = 'boss'").get().id;
  assert.equal((await call('PATCH', `/api/admin/users/${bossId}`, { cookie: mgr, body: { active: false } })).status, 400);
  // موظف لا يستطيع إنشاء مدير
  assert.equal((await call('POST', '/api/admin/users', { cookie: emp1, body: { role: 'manager', full_name: 'x', username: 'hack', password: 'hack-pass-1' } })).status, 403);
});

test('daily backup creates a readable copy and prunes old ones', () => {
  const { backupDb } = require('../src/db');
  const bdir = path.join(dir, 'backups');
  fs.mkdirSync(bdir, { recursive: true });
  for (const d of ['2020-01-01', '2020-01-02', '2020-01-03']) fs.writeFileSync(path.join(bdir, `attendance-${d}.db`), '');
  const file = backupDb(db, bdir, 2);
  const copy = openDb(file);
  assert.ok(copy.prepare('SELECT COUNT(*) n FROM attendance').get().n > 0);
  copy.close();
  assert.deepEqual(fs.readdirSync(bdir).filter((f) => f.endsWith('.db')).sort(), ['attendance-2020-01-03.db', path.basename(file)]);
});

test('editing and disabling an employee keeps their records', async () => {
  let r = await call('PATCH', `/api/admin/users/${emp2Id}`, { cookie: mgr, body: { full_name: 'سارة محمد', company_id: 1 } });
  assert.equal(r.status, 200);
  r = await call('GET', `/api/admin/records?employee=${emp2Id}&from=2026-01-14&to=2026-01-15`, { cookie: mgr });
  assert.equal(r.json.records[0].employee_name, 'سارة محمد');
  assert.equal(r.json.records[0].company_name, 'اتحاد مقاولين المياه', 'old records keep the company at the time');

  r = await call('PATCH', `/api/admin/users/${emp2Id}`, { cookie: mgr, body: { active: false } });
  assert.equal(r.status, 200);
  assert.equal((await call('GET', '/api/me', { cookie: emp2 })).status, 401, 'existing session revoked');
  assert.equal((await call('POST', '/api/login', { body: { username: 'sara', password: 'pass-5678' } })).status, 403);
  r = await call('GET', `/api/admin/records?employee=${emp2Id}`, { cookie: mgr });
  assert.equal(r.json.records.length, 4);
  assert.equal((await call('PATCH', '/api/admin/users/9999', { cookie: mgr, body: { active: false } })).status, 404);
});

test('manager can rename themselves', async () => {
  const me = await call('GET', '/api/me', { cookie: mgr });
  assert.equal((await call('PATCH', `/api/admin/users/${me.json.user.id}`, { cookie: mgr, body: { full_name: 'علي عودة' } })).status, 200);
  assert.equal((await call('GET', '/api/me', { cookie: mgr })).json.user.full_name, 'علي عودة');
});

test('installable app files are served', async () => {
  const m = await fetch(base + '/manifest.webmanifest');
  assert.equal(m.status, 200);
  assert.match(m.headers.get('content-type'), /manifest\+json/);
  const manifest = await m.json();
  assert.equal(manifest.display, 'standalone');
  for (const ic of manifest.icons) assert.equal((await fetch(base + ic.src)).status, 200, ic.src);
  const sw = await fetch(base + '/sw.js');
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(base + '/icons/apple-touch-icon.png')).status, 200);
});

test('logout ends the session', async () => {
  await call('POST', '/api/logout', { cookie: emp1, body: {} });
  assert.equal((await call('GET', '/api/me', { cookie: emp1 })).status, 401);
});
