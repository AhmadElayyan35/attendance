'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const ExcelJS = require('exceljs');
const { hashPassword, verifyPassword, DUMMY_HASH, validatePassword } = require('./passwords');
const T = require('./time');
const { classifyPlace } = require('./geo');
const { deleteEmployee } = require('./db');

const SESSION_DAYS = 30;
const COOKIE = 'sid';
const USERNAME_RE = /^[A-Za-z0-9._-]{3,40}$/;
const MAX_ROWS = 5000;

function createApp(db, opts = {}) {
  const secureCookie = opts.secureCookie ?? false;
  const accuracyWarnM = opts.accuracyWarnM ?? 100;
  const push = opts.push || null; // { publicKey, send(subscription, payloadJson) } — Web Push
  // ساعات الدوام (بتوقيت مكان العمل) وأقصى مدة للمغادرة بالدقائق
  const leaveRules = { start: '09:00', end: '15:00', maxMinutes: 120, ...opts.leaveRules };
  const app = express();
  app.disable('x-powered-by');
  if (opts.trustProxy) app.set('trust proxy', opts.trustProxy);

  // يمرّر أخطاء المعالجات غير المتزامنة إلى معالج الأخطاء (Express 4 لا يفعل ذلك تلقائيًا).
  for (const method of ['get', 'post', 'patch', 'delete', 'use']) {
    const original = app[method].bind(app);
    app[method] = (...args) => {
      if (method === 'get' && args.length === 1) return original(...args); // app.get('setting')
      return original(...args.map((fn) => (typeof fn === 'function' && fn.constructor.name === 'AsyncFunction'
        ? (req, res, next) => fn(req, res, next).catch(next)
        : fn)));
    };
  }

  const q = {
    sessionUser: `
      SELECT u.id, u.username, u.full_name, u.role, u.company_id, u.reports_access, c.name AS company_name, c.logo AS company_logo
      FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN companies c ON c.id = u.company_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`,
    insertSession: 'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
    deleteSession: 'DELETE FROM sessions WHERE token_hash = ?',
    deleteUserSessions: 'DELETE FROM sessions WHERE user_id = ?',
    deleteExpired: 'DELETE FROM sessions WHERE expires_at <= ?',
    userByName: 'SELECT * FROM users WHERE username = ?',
    userById: 'SELECT * FROM users WHERE id = ?',
    activeManagers: "SELECT COUNT(*) AS n FROM users WHERE role = 'manager' AND active = 1",
    openRecord: 'SELECT * FROM attendance WHERE user_id = ? AND check_out_at IS NULL',
    checkIn: `INSERT INTO attendance (user_id, company_id, check_in_at, in_lat, in_lng, in_accuracy)
                         VALUES (?, ?, ?, ?, ?, ?)`,
    checkOut: `UPDATE attendance SET check_out_at = ?, out_lat = ?, out_lng = ?, out_accuracy = ?
                          WHERE user_id = ? AND check_out_at IS NULL`,
    recordById: 'SELECT * FROM attendance WHERE id = ?',
    myRecords: 'SELECT * FROM attendance WHERE user_id = ? ORDER BY check_in_at DESC LIMIT ?',
    companies: 'SELECT id, name, logo FROM companies ORDER BY id',
    companiesFull: 'SELECT id, name, logo, office_lat, office_lng, office_radius_m FROM companies ORDER BY id',
    companyById: 'SELECT id FROM companies WHERE id = ?',
    companyOffice: 'SELECT id, name, office_lat, office_lng, office_radius_m FROM companies WHERE id = ?',
    managerSubs: `SELECT s.* FROM push_subscriptions s JOIN users u ON u.id = s.user_id
                  WHERE u.role = 'manager' AND u.active = 1`,
    userSubs: 'SELECT * FROM push_subscriptions WHERE user_id = ?',
    saveSub: `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    deleteSub: 'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?',
    deleteSubById: 'DELETE FROM push_subscriptions WHERE id = ?',
    employees: `
      SELECT u.id, u.username, u.full_name, u.company_id, c.name AS company_name, c.logo AS company_logo, u.active, u.reports_access,
             a.id AS open_id, a.check_in_at AS open_check_in_at, a.in_lat AS open_in_lat,
             a.in_lng AS open_in_lng, a.in_accuracy AS open_in_accuracy,
             ac.office_lat, ac.office_lng, ac.office_radius_m,
             (SELECT MAX(COALESCE(check_out_at, check_in_at)) FROM attendance WHERE user_id = u.id) AS last_activity_at
      FROM users u JOIN companies c ON c.id = u.company_id
      LEFT JOIN attendance a ON a.user_id = u.id AND a.check_out_at IS NULL
      LEFT JOIN companies ac ON ac.id = a.company_id
      WHERE u.role = 'employee'
      ORDER BY u.active DESC, c.id, u.full_name`,
    managers: `SELECT id, username, full_name, active, created_at FROM users
                          WHERE role = 'manager' ORDER BY active DESC, full_name`,
    insertUser: `INSERT INTO users (username, password_hash, full_name, role, company_id, created_at)
                            VALUES (?, ?, ?, ?, ?, ?)`,
    updatePassword: 'UPDATE users SET password_hash = ? WHERE id = ?',
    // المغادرات
    leaveById: 'SELECT * FROM leave_requests WHERE id = ?',
    myLeaves: 'SELECT * FROM leave_requests WHERE user_id = ? ORDER BY starts_at DESC LIMIT 10',
    leaveOverlap: `SELECT 1 FROM leave_requests WHERE user_id = ? AND status IN ('pending', 'approved')
                   AND starts_at < ? AND COALESCE(returned_at, ends_at) > ? LIMIT 1`,
    insertLeave: `INSERT INTO leave_requests (user_id, company_id, starts_at, ends_at, reason, created_at)
                  VALUES (?, ?, ?, ?, ?, ?)`,
    cancelLeave: `UPDATE leave_requests SET status = 'cancelled'
                  WHERE id = ? AND user_id = ? AND (status = 'pending' OR (status = 'approved' AND starts_at > ?))`,
    returnLeave: `UPDATE leave_requests SET returned_at = ?, ret_lat = ?, ret_lng = ?, ret_accuracy = ?
                  WHERE id = ? AND user_id = ? AND status = 'approved' AND returned_at IS NULL AND starts_at <= ?`,
    decideLeave: `UPDATE leave_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'`,
    leavesFull: `
      SELECT l.*, u.full_name AS employee_name, c.name AS company_name,
             c.office_lat, c.office_lng, c.office_radius_m, d.full_name AS decided_by_name
      FROM leave_requests l JOIN users u ON u.id = l.user_id JOIN companies c ON c.id = l.company_id
      LEFT JOIN users d ON d.id = l.decided_by`,
    pendingLeaves: "SELECT COUNT(*) AS n FROM leave_requests WHERE status = 'pending'",
    onLeaveNow: `SELECT id, user_id, starts_at, ends_at FROM leave_requests
                 WHERE status = 'approved' AND returned_at IS NULL AND starts_at <= ? AND starts_at >= ?`,
  };

  // ---------- أمان عام ----------
  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
    });
    if (secureCookie) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  app.get('/api/health', async (req, res) => {
    await db.get('SELECT 1');
    res.json({ ok: true });
  });

  app.use('/api', express.json({ limit: '20kb' }));

  // حماية CSRF: الطلبات المغيِّرة يجب أن تكون JSON ومن نفس الأصل.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    if (!req.is('application/json')) return fail(res, 415, 'نوع الطلب غير مدعوم');
    const origin = req.get('origin');
    if (origin) {
      let originHost;
      try { originHost = new URL(origin).host; } catch { originHost = null; }
      const hosts = [req.get('host'), req.get('x-forwarded-host')].filter(Boolean);
      if (!hosts.includes(originHost)) return fail(res, 403, 'طلب من مصدر غير موثوق');
    }
    next();
  });

  app.use('/api', async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const token = readCookie(req, COOKIE);
    if (token) {
      req.user = await db.get(q.sessionUser, sha256(token), new Date().toISOString()) || null;
      req.sessionToken = token;
    }
    next();
  });

  const requireRole = (role) => (req, res, next) => {
    if (!req.user) return fail(res, 401, 'يرجى تسجيل الدخول');
    if (req.user.role !== role) return fail(res, 403, 'ليست لديك صلاحية لهذه العملية');
    next();
  };

  // ---------- المصادقة ----------
  const attempts = new Map(); // محاولات الدخول الفاشلة: key -> {count, first}
  const WINDOW = 15 * 60 * 1000;
  function tooMany(key, limit) {
    const a = attempts.get(key);
    if (!a || Date.now() - a.first > WINDOW) return false;
    return a.count >= limit;
  }
  function recordFail(key) {
    const a = attempts.get(key);
    if (!a || Date.now() - a.first > WINDOW) attempts.set(key, { count: 1, first: Date.now() });
    else a.count++;
  }

  app.post('/api/login', async (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const ipKey = `ip:${req.ip}`;
    const userKey = `u:${req.ip}:${username.toLowerCase()}`;
    if (tooMany(ipKey, 50) || tooMany(userKey, 8)) {
      return fail(res, 429, 'محاولات كثيرة. حاول مرة أخرى بعد 15 دقيقة');
    }
    const user = username ? await db.get(q.userByName, username) : null;
    const ok = verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) {
      recordFail(ipKey); recordFail(userKey);
      return fail(res, 401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
    }
    if (!user.active) return fail(res, 403, 'هذا الحساب موقوف. تواصل مع الإدارة');
    attempts.delete(userKey);

    const now = new Date();
    await db.run(q.deleteExpired, now.toISOString());
    const token = crypto.randomBytes(32).toString('base64url');
    const expires = new Date(now.getTime() + SESSION_DAYS * 864e5);
    await db.run(q.insertSession, sha256(token), user.id, now.toISOString(), expires.toISOString());
    res.cookie(COOKIE, token, {
      httpOnly: true, secure: secureCookie, sameSite: 'lax', path: '/', expires,
    });
    res.json({ ok: true, role: user.role });
  });

  app.post('/api/logout', async (req, res) => {
    if (req.sessionToken) await db.run(q.deleteSession, sha256(req.sessionToken));
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // الشعارات والأسماء متاحة لصفحة الدخول.
  app.get('/api/companies', async (req, res) => res.json({ companies: await db.all(q.companies) }));

  app.get('/api/me', async (req, res) => {
    if (!req.user) return fail(res, 401, 'يرجى تسجيل الدخول');
    const open = req.user.role === 'employee' ? await db.get(q.openRecord, req.user.id) : null;
    res.json({
      user: { ...req.user, reports_access: !!req.user.reports_access },
      leave_rules: req.user.role === 'employee' ? leaveRules : undefined,
      open_record: open ? employeeView(open) : null,
      server_now: new Date().toISOString(),
      timezone: T.WORK_TZ,
      accuracy_warn_m: req.user.role === 'manager' ? accuracyWarnM : undefined,
    });
  });

  app.post('/api/me/password', async (req, res) => {
    if (!req.user) return fail(res, 401, 'يرجى تسجيل الدخول');
    const { current, next: nextPw } = req.body || {};
    const row = await db.get(q.userById, req.user.id);
    if (!verifyPassword(String(current || ''), row.password_hash)) return fail(res, 400, 'كلمة المرور الحالية غير صحيحة');
    const err = validatePassword(nextPw);
    if (err) return fail(res, 400, err);
    await db.run(q.updatePassword, hashPassword(nextPw), req.user.id);
    res.json({ ok: true });
  });

  // ---------- الموظف (يرى أوقات دخوله وخروجه فقط؛ التفاصيل للإدارة) ----------
  const employee = requireRole('employee');

  app.post('/api/my/check-in', employee, async (req, res) => {
    const loc = parseLocation(req.body);
    if (loc.error) return fail(res, 400, loc.error);
    const now = new Date().toISOString(); // وقت الخادم هو المرجع الرسمي
    try {
      const r = await db.run(q.checkIn, req.user.id, req.user.company_id, now, loc.lat, loc.lng, loc.accuracy);
      const row = await db.get(q.recordById, r.lastInsertRowid);
      announce('in', req.user, row);
      res.status(201).json({ ok: true, record: employeeView(row) });
    } catch (e) {
      if (/UNIQUE/i.test(e.message)) return fail(res, 409, 'دوامك مسجّل بالفعل. سجّل خروجك أولًا');
      throw e;
    }
  });

  app.post('/api/my/check-out', employee, async (req, res) => {
    const loc = parseLocation(req.body);
    if (loc.error) return fail(res, 400, loc.error);
    const open = await db.get(q.openRecord, req.user.id);
    if (!open) return fail(res, 409, 'لم تسجّل دخولك بعد');
    const now = new Date().toISOString();
    // التحديث مشروط بأن يكون السجل ما زال مفتوحًا، فلا يُغلق مرتين حتى مع طلبين متزامنين.
    const r = await db.run(q.checkOut, now, loc.lat, loc.lng, loc.accuracy, req.user.id);
    if (r.changes !== 1) return fail(res, 409, 'لم تسجّل دخولك بعد');
    const row = await db.get(q.recordById, open.id);
    announce('out', req.user, row);
    res.json({ ok: true, record: employeeView(row) });
  });

  app.get('/api/my/records', employee, async (req, res) => {
    res.json({ records: (await db.all(q.myRecords, req.user.id, 10)).map(employeeView) });
  });

  // ---------- المغادرة: طلب ← موافقة المدير ← تسجيل العودة ----------
  app.get('/api/my/leaves', employee, async (req, res) => {
    const nowIso = new Date().toISOString();
    res.json({ leaves: (await db.all(q.myLeaves, req.user.id)).map((l) => employeeLeaveView(l, nowIso)) });
  });

  app.post('/api/my/leaves', employee, async (req, res) => {
    const b = req.body || {};
    const nowIso = new Date().toISOString();
    const todayLocal = T.localDate(nowIso);
    const date = String(b.date || '');
    const starts = T.localToUtc(date, String(b.from || ''));
    const ends = T.localToUtc(date, String(b.to || ''));
    if (!starts || !ends) return fail(res, 400, 'اختر اليوم ووقت البداية والنهاية');
    if (date < todayLocal || date > T.addDays(todayLocal, 30)) return fail(res, 400, 'يمكن طلب مغادرة لليوم أو خلال الثلاثين يومًا القادمة');
    if (ends <= starts) return fail(res, 400, 'وقت النهاية يجب أن يكون بعد وقت البداية');
    if (ends - starts > 12 * 3600e3) return fail(res, 400, 'المغادرة لا يمكن أن تزيد عن 12 ساعة');
    if (ends.toISOString() <= nowIso) return fail(res, 400, 'وقت المغادرة انتهى بالفعل');
    if (String(b.from) < leaveRules.start || String(b.to) > leaveRules.end) {
      return fail(res, 400, `المغادرة تكون خلال ساعات الدوام (${hm12(leaveRules.start)} – ${hm12(leaveRules.end)})`);
    }
    if (ends - starts > leaveRules.maxMinutes * 60e3) return fail(res, 400, `أقصى مدة للمغادرة ${T.formatDuration(leaveRules.maxMinutes)}`);
    const reason = String(b.reason ?? '').trim().replace(/\s+/g, ' ');
    if (reason.length > 200) return fail(res, 400, 'السبب طويل جدًا (حتى 200 حرف)');
    const s = starts.toISOString(), e = ends.toISOString();
    if (await db.get(q.leaveOverlap, req.user.id, e, s)) return fail(res, 409, 'لديك طلب مغادرة آخر في الوقت نفسه');
    const r = await db.run(q.insertLeave, req.user.id, req.user.company_id, s, e, reason || null, nowIso);
    const row = await db.get(q.leaveById, r.lastInsertRowid);
    announceLeave('request', req.user, row);
    res.status(201).json({ ok: true, leave: employeeLeaveView(row, nowIso) });
  });

  app.post('/api/my/leaves/:id/cancel', employee, async (req, res) => {
    const r = await db.run(q.cancelLeave, Number(req.params.id), req.user.id, new Date().toISOString());
    if (r.changes !== 1) return fail(res, 409, 'لا يمكن إلغاء هذا الطلب');
    announceLeave('cancel', req.user, await db.get(q.leaveById, Number(req.params.id)));
    res.json({ ok: true });
  });

  app.post('/api/my/leaves/:id/return', employee, async (req, res) => {
    const loc = parseLocation(req.body);
    if (loc.error) return fail(res, 400, loc.error);
    const id = Number(req.params.id);
    const nowIso = new Date().toISOString(); // وقت الخادم هو المرجع
    const r = await db.run(q.returnLeave, nowIso, loc.lat, loc.lng, loc.accuracy, id, req.user.id, nowIso);
    if (r.changes !== 1) return fail(res, 409, 'لا توجد مغادرة جارية لإنهائها');
    const row = await db.get(q.leaveById, id);
    announceLeave('return', req.user, row);
    res.json({ ok: true, leave: employeeLeaveView(row, nowIso) });
  });

  // ---------- الإدارة ----------
  const manager = requireRole('manager');
  // التقارير: المدير، أو موظف لديه صلاحية التقارير (مثل المحاسب) — قراءة وتصدير فقط.
  const reportsViewer = (req, res, next) => {
    if (!req.user) return fail(res, 401, 'يرجى تسجيل الدخول');
    if (req.user.role !== 'manager' && !req.user.reports_access) return fail(res, 403, 'ليست لديك صلاحية لهذه العملية');
    next();
  };

  // ما تحتاجه صفحة التقارير للفلاتر، لمن لديه صلاحية التقارير
  app.get('/api/reports/meta', reportsViewer, async (req, res) => {
    res.json({
      companies: await db.all(q.companies),
      employees: (await db.all(q.employees)).map((e) => ({ id: e.id, full_name: e.full_name, company_id: e.company_id, active: !!e.active })),
      server_now: new Date().toISOString(),
      accuracy_warn_m: accuracyWarnM,
    });
  });

  app.get('/api/admin/overview', manager, async (req, res) => {
    const employees = (await db.all(q.employees)).map(shapeEmployee);
    const nowIso = new Date().toISOString();
    const dayStart = T.localMidnightToUtc(T.localDate(nowIso)).toISOString();
    res.json({
      pending_leaves: (await db.get(q.pendingLeaves)).n,
      on_leave: await db.all(q.onLeaveNow, nowIso, dayStart),
      companies: await db.all(q.companiesFull),
      employees,
      managers: (await db.all(q.managers)).map((m) => ({ ...m, active: !!m.active })),
      me_id: req.user.id,
      present_count: employees.filter((e) => e.open_record).length,
      server_now: new Date().toISOString(),
      accuracy_warn_m: accuracyWarnM,
    });
  });

  app.get('/api/admin/records', reportsViewer, async (req, res) => {
    const f = parseFilters(req.query);
    if (f.error) return fail(res, 400, f.error);
    const records = await queryRecords(f);
    res.json({ records, totals: totalsByEmployee(records), truncated: records.length >= MAX_ROWS });
  });

  // المغادرات: ?status=pending|approved|rejected|cancelled و ?from/&to (حسب يوم المغادرة) و ?employee
  app.get('/api/admin/leaves', manager, async (req, res) => {
    const where = [];
    const vals = [];
    const status = String(req.query.status || '');
    if (status) {
      if (!['pending', 'approved', 'rejected', 'cancelled'].includes(status)) return fail(res, 400, 'حالة غير صحيحة');
      where.push('l.status = ?'); vals.push(status);
    }
    for (const [key, op, shift] of [['from', '>=', 0], ['to', '<', 1]]) {
      if (!req.query[key]) continue;
      const d = /^\d{4}-\d{2}-\d{2}$/.test(req.query[key]) ? T.localMidnightToUtc(T.addDays(req.query[key], shift)) : null;
      if (!d) return fail(res, 400, 'تاريخ غير صحيح');
      where.push(`l.starts_at ${op} ?`); vals.push(d.toISOString());
    }
    if (req.query.employee) { where.push('l.user_id = ?'); vals.push(Number(req.query.employee)); }
    const rows = await db.all(`${q.leavesFull} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY l.status = 'pending' DESC, l.starts_at DESC LIMIT 500`, ...vals);
    const nowIso = new Date().toISOString();
    res.json({ leaves: rows.map((l) => shapeLeave(l, nowIso)) });
  });

  app.post('/api/admin/leaves/:id/decision', manager, async (req, res) => {
    const approve = req.body?.approve;
    if (typeof approve !== 'boolean') return fail(res, 400, 'اختر قبول أو رفض');
    const id = Number(req.params.id);
    const r = await db.run(q.decideLeave, approve ? 'approved' : 'rejected', req.user.id, new Date().toISOString(), id);
    if (r.changes !== 1) {
      return (await db.get(q.leaveById, id)) ? fail(res, 409, 'تم البت في هذا الطلب مسبقًا') : fail(res, 404, 'الطلب غير موجود');
    }
    const row = await db.get(q.leaveById, id);
    announceLeave(approve ? 'approved' : 'rejected', await db.get(q.userById, row.user_id), row);
    res.json({ ok: true });
  });

  app.get('/api/admin/records.xlsx', reportsViewer, async (req, res, next) => {
    const f = parseFilters(req.query);
    if (f.error) return fail(res, 400, f.error);
    try { await sendXlsx(res, await queryRecords(f)); } catch (e) { next(e); }
  });

  // إضافة موظف أو مدير. الموظف يجب أن ينتمي لشركة؛ المدير يرى كل الشركات.
  app.post('/api/admin/users', manager, async (req, res) => {
    const b = req.body || {};
    const role = b.role === 'manager' ? 'manager' : 'employee';
    const fullName = cleanName(b.full_name);
    const username = String(b.username || '').trim();
    if (!fullName) return fail(res, 400, 'الاسم مطلوب (حتى 80 حرفًا)');
    if (!USERNAME_RE.test(username)) return fail(res, 400, 'اسم المستخدم 3–40 حرفًا إنجليزيًا أو أرقامًا أو . _ -');
    let companyId = null;
    if (role === 'employee') {
      companyId = Number(b.company_id);
      if (!await db.get(q.companyById, companyId)) return fail(res, 400, 'اختر الشركة');
    }
    const pwErr = validatePassword(b.password);
    if (pwErr) return fail(res, 400, pwErr);
    try {
      const r = await db.run(q.insertUser, username, hashPassword(b.password), fullName, role, companyId, new Date().toISOString());
      res.status(201).json({ ok: true, id: Number(r.lastInsertRowid) });
    } catch (e) {
      if (/UNIQUE/i.test(e.message)) return fail(res, 409, 'اسم المستخدم مستخدم مسبقًا');
      throw e;
    }
  });

  app.patch('/api/admin/users/:id', manager, async (req, res) => {
    const id = Number(req.params.id);
    const target = Number.isInteger(id) ? await db.get(q.userById, id) : null;
    if (!target) return fail(res, 404, 'الحساب غير موجود');
    const b = req.body || {};
    const sets = [];
    const vals = [];
    if (b.full_name !== undefined) {
      const n = cleanName(b.full_name);
      if (!n) return fail(res, 400, 'الاسم مطلوب (حتى 80 حرفًا)');
      sets.push('full_name = ?'); vals.push(n);
    }
    if (b.company_id !== undefined) {
      if (target.role !== 'employee') return fail(res, 400, 'المدير غير مرتبط بشركة');
      const c = Number(b.company_id);
      if (!await db.get(q.companyById, c)) return fail(res, 400, 'الشركة غير موجودة');
      sets.push('company_id = ?'); vals.push(c);
    }
    if (b.active !== undefined) {
      if (typeof b.active !== 'boolean') return fail(res, 400, 'قيمة الحالة غير صحيحة');
      if (!b.active && target.role === 'manager') {
        if (target.id === req.user.id) return fail(res, 400, 'لا يمكنك إيقاف حسابك أنت');
        if (target.active && (await db.get(q.activeManagers)).n <= 1) return fail(res, 400, 'يجب أن يبقى مدير واحد فعّال على الأقل');
      }
      sets.push('active = ?'); vals.push(b.active ? 1 : 0);
    }
    if (b.reports_access !== undefined) {
      if (typeof b.reports_access !== 'boolean') return fail(res, 400, 'قيمة الصلاحية غير صحيحة');
      if (target.role !== 'employee') return fail(res, 400, 'المدير يرى التقارير أصلًا');
      sets.push('reports_access = ?'); vals.push(b.reports_access ? 1 : 0);
    }
    if (b.password !== undefined) {
      const err = validatePassword(b.password);
      if (err) return fail(res, 400, err);
      sets.push('password_hash = ?'); vals.push(hashPassword(b.password));
    }
    if (!sets.length) return fail(res, 400, 'لا توجد تعديلات');
    await db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...vals, id);
    if (b.active === false || (b.password !== undefined && id !== req.user.id)) await db.run(q.deleteUserSessions, id);
    if (b.active === false) for (const c of liveClients) if (c.userId === id) c.res.end();
    res.json({ ok: true });
  });

  // حذف موظف نهائيًا مع كل سجلات حضوره (لا يمكن التراجع). المدراء يُوقفون فقط.
  app.delete('/api/admin/users/:id', manager, async (req, res) => {
    const id = Number(req.params.id);
    const target = Number.isInteger(id) ? await db.get(q.userById, id) : null;
    if (!target) return fail(res, 404, 'الحساب غير موجود');
    if (target.role !== 'employee') return fail(res, 400, 'لا يمكن حذف مدير؛ استخدم الإيقاف');
    const r = await deleteEmployee(db, id);
    res.json({ ok: true, deleted_records: r.records });
  });

  // اسم الشركة و/أو موقع مكتبها (مركز ونطاق بالمتر) لتقدير «داخل/خارج المكتب».
  app.patch('/api/admin/companies/:id', manager, async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    if (!await db.get(q.companyById, id)) return fail(res, 404, 'الشركة غير موجودة');
    const sets = [];
    const vals = [];
    if (b.name !== undefined) {
      const name = cleanName(b.name);
      if (!name) return fail(res, 400, 'اسم الشركة مطلوب');
      sets.push('name = ?'); vals.push(name);
    }
    if (b.office_lat !== undefined || b.office_lng !== undefined || b.office_radius_m !== undefined) {
      const lat = Number(b.office_lat);
      const lng = Number(b.office_lng);
      const radius = Number(b.office_radius_m);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return fail(res, 400, 'إحداثيات المكتب غير صحيحة');
      }
      if (!Number.isFinite(radius) || radius < 10 || radius > 1000) return fail(res, 400, 'نطاق المكتب يجب أن يكون بين 10 و1000 متر');
      sets.push('office_lat = ?', 'office_lng = ?', 'office_radius_m = ?');
      vals.push(round(lat, 7), round(lng, 7), Math.round(radius));
    }
    if (!sets.length) return fail(res, 400, 'لا توجد تعديلات');
    try { await db.run(`UPDATE companies SET ${sets.join(', ')} WHERE id = ?`, ...vals, id); } catch (e) {
      if (/UNIQUE/i.test(e.message)) return fail(res, 409, 'يوجد شركة بالاسم نفسه');
      throw e;
    }
    res.json({ ok: true });
  });

  // ---------- إشعارات الإدارة: مباشرة على الشاشة (SSE) وعلى الهاتف (Web Push) ----------
  const liveClients = new Set();

  app.get('/api/admin/events', manager, (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write('retry: 5000\n\n');
    const client = { res, userId: req.user.id };
    liveClients.add(client);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000); // يبقي الاتصال حيًا عبر الوكلاء
    req.on('close', () => { clearInterval(ping); liveClients.delete(client); });
  });

  app.get('/api/admin/push/key', manager, (req, res) => {
    if (!push) return fail(res, 503, 'الإشعارات غير مفعّلة على الخادم');
    res.json({ publicKey: push.publicKey });
  });

  app.post('/api/admin/push/subscribe', manager, async (req, res) => {
    const sub = req.body || {};
    const endpoint = String(sub.endpoint || '');
    const p256dh = String(sub.keys?.p256dh || '');
    const auth = String(sub.keys?.auth || '');
    if (!/^https:\/\/[^\s]{10,1000}$/.test(endpoint) || !p256dh || !auth || p256dh.length > 200 || auth.length > 100) {
      return fail(res, 400, 'اشتراك الإشعارات غير صالح');
    }
    await db.run(q.saveSub, req.user.id, endpoint, p256dh, auth, new Date().toISOString());
    res.json({ ok: true });
  });

  app.post('/api/admin/push/unsubscribe', manager, async (req, res) => {
    await db.run(q.deleteSub, String(req.body?.endpoint || ''), req.user.id);
    res.json({ ok: true });
  });

  app.post('/api/admin/push/test', manager, async (req, res) => {
    if (!push) return fail(res, 503, 'الإشعارات غير مفعّلة على الخادم');
    const subs = await db.all(q.userSubs, req.user.id);
    if (!subs.length) return fail(res, 400, 'الإشعارات غير مفعّلة على هذا الجهاز');
    const sent = await sendPush(subs, { title: 'تجربة إشعار ✓', body: 'الإشعارات تعمل على هذا الجهاز', tag: 'test', url: '/' });
    res.json({ ok: true, sent });
  });

  // يُستدعى بعد حفظ الدخول/الخروج؛ لا يؤخر رد الموظف، وأي فشل هنا لا يؤثر على التسجيل.
  function announce(kind, user, row) {
    (async () => {
      const company = await db.get(q.companyOffice, row.company_id);
      const office = company?.office_lat == null ? null
        : { lat: company.office_lat, lng: company.office_lng, radius: company.office_radius_m };
      const at = kind === 'in' ? row.check_in_at : row.check_out_at;
      const place = kind === 'in'
        ? classifyPlace(row.in_lat, row.in_lng, row.in_accuracy, office)
        : classifyPlace(row.out_lat, row.out_lng, row.out_accuracy, office);
      const duration = kind === 'out' ? T.durationMinutes(row.check_in_at, row.check_out_at) : null;
      const event = {
        type: 'attendance', kind, record_id: row.id, user_id: user.id,
        employee_name: user.full_name, company_name: company?.name || '', at, place, duration_minutes: duration,
      };
      const line = `event: attendance\ndata: ${JSON.stringify(event)}\n\n`;
      for (const c of liveClients) c.res.write(line);

      if (!push) return;
      const placeText = !place ? '' : place.place === 'inside' ? 'في المكتب'
        : `${place.place === 'outside' ? 'خارج المكتب' : 'موقع غير مؤكد'} (${fmtDistance(place.distance_m)})`;
      const body = [company?.name, T.localTime(at), placeText, duration != null ? `مدة العمل ${T.formatDuration(duration)}` : '']
        .filter(Boolean).join(' · ');
      await sendPush(await db.all(q.managerSubs), {
        title: `${kind === 'in' ? 'دخول' : 'خروج'}: ${user.full_name}`, body, tag: `att-${row.id}-${kind}`, url: '/',
      });
    })().catch((e) => console.error('announce failed:', e.message));
  }

  // أحداث المغادرة: كل الأحداث تحدّث شاشات المدراء، والطلب الجديد والعودة يصلان كإشعار على الهاتف.
  function announceLeave(kind, user, row) {
    (async () => {
      const company = await db.get(q.companyOffice, row.company_id);
      const office = company?.office_lat == null ? null
        : { lat: company.office_lat, lng: company.office_lng, radius: company.office_radius_m };
      const place = kind === 'return' ? classifyPlace(row.ret_lat, row.ret_lng, row.ret_accuracy, office) : null;
      const event = {
        type: 'leave', kind, leave_id: row.id, user_id: user.id, employee_name: user.full_name,
        starts_at: row.starts_at, ends_at: row.ends_at, returned_at: row.returned_at, place,
      };
      const line = `event: leave\ndata: ${JSON.stringify(event)}\n\n`;
      for (const c of liveClients) c.res.write(line);

      if (!push || !['request', 'return'].includes(kind)) return;
      const day = T.localDate(row.starts_at) === T.localDate(new Date().toISOString()) ? 'اليوم' : T.localDate(row.starts_at);
      const planned = T.durationMinutes(row.starts_at, row.ends_at);
      let title, body;
      if (kind === 'request') {
        title = `طلب مغادرة: ${user.full_name}`;
        body = [`${day} ${T.localTime(row.starts_at)} – ${T.localTime(row.ends_at)}`, `(${T.formatDuration(planned)})`, row.reason].filter(Boolean).join(' · ');
      } else {
        const placeText = !place ? '' : place.place === 'inside' ? 'في المكتب'
          : `${place.place === 'outside' ? 'خارج المكتب' : 'موقع غير مؤكد'} (${fmtDistance(place.distance_m)})`;
        title = `انتهت المغادرة: ${user.full_name}`;
        body = [`رجع ${T.localTime(row.returned_at)}`, placeText,
          `استغرقت ${T.formatDuration(T.durationMinutes(row.starts_at, row.returned_at))} من ${T.formatDuration(planned)}`].filter(Boolean).join(' · ');
      }
      await sendPush(await db.all(q.managerSubs), { title, body, tag: `leave-${row.id}-${kind}`, url: '/' });
    })().catch((e) => console.error('announceLeave failed:', e.message));
  }

  async function sendPush(subs, payload) {
    let sent = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        await push.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
        sent++;
      } catch (e) {
        // الاشتراك انتهى أو أُلغي من الجهاز
        if (e.statusCode === 404 || e.statusCode === 410) await db.run(q.deleteSubById, s.id);
        else console.error('push failed:', e.statusCode || e.message);
      }
    }));
    return sent;
  }

  app.use('/api', (req, res) => fail(res, 404, 'غير موجود'));

  // ---------- الواجهة ----------
  app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html', maxAge: 0 }));
  app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') return fail(res, 400, 'بيانات الطلب غير صالحة');
    console.error(err);
    fail(res, 500, 'حدث خطأ في الخادم. حاول مرة أخرى');
  });

  // ---------- مساعدات الاستعلام ----------
  function parseFilters(qs) {
    const f = { where: [], vals: [] };
    if (qs.company) {
      const c = Number(qs.company);
      if (!Number.isInteger(c)) return { error: 'شركة غير صالحة' };
      f.where.push('a.company_id = ?'); f.vals.push(c);
    }
    if (qs.employee) {
      const e = Number(qs.employee);
      if (!Number.isInteger(e)) return { error: 'موظف غير صالح' };
      f.where.push('a.user_id = ?'); f.vals.push(e);
    }
    if (qs.from) {
      const d = T.localMidnightToUtc(qs.from);
      if (!d) return { error: 'تاريخ البداية غير صالح' };
      f.where.push('a.check_in_at >= ?'); f.vals.push(d.toISOString());
    }
    if (qs.to) {
      const d = T.localMidnightToUtc(qs.to);
      if (!d) return { error: 'تاريخ النهاية غير صالح' };
      f.where.push('a.check_in_at < ?'); f.vals.push(T.localMidnightToUtc(T.addDays(qs.to, 1)).toISOString());
    }
    if (qs.status === 'open') f.where.push('a.check_out_at IS NULL');
    else if (qs.status === 'completed') f.where.push('a.check_out_at IS NOT NULL');
    else if (qs.status) return { error: 'حالة غير صالحة' };
    return f;
  }

  async function queryRecords(f) {
    const where = f.where.length ? 'WHERE ' + f.where.join(' AND ') : '';
    return (await db.all(`
      SELECT a.*, u.full_name AS employee_name, c.name AS company_name,
             c.office_lat, c.office_lng, c.office_radius_m
      FROM attendance a JOIN users u ON u.id = a.user_id JOIN companies c ON c.id = a.company_id
      ${where} ORDER BY a.check_in_at DESC LIMIT ${MAX_ROWS}`, ...f.vals)).map(shapeRecord);
  }

  // ملف Excel حقيقي: ورقة من اليمين لليسار بالأعمدة المهمة فقط، وورقة ثانية لمجموع ساعات كل موظف.
  async function sendXlsx(res, records) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'نظام الحضور والانصراف';
    const style = (ws) => {
      const head = ws.getRow(1);
      head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16325C' } };
      head.alignment = { vertical: 'middle', horizontal: 'center' };
      head.height = 24;
      ws.eachRow((row, n) => { if (n > 1) row.alignment = { horizontal: 'right' }; });
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
    };

    const ws = wb.addWorksheet('الحضور', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: 'الموظف', key: 'name', width: 22 },
      { header: 'الشركة', key: 'company', width: 24 },
      { header: 'التاريخ', key: 'date', width: 14 },
      { header: 'وقت الدخول', key: 'in', width: 13 },
      { header: 'وقت الخروج', key: 'out', width: 13 },
      { header: 'مدة العمل', key: 'dur', width: 14 },
      { header: 'الحالة', key: 'status', width: 11 },
    ];
    for (const r of records) {
      const done = r.status === 'completed';
      const outDate = done ? T.localDate(r.check_out_at) : null;
      ws.addRow({
        name: r.employee_name,
        company: r.company_name,
        date: r.shift_date,
        in: T.localTime(r.check_in_at),
        out: done ? T.localTime(r.check_out_at) + (outDate !== r.shift_date ? ` (${outDate})` : '') : '—',
        dur: done ? T.formatDuration(r.duration_minutes) : '—',
        status: done ? 'مكتمل' : 'لم يسجّل خروج',
      });
    }
    style(ws);

    const ts = wb.addWorksheet('مجموع الساعات', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
    ts.columns = [
      { header: 'الموظف', key: 'name', width: 22 },
      { header: 'الشركة', key: 'company', width: 24 },
      { header: 'أيام مكتملة', key: 'days', width: 13 },
      { header: 'مجموع الساعات', key: 'total', width: 16 },
    ];
    for (const t of totalsByEmployee(records)) {
      ts.addRow({ name: t.employee_name, company: t.company_name, days: t.completed_count, total: T.formatDuration(t.completed_minutes) });
    }
    style(ts);

    const stamp = T.localDate(new Date().toISOString());
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', `attachment; filename="attendance-${stamp}.xlsx"`);
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  }

  return app;
}

