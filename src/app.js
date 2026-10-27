'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const ExcelJS = require('exceljs');
const { hashPassword, verifyPassword, DUMMY_HASH, validatePassword } = require('./passwords');
const T = require('./time');

const SESSION_DAYS = 30;
const COOKIE = 'sid';
const USERNAME_RE = /^[A-Za-z0-9._-]{3,40}$/;
const MAX_ROWS = 5000;

function createApp(db, opts = {}) {
  const secureCookie = opts.secureCookie ?? false;
  const accuracyWarnM = opts.accuracyWarnM ?? 100;
  const app = express();
  app.disable('x-powered-by');
  if (opts.trustProxy) app.set('trust proxy', opts.trustProxy);

  const q = {
    sessionUser: db.prepare(`
      SELECT u.id, u.username, u.full_name, u.role, u.company_id, c.name AS company_name, c.logo AS company_logo
      FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN companies c ON c.id = u.company_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`),
    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    deleteUserSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    deleteExpired: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    activeManagers: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'manager' AND active = 1"),
    openRecord: db.prepare('SELECT * FROM attendance WHERE user_id = ? AND check_out_at IS NULL'),
    checkIn: db.prepare(`INSERT INTO attendance (user_id, company_id, check_in_at, in_lat, in_lng, in_accuracy)
                         VALUES (?, ?, ?, ?, ?, ?)`),
    checkOut: db.prepare(`UPDATE attendance SET check_out_at = ?, out_lat = ?, out_lng = ?, out_accuracy = ?
                          WHERE user_id = ? AND check_out_at IS NULL`),
    recordById: db.prepare('SELECT * FROM attendance WHERE id = ?'),
    myRecords: db.prepare('SELECT * FROM attendance WHERE user_id = ? ORDER BY check_in_at DESC LIMIT ?'),
    companies: db.prepare('SELECT id, name, logo FROM companies ORDER BY id'),
    companyById: db.prepare('SELECT id FROM companies WHERE id = ?'),
    renameCompany: db.prepare('UPDATE companies SET name = ? WHERE id = ?'),
    employees: db.prepare(`
      SELECT u.id, u.username, u.full_name, u.company_id, c.name AS company_name, c.logo AS company_logo, u.active,
             a.id AS open_id, a.check_in_at AS open_check_in_at, a.in_lat AS open_in_lat,
             a.in_lng AS open_in_lng, a.in_accuracy AS open_in_accuracy,
             (SELECT MAX(COALESCE(check_out_at, check_in_at)) FROM attendance WHERE user_id = u.id) AS last_activity_at
      FROM users u JOIN companies c ON c.id = u.company_id
      LEFT JOIN attendance a ON a.user_id = u.id AND a.check_out_at IS NULL
      WHERE u.role = 'employee'
      ORDER BY u.active DESC, c.id, u.full_name`),
    managers: db.prepare(`SELECT id, username, full_name, active, created_at FROM users
                          WHERE role = 'manager' ORDER BY active DESC, full_name`),
    insertUser: db.prepare(`INSERT INTO users (username, password_hash, full_name, role, company_id, created_at)
                            VALUES (?, ?, ?, ?, ?, ?)`),
    updatePassword: db.prepare('UPDATE users SET password_hash = ? WHERE id = ?'),
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

  app.get('/api/health', (req, res) => {
    db.prepare('SELECT 1').get();
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

  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const token = readCookie(req, COOKIE);
    if (token) {
      req.user = q.sessionUser.get(sha256(token), new Date().toISOString()) || null;
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

  app.post('/api/login', (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const ipKey = `ip:${req.ip}`;
    const userKey = `u:${req.ip}:${username.toLowerCase()}`;
    if (tooMany(ipKey, 50) || tooMany(userKey, 8)) {
      return fail(res, 429, 'محاولات كثيرة. حاول مرة أخرى بعد 15 دقيقة');
    }
    const user = username ? q.userByName.get(username) : null;
    const ok = verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok) {
      recordFail(ipKey); recordFail(userKey);
      return fail(res, 401, 'اسم المستخدم أو كلمة المرور غير صحيحة');
    }
    if (!user.active) return fail(res, 403, 'هذا الحساب موقوف. تواصل مع الإدارة');
    attempts.delete(userKey);

    const now = new Date();
    q.deleteExpired.run(now.toISOString());
    const token = crypto.randomBytes(32).toString('base64url');
    const expires = new Date(now.getTime() + SESSION_DAYS * 864e5);
    q.insertSession.run(sha256(token), user.id, now.toISOString(), expires.toISOString());
    res.cookie(COOKIE, token, {
      httpOnly: true, secure: secureCookie, sameSite: 'lax', path: '/', expires,
    });
    res.json({ ok: true, role: user.role });
  });

  app.post('/api/logout', (req, res) => {
    if (req.sessionToken) q.deleteSession.run(sha256(req.sessionToken));
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  // الشعارات والأسماء متاحة لصفحة الدخول.
  app.get('/api/companies', (req, res) => res.json({ companies: q.companies.all() }));

  app.get('/api/me', (req, res) => {
    if (!req.user) return fail(res, 401, 'يرجى تسجيل الدخول');
    const open = req.user.role === 'employee' ? q.openRecord.get(req.user.id) : null;
    res.json({
      user: req.user,
      open_record: open ? employeeView(open) : null,
      server_now: new Date().toISOString(),
      timezone: T.WORK_TZ,
      accuracy_warn_m: req.user.role === 'manager' ? accuracyWarnM : undefined,
    });
  });

  app.post('/api/me/password', (req, res) => {
    if (!req.user) return fail(res, 401, 'يرجى تسجيل الدخول');
    const { current, next: nextPw } = req.body || {};
    const row = q.userById.get(req.user.id);
    if (!verifyPassword(String(current || ''), row.password_hash)) return fail(res, 400, 'كلمة المرور الحالية غير صحيحة');
    const err = validatePassword(nextPw);
    if (err) return fail(res, 400, err);
    q.updatePassword.run(hashPassword(nextPw), req.user.id);
    res.json({ ok: true });
  });

  // ---------- الموظف (يرى أوقات دخوله وخروجه فقط؛ التفاصيل للإدارة) ----------
  const employee = requireRole('employee');

  app.post('/api/my/check-in', employee, (req, res) => {
    const loc = parseLocation(req.body);
    if (loc.error) return fail(res, 400, loc.error);
    const now = new Date().toISOString(); // وقت الخادم هو المرجع الرسمي
    try {
      const r = q.checkIn.run(req.user.id, req.user.company_id, now, loc.lat, loc.lng, loc.accuracy);
      res.status(201).json({ ok: true, record: employeeView(q.recordById.get(r.lastInsertRowid)) });
    } catch (e) {
      if (/UNIQUE/i.test(e.message)) return fail(res, 409, 'دوامك مسجّل بالفعل. سجّل خروجك أولًا');
      throw e;
    }
  });

  app.post('/api/my/check-out', employee, (req, res) => {
    const loc = parseLocation(req.body);
    if (loc.error) return fail(res, 400, loc.error);
    const open = q.openRecord.get(req.user.id);
    if (!open) return fail(res, 409, 'لم تسجّل دخولك بعد');
    const now = new Date().toISOString();
    // التحديث مشروط بأن يكون السجل ما زال مفتوحًا، فلا يُغلق مرتين حتى مع طلبين متزامنين.
    const r = q.checkOut.run(now, loc.lat, loc.lng, loc.accuracy, req.user.id);
    if (r.changes !== 1) return fail(res, 409, 'لم تسجّل دخولك بعد');
    res.json({ ok: true, record: employeeView(q.recordById.get(open.id)) });
  });

  app.get('/api/my/records', employee, (req, res) => {
    res.json({ records: q.myRecords.all(req.user.id, 10).map(employeeView) });
  });

  // ---------- الإدارة ----------
  const manager = requireRole('manager');

  app.get('/api/admin/overview', manager, (req, res) => {
    const employees = q.employees.all().map(shapeEmployee);
    res.json({
      companies: q.companies.all(),
      employees,
      managers: q.managers.all().map((m) => ({ ...m, active: !!m.active })),
      me_id: req.user.id,
      present_count: employees.filter((e) => e.open_record).length,
      server_now: new Date().toISOString(),
      accuracy_warn_m: accuracyWarnM,
    });
  });

  app.get('/api/admin/records', manager, (req, res) => {
    const f = parseFilters(req.query);
    if (f.error) return fail(res, 400, f.error);
    const records = queryRecords(f);
    res.json({ records, totals: totalsByEmployee(records), truncated: records.length >= MAX_ROWS });
  });

  app.get('/api/admin/records.xlsx', manager, async (req, res, next) => {
    const f = parseFilters(req.query);
    if (f.error) return fail(res, 400, f.error);
    try { await sendXlsx(res, queryRecords(f)); } catch (e) { next(e); }
  });

  // إضافة موظف أو مدير. الموظف يجب أن ينتمي لشركة؛ المدير يرى الشركتين.
  app.post('/api/admin/users', manager, (req, res) => {
    const b = req.body || {};
    const role = b.role === 'manager' ? 'manager' : 'employee';
    const fullName = cleanName(b.full_name);
    const username = String(b.username || '').trim();
    if (!fullName) return fail(res, 400, 'الاسم مطلوب (حتى 80 حرفًا)');
    if (!USERNAME_RE.test(username)) return fail(res, 400, 'اسم المستخدم 3–40 حرفًا إنجليزيًا أو أرقامًا أو . _ -');
    let companyId = null;
    if (role === 'employee') {
      companyId = Number(b.company_id);
      if (!q.companyById.get(companyId)) return fail(res, 400, 'اختر الشركة');
    }
    const pwErr = validatePassword(b.password);
    if (pwErr) return fail(res, 400, pwErr);
    try {
      const r = q.insertUser.run(username, hashPassword(b.password), fullName, role, companyId, new Date().toISOString());
      res.status(201).json({ ok: true, id: Number(r.lastInsertRowid) });
    } catch (e) {
      if (/UNIQUE/i.test(e.message)) return fail(res, 409, 'اسم المستخدم مستخدم مسبقًا');
      throw e;
    }
  });

  app.patch('/api/admin/users/:id', manager, (req, res) => {
    const id = Number(req.params.id);
    const target = Number.isInteger(id) ? q.userById.get(id) : null;
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
      if (!q.companyById.get(c)) return fail(res, 400, 'الشركة غير موجودة');
      sets.push('company_id = ?'); vals.push(c);
    }
    if (b.active !== undefined) {
      if (typeof b.active !== 'boolean') return fail(res, 400, 'قيمة الحالة غير صحيحة');
      if (!b.active && target.role === 'manager') {
        if (target.id === req.user.id) return fail(res, 400, 'لا يمكنك إيقاف حسابك أنت');
        if (target.active && q.activeManagers.get().n <= 1) return fail(res, 400, 'يجب أن يبقى مدير واحد فعّال على الأقل');
      }
      sets.push('active = ?'); vals.push(b.active ? 1 : 0);
    }
    if (b.password !== undefined) {
      const err = validatePassword(b.password);
      if (err) return fail(res, 400, err);
      sets.push('password_hash = ?'); vals.push(hashPassword(b.password));
    }
    if (!sets.length) return fail(res, 400, 'لا توجد تعديلات');
    db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    if (b.active === false || (b.password !== undefined && id !== req.user.id)) q.deleteUserSessions.run(id);
    res.json({ ok: true });
  });

  app.patch('/api/admin/companies/:id', manager, (req, res) => {
    const id = Number(req.params.id);
    const name = cleanName(req.body?.name);
    if (!q.companyById.get(id)) return fail(res, 404, 'الشركة غير موجودة');
    if (!name) return fail(res, 400, 'اسم الشركة مطلوب');
    try { q.renameCompany.run(name, id); } catch (e) {
      if (/UNIQUE/i.test(e.message)) return fail(res, 409, 'يوجد شركة بالاسم نفسه');
      throw e;
    }
    res.json({ ok: true });
  });

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

  function queryRecords(f) {
    const where = f.where.length ? 'WHERE ' + f.where.join(' AND ') : '';
    return db.prepare(`
      SELECT a.*, u.full_name AS employee_name, c.name AS company_name
      FROM attendance a JOIN users u ON u.id = a.user_id JOIN companies c ON c.id = a.company_id
      ${where} ORDER BY a.check_in_at DESC LIMIT ${MAX_ROWS}`).all(...f.vals).map(shapeRecord);
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
    duration_minutes: completed ? T.durationMinutes(r.check_in_at, r.check_out_at) : null,
    status: completed ? 'completed' : 'open',
  };
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

function shapeEmployee(e) {
  return {
    id: e.id, username: e.username, full_name: e.full_name,
    company_id: e.company_id, company_name: e.company_name, company_logo: e.company_logo, active: !!e.active,
    last_activity_at: e.last_activity_at,
    open_record: e.open_id ? {
      id: e.open_id, check_in_at: e.open_check_in_at,
      in_lat: e.open_in_lat, in_lng: e.open_in_lng, in_accuracy: e.open_in_accuracy,
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