// ---------- دوال مساعدة ----------
function shapeRecord(r) {
  const completed = r.check_out_at != null;
  return {
    id: r.id,
    user_id: r.user_id,
    employee_name: r.employee_name,
    company_id: r.company_id,
    company_name: r.company_name,
    shift_date: T.localDate(r.check_in_at),
    check_in_at: r.check_in_at,
    in_lat: r.in_lat, in_lng: r.in_lng, in_accuracy: r.in_accuracy,
    check_out_at: r.check_out_at,
    out_lat: r.out_lat, out_lng: r.out_lng, out_accuracy: r.out_accuracy,
    in_place: classifyPlace(r.in_lat, r.in_lng, r.in_accuracy, officeOf(r)),
    out_place: completed ? classifyPlace(r.out_lat, r.out_lng, r.out_accuracy, officeOf(r)) : null,
    duration_minutes: completed ? T.durationMinutes(r.check_in_at, r.check_out_at) : null,
    status: completed ? 'completed' : 'open',
  };
}

function officeOf(r) {
  return r.office_lat == null ? null : { lat: r.office_lat, lng: r.office_lng, radius: r.office_radius_m };
}

// ما يراه الموظف عن سجله: الأوقات فقط، بدون إحداثيات أو دقة أو مدد.
function employeeView(r) {
  return {
    id: r.id,
    user_id: r.user_id,
    company_id: r.company_id,
    check_in_at: r.check_in_at,
    check_out_at: r.check_out_at,
    status: r.check_out_at != null ? 'completed' : 'open',
  };
}

// مرحلة المغادرة المقبولة: لم تبدأ / جارية (خارج حتى يسجّل عودته) / انتهت بعودته.
function leavePhase(l, nowIso) {
  if (l.status !== 'approved') return l.status;
  if (l.returned_at) return 'returned';
  return l.starts_at > nowIso ? 'upcoming' : 'out';
}

// ما يراه المدير عن المغادرة، مع تقدير مكان العودة.
function shapeLeave(l, nowIso) {
  return {
    id: l.id, user_id: l.user_id, employee_name: l.employee_name, company_id: l.company_id, company_name: l.company_name,
    starts_at: l.starts_at, ends_at: l.ends_at, reason: l.reason, status: l.status, phase: leavePhase(l, nowIso),
    created_at: l.created_at, decided_at: l.decided_at, decided_by_name: l.decided_by_name,
    returned_at: l.returned_at, ret_lat: l.ret_lat, ret_lng: l.ret_lng, ret_accuracy: l.ret_accuracy,
    ret_place: l.returned_at ? classifyPlace(l.ret_lat, l.ret_lng, l.ret_accuracy, officeOf(l)) : null,
    planned_minutes: T.durationMinutes(l.starts_at, l.ends_at),
    used_minutes: l.returned_at ? T.durationMinutes(l.starts_at, l.returned_at) : null,
  };
}

// ما يراه الموظف عن مغادرته: الأوقات والحالة فقط، بدون الموقع.
function employeeLeaveView(l, nowIso) {
  return {
    id: l.id, starts_at: l.starts_at, ends_at: l.ends_at, reason: l.reason,
    status: l.status, phase: leavePhase(l, nowIso), returned_at: l.returned_at,
  };
}

function shapeEmployee(e) {
  return {
    id: e.id, username: e.username, full_name: e.full_name,
    company_id: e.company_id, company_name: e.company_name, company_logo: e.company_logo, active: !!e.active,
    reports_access: !!e.reports_access,
    last_activity_at: e.last_activity_at,
    open_record: e.open_id ? {
      id: e.open_id, check_in_at: e.open_check_in_at,
      in_lat: e.open_in_lat, in_lng: e.open_in_lng, in_accuracy: e.open_in_accuracy,
      in_place: classifyPlace(e.open_in_lat, e.open_in_lng, e.open_in_accuracy, officeOf(e)),
    } : null,
  };
}

// مجموع الساعات المكتملة فقط؛ السجلات المفتوحة تُعدّ ولا تُجمع.
function totalsByEmployee(records) {
  const map = new Map();
  for (const r of records) {
    let t = map.get(r.user_id);
    if (!t) map.set(r.user_id, t = { user_id: r.user_id, employee_name: r.employee_name, company_name: r.company_name, completed_minutes: 0, completed_count: 0, open_count: 0 });
    if (r.status === 'completed') { t.completed_minutes += r.duration_minutes; t.completed_count++; }
    else t.open_count++;
  }
  return [...map.values()].sort((a, b) => b.completed_minutes - a.completed_minutes);
}

function parseLocation(body) {
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  const accuracy = Number(body?.accuracy);
  if (body?.lat == null || body?.lng == null || body?.accuracy == null ||
      !Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(accuracy)) {
    return { error: 'الموقع الجغرافي مطلوب لإتمام التسجيل' };
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || accuracy < 0 || accuracy > 1e6) {
    return { error: 'بيانات الموقع غير صالحة' };
  }
  return { lat: round(lat, 7), lng: round(lng, 7), accuracy: round(accuracy, 1) };
}

// «09:00» ← «9:00 ص»
function hm12(hm) { const [h, m] = hm.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`; }
function fmtDistance(m) { return m >= 1000 ? `${(m / 1000).toFixed(1)} كم` : `${m} م`; }
function round(n, d) { const f = 10 ** d; return Math.round(n * f) / f; }
function cleanName(s) { const n = String(s ?? '').trim().replace(/\s+/g, ' '); return n && n.length <= 80 ? n : null; }
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function fail(res, status, error) { return res.status(status).json({ error }); }


function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

module.exports = { createApp };
