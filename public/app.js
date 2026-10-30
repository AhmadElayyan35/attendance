'use strict';
(() => {
  const TZ = 'Asia/Hebron';
  const LOCALE = 'ar-u-nu-latn';
  const $app = document.getElementById('app');
  const state = { me: null, skew: 0, timers: [], view: 'home', companies: [] };

  // ---------- أدوات DOM ----------
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  function mount(...nodes) { clearTimers(); $app.replaceChildren(...nodes); }
  function clearTimers() { state.timers.forEach(clearInterval); state.timers = []; }
  function every(ms, fn) { state.timers.push(setInterval(fn, ms)); }

  // أيقونات SVG ثابتة
  const ICONS = {
    in: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    report: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
    key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14.5 8.5l2 2"/>',
    edit: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><path d="M12 2v10"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    menu: '<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    map: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  };
  function icon(name) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = ICONS[name] || '';
    return s;
  }

  // ---------- الوقت (بتوقيت مكان العمل دائمًا) ----------
  const F = {
    time: new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }),
    clock: new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true }),
    date: new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }),
    dateShort: new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' }),
    day: new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, day: 'numeric' }),
    weekday: new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, weekday: 'long' }),
    ymd: new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }),
  };
  const now = () => new Date(Date.now() + state.skew);
  const fmtTime = (iso) => (iso ? F.time.format(new Date(iso)) : '—');
  const fmtDate = (iso) => (iso ? F.dateShort.format(new Date(iso)) : '—');
  const ymdOf = (d) => F.ymd.format(d);
  const today = () => ymdOf(now());
  function addDays(ymd, n) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }
  function fmtDuration(min) {
    if (min == null) return '—';
    const hh = Math.floor(min / 60), mm = min % 60;
    if (!hh) return `${mm} د`;
    return mm ? `${hh} س ${mm} د` : `${hh} س`;
  }
  const minutesSince = (iso) => Math.max(0, Math.floor((now() - new Date(iso)) / 60000));

  // ---------- الاتصال بالخادم ----------
  class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }
  async function api(path, opts = {}) {
    let res;
    try {
      res = await fetch(path, {
        method: opts.method || 'GET',
        credentials: 'same-origin',
        headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : {},
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch {
      throw new ApiError('تعذّر الاتصال. تأكد من الإنترنت ثم حاول مرة أخرى', 0);
    }
    let data = null;
    try { data = await res.json(); } catch { /* ليس JSON */ }
    if (res.status === 401 && path !== '/api/login' && path !== '/api/me/password') {
      const had = !!state.me;
      showLogin(had ? 'انتهت الجلسة، سجّل الدخول مرة أخرى' : '');
      throw new ApiError('', 401);
    }
    if (!res.ok) throw new ApiError((data && data.error) || 'حدث خطأ غير متوقع. حاول مرة أخرى', res.status);
    return data;
  }

  function toast(text, kind = '') {
    const t = h('div', { class: `toast ${kind}` }, text);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), 3500);
  }
  function msg(kind, text, ...extra) {
    return h('div', { class: `msg ${kind}`, role: kind === 'error' ? 'alert' : 'status' },
      icon(kind === 'ok' ? 'check' : 'alert'), h('div', { class: 'grow' }, text, ...extra));
  }

  // ---------- عناصر مشتركة ----------
  const companyById = (id) => state.companies.find((c) => c.id === id);
  function logoChip(logo, cls = '') {
    return h('span', { class: `logo-chip ${cls}` }, logo ? h('img', { src: `/logos/${logo}`, alt: '' }) : null);
  }
  function initials(name) {
    const parts = String(name).trim().split(/\s+/);
    return (parts[0]?.[0] || '') + (parts[1]?.[0] || '');
  }
  const avatar = (name, companyId) => h('span', { class: `avatar c${companyId || 0}` }, initials(name));
  function companyTag(id) {
    const c = companyById(id);
    return h('span', { class: 'co-tag' }, c?.logo ? h('img', { src: `/logos/${c.logo}`, alt: '' }) : null, c?.name || '');
  }
  function passwordInput(id, autocomplete) {
    const input = h('input', { id, type: 'password', dir: 'ltr', required: true, autocomplete });
    const toggle = h('button', { type: 'button', 'aria-label': 'إظهار كلمة المرور', onclick: () => {
      input.type = input.type === 'password' ? 'text' : 'password';
    } }, icon('eye'));
    return { input, el: h('div', { class: 'pw-wrap' }, input, toggle) };
  }
  function genPassword() {
    const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
    const r = crypto.getRandomValues(new Uint8Array(8));
    const s = [...r].map((x) => abc[x % abc.length]).join('');
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  }

  function openDialog({ title, body, submit = 'حفظ', danger = false, onSubmit, cancel = 'إلغاء' }) {
    const err = h('div');
    const btn = h('button', { class: `btn ${danger ? 'danger' : ''}`, type: 'submit' }, submit);
    const dlg = h('dialog', {});
    const close = () => { dlg.close(); dlg.remove(); };
    dlg.append(h('form', { method: 'dialog', onsubmit: async (e) => {
      e.preventDefault();
      if (!onSubmit) return close();
      btn.disabled = true; err.replaceChildren();
      try { const keep = await onSubmit(); if (keep !== true) close(); }
      catch (ex) { if (ex.status !== 401) err.replaceChildren(h('div', { class: 'field' }, msg('error', ex.message))); }
      finally { btn.disabled = false; }
    } },
      h('div', { class: 'dlg-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'إغلاق', onclick: close }, icon('x'))),
      h('div', { class: 'dlg-body' }, err, body),
      h('div', { class: 'dlg-foot' }, btn, cancel ? h('button', { class: 'btn ghost', type: 'button', onclick: close }, cancel) : null)));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    document.body.append(dlg);
    dlg.showModal();
    return { dlg, close };
  }

  function changeOwnPassword() {
    const cur = passwordInput('c-cur', 'current-password');
    const nw = passwordInput('c-new', 'new-password');
    openDialog({
      title: 'تغيير كلمة المرور',
      body: [
        h('div', { class: 'field' }, h('label', { for: 'c-cur' }, 'كلمة المرور الحالية'), cur.el),
        h('div', { class: 'field' }, h('label', { for: 'c-new' }, 'كلمة المرور الجديدة'), nw.el, h('div', { class: 'hint' }, '8 أحرف على الأقل')),
      ],
      onSubmit: async () => {
        await api('/api/me/password', { method: 'POST', body: { current: cur.input.value, next: nw.input.value } });
        toast('تم تغيير كلمة المرور', 'ok');
      },
    });
  }
  async function logout() {
    stopLive();
    // جهاز خرج منه المدير لا يجب أن تصله إشعارات الحضور
    if (state.me?.user.role === 'manager') await disablePush().catch(() => {});
    try { await api('/api/logout', { method: 'POST', body: {} }); } catch { /* تجاهل */ }
    state.me = null;
    showLogin();
  }

  // ---------- تسجيل الدخول ----------
  async function showLogin(message) {
    state.me = null;
    const err = h('div', { class: 'field', hidden: !message }, message ? msg('error', message) : null);
    const user = h('input', { id: 'u', autocomplete: 'username', required: true, dir: 'ltr', autocapitalize: 'none', spellcheck: 'false' });
    const pass = passwordInput('p', 'current-password');
    const btn = h('button', { class: 'btn block', type: 'submit' }, 'دخول');
    const logos = h('div', { class: 'auth-logos' });
    mount(h('div', { class: 'auth' }, h('div', { class: 'auth-card' },
      logos,
      h('h1', {}, 'نظام الحضور والانصراف'),
      h('p', { class: 'sub' }, 'سجّل دخولك لمتابعة دوامك'),
      h('form', { onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true; btn.replaceChildren(h('span', { class: 'spinner' }), 'جارٍ الدخول…'); err.hidden = true;
        try {
          await api('/api/login', { method: 'POST', body: { username: user.value, password: pass.input.value } });
          await boot();
        } catch (ex) {
          err.replaceChildren(msg('error', ex.message)); err.hidden = false;
          btn.disabled = false; btn.textContent = 'دخول';
        }
      } },
        err,
        h('div', { class: 'field' }, h('label', { for: 'u' }, 'اسم المستخدم'), user),
        h('div', { class: 'field' }, h('label', { for: 'p' }, 'كلمة المرور'), pass.el),
        btn),
      h('p', { class: 'auth-foot' }, 'نسيت كلمة المرور؟ تواصل مع الإدارة'))));
    user.focus();
    try {
      const { companies } = await api('/api/companies');
      state.companies = companies;
      companies.forEach((c, i) => {
        if (i) logos.append(h('span', { class: 'divider' }));
        logos.append(h('span', { class: 'logo-chip', title: c.name }, c.logo ? h('img', { src: `/logos/${c.logo}`, alt: c.name }) : c.name));
      });
    } catch { /* الشعارات ليست ضرورية */ }
  }

  // ---------- صفحة الموظف ----------
  function getLocation() {
    return new Promise((resolve, reject) => {
      if (!window.isSecureContext) return reject(new Error('تعذّر التسجيل من هذا الرابط. تواصل مع الإدارة.'));
      if (!('geolocation' in navigator)) return reject(new Error('هذا المتصفح غير مدعوم. افتح التطبيق من Chrome أو Safari.'));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        (err) => reject(new Error({
          1: 'لإتمام التسجيل يجب السماح بإذن الموقع للتطبيق من إعدادات الهاتف أو المتصفح، ثم المحاولة مرة أخرى.',
          2: 'تعذّر التسجيل. تأكد من تفعيل خدمة الموقع في هاتفك ثم حاول مرة أخرى.',
          3: 'تأخر التسجيل. تأكد من الإنترنت وخدمة الموقع ثم حاول مرة أخرى.',
        }[err.code] || 'تعذّر التسجيل. حاول مرة أخرى.')),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
      );
    });
  }

  function showEmployee() {
    const u = state.me.user;
    const clockEl = h('div', { class: 'clock' });
    const dateEl = h('div', { class: 'clock-date' });
    const statusEl = h('div', { class: 'status-line' });
    const actionEl = h('div', { class: 'action-wrap' });
    const feedback = h('div', { class: 'feedback' });
    const history = h('div', {}, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }));
    let busy = false;
    let records = [];

    const menuList = h('div', { class: 'menu-list', hidden: true },
      h('button', { type: 'button', onclick: () => { menuList.hidden = true; changeOwnPassword(); } }, icon('key'), 'تغيير كلمة المرور'),
      h('button', { type: 'button', onclick: logout }, icon('out'), 'تسجيل الخروج من الحساب'));

    function tick() {
      clockEl.textContent = F.clock.format(now());
      dateEl.textContent = F.date.format(now());
    }

    function render() {
      const open = state.me.open_record;
      const lastDoneToday = records.find((r) => r.status === 'completed' && ymdOf(new Date(r.check_out_at)) === today());
      statusEl.className = 'status-line' + (open ? ' on' : '');
      statusEl.replaceChildren(h('span', { class: 'dot' }),
        open ? `أنت في الدوام منذ ${fmtTime(open.check_in_at)}`
          : lastDoneToday ? `أنهيت دوامك اليوم الساعة ${fmtTime(lastDoneToday.check_out_at)}`
            : 'لم تسجّل دخولك بعد');
      const kind = open ? 'out' : 'in';
      const btn = h('button', { class: `punch ${kind}`, type: 'button', disabled: busy, onclick: () => act(kind) },
        h('span', {},
          busy ? h('span', { class: 'spinner' }) : icon(kind),
          busy ? busy : (kind === 'in' ? 'تسجيل الدخول' : 'تسجيل الخروج'),
          busy ? null : h('span', { class: 'en' }, kind === 'in' ? 'Check In' : 'Check Out')));
      actionEl.replaceChildren(btn, h('div', { class: 'action-hint' }, kind === 'in' ? 'اضغط عند وصولك للعمل' : 'اضغط عند انتهاء دوامك'));
    }

    async function act(kind) {
      if (busy) return;
      feedback.replaceChildren();
      busy = 'جارٍ التسجيل…'; render();
      let loc;
      try {
        loc = await getLocation();
      } catch (e) {
        busy = false; render();
        return feedback.replaceChildren(msg('error', e.message,
          h('div', {}, h('button', { class: 'btn sm', type: 'button', onclick: () => act(kind) }, icon('refresh'), 'حاول مرة أخرى'))));
      }
      busy = 'جارٍ الحفظ…'; render();
      try {
        const r = await api(kind === 'in' ? '/api/my/check-in' : '/api/my/check-out', { method: 'POST', body: loc });
        await refreshMe();
        const text = kind === 'in'
          ? `تم تسجيل دخولك الساعة ${fmtTime(r.record.check_in_at)}`
          : `تم تسجيل خروجك الساعة ${fmtTime(r.record.check_out_at)}. يومًا سعيدًا!`;
        feedback.replaceChildren(msg('ok', text));
        toast(text, 'ok');
        await loadHistory();
      } catch (e) {
        if (e.status === 401) return;
        if (e.status === 409) { await refreshMe().catch(() => {}); await loadHistory(); }
        feedback.replaceChildren(msg('error', e.message, e.status === 409 ? null
          : h('div', {}, h('button', { class: 'btn sm', type: 'button', onclick: () => act(kind) }, icon('refresh'), 'حاول مرة أخرى'))));
      } finally {
        busy = false;
        if (state.me) render();
      }
    }

    async function loadHistory() {
      try {
        records = (await api('/api/my/records')).records;
        history.replaceChildren(records.length
          ? h('div', {}, records.slice(0, 7).map((r) => {
            const d = new Date(r.check_in_at);
            const crossDay = r.check_out_at && ymdOf(new Date(r.check_out_at)) !== ymdOf(d);
            return h('div', { class: 'history-item' },
              h('div', { class: 'history-date' }, h('b', {}, F.day.format(d)), h('span', {}, F.weekday.format(d))),
              h('div', { class: 'times grow' },
                h('div', {}, h('span', {}, 'دخول'), h('b', {}, fmtTime(r.check_in_at))),
                h('div', {}, h('span', {}, 'خروج'), h('b', {}, r.check_out_at ? fmtTime(r.check_out_at) : '—'),
                  crossDay ? h('span', {}, fmtDate(r.check_out_at)) : null)),
              r.status === 'open' ? h('span', { class: 'pill in' }, 'في الدوام') : null);
          }))
          : h('div', { class: 'empty' }, icon('clock'), h('div', {}, 'لا توجد تسجيلات بعد')));
        render();
      } catch (e) {
        if (e.status !== 401) history.replaceChildren(msg('error', e.message));
      }
    }

    mount(h('div', { class: 'emp' },
      h('div', { class: 'emp-top' },
        h('div', { class: 'who' }, logoChip(u.company_logo),
          h('div', { class: 'grow' }, h('h2', {}, `مرحبًا، ${u.full_name.split(' ')[0]}`), h('div', { class: 'company' }, u.company_name))),
        h('div', { class: 'menu' }, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'القائمة', onclick: () => { menuList.hidden = !menuList.hidden; } }, icon('menu')), menuList)),
      installBanner(),
      h('div', { class: 'card clock-card' }, clockEl, dateEl, statusEl),
      actionEl,
      feedback,
      h('div', { class: 'card mt' }, h('h3', { class: 'card-title' }, 'آخر تسجيلاتك'), history)));
    tick(); render();
    every(1000, tick);
    loadHistory();
  }

  // ---------- لوحة الإدارة ----------
  const NAV = [
    ['home', 'اليوم', 'home'],
    ['records', 'التقارير', 'report'],
    ['staff', 'الموظفون', 'users'],
    ['managers', 'المدراء', 'shield'],
    ['settings', 'الإعدادات', 'settings'],
  ];

  async function showAdmin(view = state.view) {
    state.view = view;
    const u = state.me.user;
    const main = h('div', { class: 'admin-main' });
    const navBtn = ([id, label, ic]) => h('button', { type: 'button', 'aria-current': id === view ? 'page' : null, onclick: () => showAdmin(id) }, icon(ic), label);
    const menuList = h('div', { class: 'menu-list', hidden: true },
      h('button', { type: 'button', onclick: () => { menuList.hidden = true; changeOwnPassword(); } }, icon('key'), 'تغيير كلمة المرور'),
      h('button', { type: 'button', onclick: logout }, icon('out'), 'تسجيل الخروج'));

    mount(h('div', { class: 'admin' },
      h('aside', { class: 'sidebar' },
        h('div', { class: 'logos' }, state.companies.map((c) => c.logo ? h('img', { src: `/logos/${c.logo}`, alt: c.name }) : null)),
        h('div', { class: 'brand' }, 'نظام الحضور والانصراف', h('span', {}, 'لوحة الإدارة')),
        h('nav', {}, NAV.map(navBtn)),
        h('div', { class: 'me' }, avatar(u.full_name), h('div', { class: 'grow small' }, h('div', {}, u.full_name), h('div', { class: 'muted' }, 'مدير')),
          h('button', { class: 'icon-btn', type: 'button', title: 'تغيير كلمة المرور', onclick: changeOwnPassword }, icon('key')),
          h('button', { class: 'icon-btn', type: 'button', title: 'تسجيل الخروج', onclick: logout }, icon('out')))),
      h('div', {},
        h('div', { class: 'admin-topbar' },
          h('div', { class: 'mini-logos' }, state.companies.map((c) => logoChip(c.logo))),
          h('div', { class: 'menu' }, h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'القائمة', onclick: () => { menuList.hidden = !menuList.hidden; } }, icon('menu')), menuList)),
        main),
      h('nav', { class: 'bottom-nav' }, NAV.map(navBtn))));

    main.append(h('div', { class: 'card' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })));
    try {
      const ov = await api('/api/admin/overview');
      state.skew = new Date(ov.server_now) - Date.now();
      state.companies = ov.companies;
      state.accWarn = ov.accuracy_warn_m;
      main.replaceChildren();
      ({ home: viewHome, records: viewRecords, staff: viewStaff, managers: viewManagers, settings: viewSettings })[view](main, ov);
    } catch (e) {
      if (e.status !== 401) main.replaceChildren(msg('error', e.message,
        h('div', {}, h('button', { class: 'btn sm mt', onclick: () => showAdmin(view) }, icon('refresh'), 'إعادة المحاولة'))));
    }
  }

  function head(title, sub, ...actions) {
    return h('div', { class: 'section-head' }, h('div', {}, h('h1', {}, title), sub ? h('p', {}, sub) : null), h('div', { class: 'row' }, actions));
  }

  const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} كم` : `${m} م`);
  const mapsUrl = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  // تقدير المكان: في المكتب / خارج المكتب / غير مؤكد — مع رابط الخريطة للتأكد بنفسك.
  function locLink(lat, lng, acc, place) {
    if (lat == null) return h('span', { class: 'muted' }, '—');
    const accText = `دقة القراءة ±${Math.round(acc)} م`;
    let badge;
    if (!place) {
      const weak = acc > (state.accWarn || 100);
      badge = h('span', { class: 'acc' + (weak ? ' weak' : ''), title: accText }, `±${Math.round(acc)}م`);
    } else if (place.place === 'inside') {
      badge = h('span', { class: 'pill in', title: `على بعد ${fmtDist(place.distance_m)} من المكتب · ${accText}` }, 'في المكتب');
    } else if (place.place === 'outside') {
      badge = h('span', { class: 'pill off', title: `خارج نطاق المكتب · ${accText}` }, `خارج المكتب · ${fmtDist(place.distance_m)}`);
    } else {
      badge = h('span', { class: 'pill open', title: `القراءة قريبة لكن دقتها لا تكفي للحكم · ${accText}` }, `غير مؤكد · ${fmtDist(place.distance_m)}`);
    }
    return h('span', { class: 'loc' }, badge,
      h('a', { href: mapsUrl(lat, lng), target: '_blank', rel: 'noopener noreferrer', title: 'افتح الموقع على الخريطة' }, icon('map'), 'الخريطة'));
  }
  const needsReview = (r) => [r.in_place, r.out_place].some((p) => p && p.place !== 'inside');

  // --- اليوم ---
  function viewHome(main, ov) {
    const active = ov.employees.filter((e) => e.active);
    const present = active.filter((e) => e.open_record);
    const absent = active.filter((e) => !e.open_record);
    const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
    const durEls = [];

    main.append(
      installBanner(),
      notifyBanner(),
      head('لوحة اليوم', F.date.format(now()), h('button', { class: 'btn ghost sm', onclick: () => showAdmin('home') }, icon('refresh'), 'تحديث')),
      h('div', { class: 'kpis' },
        h('div', { class: 'card kpi hero' }, h('span', { class: 'ic' }, icon('users')),
          h('div', {}, h('div', { class: 'num' }, present.length, h('small', {}, ` / ${active.length}`)), h('div', { class: 'lbl' }, 'في الدوام الآن'))),
        ov.companies.map((c) => {
          const list = active.filter((e) => e.company_id === c.id);
          const n = list.filter((e) => e.open_record).length;
          return h('div', { class: 'card kpi' }, logoChip(c.logo),
            h('div', { class: 'grow' }, h('div', { class: 'num' }, n, h('small', {}, ` / ${list.length}`)), h('div', { class: 'lbl' }, c.name),
              h('div', { class: 'bar' }, (() => { const i = h('i'); i.style.width = pct(n, list.length) + '%'; return i; })())));
        })),
      h('div', { class: 'card' }, h('h3', { class: 'card-title' }, `في الدوام الآن (${present.length})`),
        present.length ? h('ul', { class: 'people' }, present.map((e) => {
          const o = e.open_record;
          const dur = h('span', { class: 'nowrap' }, fmtDuration(minutesSince(o.check_in_at)));
          durEls.push([dur, o.check_in_at]);
          return h('li', { class: 'person' }, avatar(e.full_name, e.company_id),
            h('div', { class: 'grow' }, h('div', { class: 'name' }, e.full_name),
              h('div', { class: 'meta' }, companyTag(e.company_id), h('span', {}, `دخل ${fmtTime(o.check_in_at)}`))),
            h('div', { class: 'side' }, h('span', { class: 'pill in' }, dur), locLink(o.in_lat, o.in_lng, o.in_accuracy, o.in_place)));
        })) : h('div', { class: 'empty' }, icon('clock'), h('div', {}, 'لا يوجد أحد في الدوام حاليًا'))),
      h('div', { class: 'card' }, h('h3', { class: 'card-title' }, `خارج الدوام (${absent.length})`),
        absent.length ? h('ul', { class: 'people' }, absent.map((e) => h('li', { class: 'person' }, avatar(e.full_name, e.company_id),
          h('div', { class: 'grow' }, h('div', { class: 'name' }, e.full_name), h('div', { class: 'meta' }, companyTag(e.company_id))),
          h('div', { class: 'side small muted' }, e.last_activity_at ? `آخر تسجيل: ${fmtDate(e.last_activity_at)} ${fmtTime(e.last_activity_at)}` : 'لم يسجّل بعد'))))
          : h('div', { class: 'empty' }, 'الجميع في الدوام 👏')),
      h('p', { class: 'small muted' }, 'المواقع تقريبية حسب أجهزة الموظفين؛ الدقة موضّحة بجانب كل موقع.'));
    every(30000, () => durEls.forEach(([el, t]) => { el.textContent = fmtDuration(minutesSince(t)); }));
    every(60000, () => { if (document.visibilityState === 'visible' && state.view === 'home' && !document.querySelector('dialog')) showAdmin('home'); });
  }

  // --- التقارير ---
  const filters = { preset: 'month', company: '', employee: '', from: '', to: '', status: '' };
  function applyPreset(p) {
    const t = today();
    const ms = t.slice(0, 8) + '01';
    const ranges = {
      today: [t, t],
      yesterday: [addDays(t, -1), addDays(t, -1)],
      week: [addDays(t, -6), t],
      month: [ms, t],
      lastmonth: [addDays(ms, -1).slice(0, 8) + '01', addDays(ms, -1)],
    };
    if (ranges[p]) [filters.from, filters.to] = ranges[p];
    filters.preset = p;
  }

  function viewRecords(main, ov) {
    if (!filters.from) applyPreset('month');
    const results = h('div', {});
    const csv = h('a', { class: 'btn', download: '' }, icon('download'), 'تصدير Excel');
    const qs = () => new URLSearchParams(Object.entries(filters).filter(([k, v]) => v && k !== 'preset')).toString();

    const seg = (items, key, onPick) => h('div', { class: 'seg' }, items.map(([v, l]) =>
      h('button', { type: 'button', 'aria-pressed': String(String(filters[key]) === String(v)), onclick: () => onPick(v) }, l)));
    const rerender = () => { main.replaceChildren(); viewRecords(main, ov); };

    const from = h('input', { type: 'date', id: 'f-from', value: filters.from, onchange: (e) => { filters.from = e.target.value; filters.preset = 'custom'; rerender(); } });
    const to = h('input', { type: 'date', id: 'f-to', value: filters.to, onchange: (e) => { filters.to = e.target.value; filters.preset = 'custom'; rerender(); } });
    const empSel = h('select', { id: 'f-emp', onchange: (e) => { filters.employee = e.target.value; load(); } },
      h('option', { value: '' }, 'كل الموظفين'),
      ov.employees.filter((e) => !filters.company || String(e.company_id) === String(filters.company))
        .map((e) => { const o = h('option', { value: e.id }, e.full_name + (e.active ? '' : ' (موقوف)')); if (String(e.id) === filters.employee) o.selected = true; return o; }));
    const stSel = h('select', { id: 'f-st', onchange: (e) => { filters.status = e.target.value; load(); } },
      [['', 'كل الحالات'], ['completed', 'مكتمل'], ['open', 'مفتوح (لم يسجّل خروج)']].map(([v, l]) => { const o = h('option', { value: v }, l); if (v === filters.status) o.selected = true; return o; }));

    main.append(
      head('التقارير', 'سجلات الحضور والساعات لكل موظف', csv),
      h('div', { class: 'card' },
        h('div', { class: 'row', }, seg([['today', 'اليوم'], ['yesterday', 'أمس'], ['week', 'آخر 7 أيام'], ['month', 'هذا الشهر'], ['lastmonth', 'الشهر الماضي']], 'preset', (p) => { applyPreset(p); rerender(); })),
        h('div', { class: 'row mt' }, seg([['', 'كل الشركات'], ...ov.companies.map((c) => [c.id, c.name])], 'company', (c) => { filters.company = String(c); filters.employee = ''; rerender(); })),
        h('div', { class: 'filters mt' },
          h('div', {}, h('label', { for: 'f-from' }, 'من'), from),
          h('div', {}, h('label', { for: 'f-to' }, 'إلى'), to),
          h('div', {}, h('label', { for: 'f-emp' }, 'الموظف'), empSel),
          h('div', {}, h('label', { for: 'f-st' }, 'الحالة'), stSel))),
      results);

    async function load() {
      csv.href = '/api/admin/records.xlsx?' + qs();
      results.replaceChildren(h('div', { class: 'card mt' }, h('div', { class: 'skeleton' }), h('div', { class: 'skeleton' })));
      try {
        const d = await api('/api/admin/records?' + qs());
        const totalMin = d.totals.reduce((s, t) => s + t.completed_minutes, 0);
        const open = d.records.filter((r) => r.status === 'open').length;
        const flagged = d.records.filter(needsReview);
        let reviewOnly = false;
        const tableWrap = h('div', {});
        const reviewKpi = h('button', { type: 'button', class: 'card kpi kpi-btn' + (flagged.length ? ' warn' : ''), 'aria-pressed': 'false',
          title: 'اضغط لعرض التسجيلات التي تحتاج مراجعة فقط', onclick: () => { reviewOnly = !reviewOnly; drawTable(); } },
        h('span', { class: 'ic' }, icon('pin')), h('div', {}, h('div', { class: 'num' }, flagged.length), h('div', { class: 'lbl' }, 'خارج المكتب أو غير مؤكد')));
        const drawTable = () => {
          reviewKpi.setAttribute('aria-pressed', String(reviewOnly));
          tableWrap.replaceChildren(recordsTable(reviewOnly ? flagged : d.records, d.truncated, reviewOnly ? () => { reviewOnly = false; drawTable(); } : null));
        };
        drawTable();
        results.replaceChildren(
          h('div', { class: 'kpis mt' },
            h('div', { class: 'card kpi hero' }, h('span', { class: 'ic' }, icon('clock')), h('div', {}, h('div', { class: 'num' }, fmtDuration(totalMin)), h('div', { class: 'lbl' }, 'مجموع الساعات المكتملة'))),
            h('div', { class: 'card kpi' }, h('span', { class: 'ic' }, icon('check')), h('div', {}, h('div', { class: 'num' }, d.records.length - open), h('div', { class: 'lbl' }, 'دوام مكتمل'))),
            h('div', { class: 'card kpi' }, h('span', { class: 'ic' }, icon('alert')), h('div', {}, h('div', { class: 'num' }, open), h('div', { class: 'lbl' }, 'مفتوح (غير محسوب)'))),
            reviewKpi),
          totalsTable(d.totals),
          tableWrap);
      } catch (e) {
        if (e.status !== 401) results.replaceChildren(h('div', { class: 'mt' }, msg('error', e.message)));
      }
    }
    load();
  }

  function totalsTable(totals) {
    return h('div', { class: 'card' }, h('h3', { class: 'card-title' }, 'ساعات كل موظف'),
      totals.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, ['الموظف', 'الشركة', 'أيام مكتملة', 'مفتوح', 'مجموع الساعات'].map((t) => h('th', {}, t)))),
        h('tbody', {}, totals.map((t) => h('tr', {},
          h('td', { 'data-label': 'الموظف' }, h('b', {}, t.employee_name)),
          h('td', { 'data-label': 'الشركة' }, t.company_name),
          h('td', { 'data-label': 'أيام مكتملة', class: 'num' }, t.completed_count),
          h('td', { 'data-label': 'مفتوح', class: 'num' }, t.open_count ? h('span', { class: 'pill open' }, t.open_count) : '0'),
          h('td', { 'data-label': 'مجموع الساعات', class: 'num' }, h('b', {}, fmtDuration(t.completed_minutes))))))))
        : h('div', { class: 'empty' }, icon('report'), h('div', {}, 'لا توجد سجلات في هذه الفترة')));
  }

  function recordsTable(records, truncated, clearReview) {
    if (!records.length && !clearReview) return h('div');
    const td = (label, ...c) => h('td', { 'data-label': label }, h('span', {}, ...c));
    return h('div', { class: 'card' },
      h('div', { class: 'row spread' }, h('h3', { class: 'card-title' }, clearReview ? `تحتاج مراجعة (${records.length})` : `تفاصيل الحضور (${records.length})`),
        clearReview ? h('button', { class: 'btn ghost sm', type: 'button', onclick: clearReview }, icon('x'), 'عرض الكل') : null),
      clearReview ? h('div', { class: 'field' }, msg('info', 'تسجيلات بعيدة عن المكتب أو دقتها لا تكفي للحكم. اضغط «الخريطة» بجانب كل واحدة للتأكد.')) : null,
      !records.length ? h('div', { class: 'empty' }, icon('check'), h('div', {}, 'كل التسجيلات من داخل المكاتب 👍')) : null,
      truncated ? h('div', { class: 'field' }, msg('warn', 'تم عرض أول 5000 سجل. ضيّق الفترة لعرض الباقي.')) : null,
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, ['الموظف', 'الشركة', 'التاريخ', 'الدخول', 'موقع الدخول', 'الخروج', 'موقع الخروج', 'المدة', 'الحالة'].map((t) => h('th', {}, t)))),
        h('tbody', {}, records.map((r) => h('tr', {},
          td('الموظف', h('b', {}, r.employee_name)),
          td('الشركة', r.company_name),
          td('التاريخ', h('span', { class: 'nowrap' }, fmtDate(r.check_in_at))),
          td('الدخول', h('span', { class: 'nowrap' }, fmtTime(r.check_in_at))),
          td('موقع الدخول', locLink(r.in_lat, r.in_lng, r.in_accuracy, r.in_place)),
          td('الخروج', h('span', { class: 'nowrap' }, r.check_out_at ? fmtTime(r.check_out_at) : '—'),
            r.check_out_at && ymdOf(new Date(r.check_out_at)) !== r.shift_date ? h('div', { class: 'small muted' }, fmtDate(r.check_out_at)) : null),
          td('موقع الخروج', locLink(r.out_lat, r.out_lng, r.out_accuracy, r.out_place)),
          td('المدة', r.status === 'completed' ? h('b', { class: 'nowrap' }, fmtDuration(r.duration_minutes)) : h('span', { class: 'muted' }, '—')),
          td('الحالة', r.status === 'completed' ? h('span', { class: 'pill done' }, 'مكتمل') : h('span', { class: 'pill open' }, 'مفتوح'))))))));
  }

  // --- الموظفون ---
  const staffFilter = { q: '', company: '' };
  function viewStaff(main, ov) {
    const grid = h('div', { class: 'staff-grid' });
    const search = h('input', { type: 'search', placeholder: 'ابحث بالاسم أو اسم المستخدم', value: staffFilter.q, oninput: (e) => { staffFilter.q = e.target.value; draw(); } });
    const segWrap = h('div');
    const activeCount = ov.employees.filter((e) => e.active).length;

    function drawSeg() {
      segWrap.replaceChildren(h('div', { class: 'seg' }, [['', 'الكل'], ...ov.companies.map((c) => [String(c.id), c.name])].map(([v, l]) =>
        h('button', { type: 'button', 'aria-pressed': String(staffFilter.company === v), onclick: () => { staffFilter.company = v; drawSeg(); draw(); } }, l))));
    }
    function draw() {
      const q = staffFilter.q.trim().toLowerCase();
      const list = ov.employees.filter((e) => (!staffFilter.company || String(e.company_id) === staffFilter.company)
        && (!q || e.full_name.toLowerCase().includes(q) || e.username.toLowerCase().includes(q)));
      grid.replaceChildren(...(list.length ? list.map((e) => h('div', { class: 'staff-card' + (e.active ? '' : ' inactive') },
        h('div', { class: 'head' }, avatar(e.full_name, e.company_id),
          h('div', { class: 'grow' }, h('div', { class: 'name' }, h('b', {}, e.full_name)), h('div', { class: 'small muted ltr' }, '@' + e.username)),
          !e.active ? h('span', { class: 'pill off' }, 'موقوف') : e.open_record ? h('span', { class: 'pill in' }, 'في الدوام') : h('span', { class: 'pill out' }, 'خارج الدوام')),
        h('div', { class: 'small' }, companyTag(e.company_id)),
        h('div', { class: 'actions' },
          h('button', { class: 'btn ghost sm', type: 'button', onclick: () => editUser(e, ov) }, icon('edit'), 'تعديل'),
          h('button', { class: 'btn ghost sm', type: 'button', onclick: () => resetPassword(e) }, icon('key'), 'كلمة مرور'),
          h('button', { class: `btn sm ${e.active ? 'danger' : 'ghost'}`, type: 'button', onclick: () => toggleActive(e, 'staff') }, icon('power'), e.active ? 'إيقاف' : 'تفعيل'))))
        : [h('div', { class: 'card empty' }, icon('users'), h('div', {}, ov.employees.length ? 'لا نتائج مطابقة' : 'لم تُضف أي موظف بعد'))]));
    }

    main.append(
      head('الموظفون', `${activeCount} موظف فعّال`, h('button', { class: 'btn', type: 'button', onclick: () => addUser('employee', ov) }, icon('plus'), 'إضافة موظف')),
      h('div', { class: 'toolbar' }, h('div', { class: 'search' }, icon('search'), search), segWrap),
      grid,
      h('p', { class: 'small muted mt' }, 'إيقاف الحساب يمنع الدخول ويحتفظ بكل سجلاته.'));
    drawSeg(); draw();
  }

  function companyPicker(selected, name = 'company') {
    return h('div', { class: 'company-pick' }, state.companies.map((c) =>
      h('label', {}, h('input', { type: 'radio', name, value: c.id, checked: c.id === selected, required: true }),
        c.logo ? h('img', { src: `/logos/${c.logo}`, alt: '' }) : null, c.name)));
  }

  function addUser(role, ov) {
    const isEmp = role === 'employee';
    const name = h('input', { id: 'a-name', required: true, maxlength: 80, autocomplete: 'off' });
    const user = h('input', { id: 'a-user', required: true, dir: 'ltr', autocapitalize: 'none', autocomplete: 'off', spellcheck: 'false', pattern: '[A-Za-z0-9._\\-]{3,40}', placeholder: 'ahmad.k' });
    const pw = h('input', { id: 'a-pass', required: true, dir: 'ltr', minlength: 8, autocomplete: 'off', value: genPassword() });
    const picker = isEmp ? companyPicker(staffFilter.company ? Number(staffFilter.company) : null) : null;
    const { dlg } = openDialog({
      title: isEmp ? 'إضافة موظف جديد' : 'إضافة مدير جديد',
      submit: 'إضافة',
      body: [
        h('div', { class: 'field' }, h('label', { for: 'a-name' }, 'الاسم الكامل'), name),
        isEmp ? h('div', { class: 'field' }, h('label', {}, 'الشركة'), picker) : msg('info', 'المدير يرى بيانات الشركتين ويستطيع إدارة الموظفين والمدراء.'),
        h('div', { class: 'field mt' }, h('label', { for: 'a-user' }, 'اسم المستخدم'), user, h('div', { class: 'hint' }, 'بالإنجليزية بدون مسافات، مثل ahmad أو ahmad.k')),
        h('div', { class: 'field' }, h('label', { for: 'a-pass' }, 'كلمة المرور'),
          h('div', { class: 'input-action' }, pw, h('button', { class: 'btn ghost', type: 'button', onclick: () => { pw.value = genPassword(); } }, icon('refresh'), 'توليد')),
          h('div', { class: 'hint' }, 'سلّمها للشخص، ويمكنه تغييرها بعد الدخول')),
      ],
      onSubmit: async () => {
        const companyId = isEmp ? Number(dlg.querySelector('input[name=company]:checked')?.value) : undefined;
        if (isEmp && !companyId) throw new Error('اختر الشركة');
        await api('/api/admin/users', { method: 'POST', body: { role, full_name: name.value, username: user.value.trim(), password: pw.value, company_id: companyId } });
        showCredentials(name.value, user.value.trim(), pw.value, isEmp ? companyById(companyId)?.name : 'مدير');
        showAdmin(isEmp ? 'staff' : 'managers');
      },
    });
    name.focus();
  }

  function showCredentials(fullName, username, password, subtitle) {
    openDialog({
      title: 'تمت الإضافة بنجاح',
      submit: 'تم', cancel: null,
      body: [
        msg('ok', `تم إنشاء حساب ${fullName} (${subtitle}).`),
        h('p', {}, 'أرسل له بيانات الدخول التالية:'),
        h('div', { class: 'secret' },
          h('div', {}, 'اسم المستخدم: ', h('b', { class: 'ltr' }, username)),
          h('div', {}, 'كلمة المرور: ', h('b', { class: 'ltr' }, password)),
          h('div', { class: 'small muted' }, location.origin)),
        h('p', { class: 'small muted' }, 'لن تظهر كلمة المرور مرة أخرى. يمكنك تعيين كلمة جديدة لاحقًا.'),
      ],
    });
  }

  function editUser(e) {
    const isEmp = !!e.company_id;
    const name = h('input', { id: 'e-name', value: e.full_name, maxlength: 80, required: true });
    const { dlg } = openDialog({
      title: 'تعديل البيانات',
      body: [
        h('div', { class: 'field' }, h('label', { for: 'e-name' }, 'الاسم الكامل'), name),
        isEmp ? h('div', { class: 'field' }, h('label', {}, 'الشركة'), companyPicker(e.company_id, 'ecompany'),
          h('div', { class: 'hint' }, 'تغيير الشركة يسري على التسجيلات الجديدة فقط.')) : null,
      ],
      onSubmit: async () => {
        const body = { full_name: name.value };
        if (isEmp) body.company_id = Number(dlg.querySelector('input[name=ecompany]:checked').value);
        await api(`/api/admin/users/${e.id}`, { method: 'PATCH', body });
        toast('تم حفظ التعديلات', 'ok');
        showAdmin();
      },
    });
  }

  function resetPassword(e) {
    const pw = h('input', { id: 'r-pass', dir: 'ltr', minlength: 8, required: true, autocomplete: 'off', value: genPassword() });
    openDialog({
      title: `كلمة مرور جديدة — ${e.full_name}`,
      submit: 'تعيين',
      body: [
        h('div', { class: 'field' }, h('label', { for: 'r-pass' }, 'كلمة المرور الجديدة'),
          h('div', { class: 'input-action' }, pw, h('button', { class: 'btn ghost', type: 'button', onclick: () => { pw.value = genPassword(); } }, icon('refresh'), 'توليد'))),
        h('p', { class: 'small muted' }, 'سيتم تسجيل خروجه من أجهزته، ويدخل بكلمة المرور الجديدة.'),
      ],
      onSubmit: async () => {
        await api(`/api/admin/users/${e.id}`, { method: 'PATCH', body: { password: pw.value } });
        showCredentials(e.full_name, e.username, pw.value, e.company_name || 'مدير');
      },
    });
  }

  function toggleActive(e, back) {
    const stopping = e.active;
    openDialog({
      title: stopping ? 'إيقاف الحساب' : 'تفعيل الحساب',
      submit: stopping ? 'إيقاف الحساب' : 'تفعيل', danger: stopping,
      body: [h('p', {}, stopping
        ? `لن يتمكن ${e.full_name} من الدخول، وستبقى كل سجلاته محفوظة. يمكنك إعادة تفعيله لاحقًا.`
        : `سيتمكن ${e.full_name} من الدخول مجددًا.`),
      stopping && e.open_record ? msg('warn', 'لديه دوام مفتوح حاليًا وسيبقى مفتوحًا.') : null],
      onSubmit: async () => {
        await api(`/api/admin/users/${e.id}`, { method: 'PATCH', body: { active: !e.active } });
        toast(stopping ? 'تم إيقاف الحساب' : 'تم تفعيل الحساب', 'ok');
        showAdmin(back);
      },
    });
  }

  // --- المدراء ---
  function viewManagers(main, ov) {
    main.append(
      head('المدراء', 'كل مدير يرى بيانات الشركتين ويدير الحسابات', h('button', { class: 'btn', type: 'button', onclick: () => addUser('manager', ov) }, icon('plus'), 'إضافة مدير')),
      h('div', { class: 'staff-grid' }, ov.managers.map((m) => {
        const self = m.id === ov.me_id;
        return h('div', { class: 'staff-card' + (m.active ? '' : ' inactive') },
          h('div', { class: 'head' }, avatar(m.full_name),
            h('div', { class: 'grow' }, h('b', {}, m.full_name), h('div', { class: 'small muted ltr' }, '@' + m.username)),
            self ? h('span', { class: 'pill done plain' }, 'أنت') : m.active ? h('span', { class: 'pill in' }, 'فعّال') : h('span', { class: 'pill off' }, 'موقوف')),
          h('div', { class: 'actions' },
            h('button', { class: 'btn ghost sm', type: 'button', onclick: () => editUser(m) }, icon('edit'), 'تعديل الاسم'),
            self ? h('button', { class: 'btn ghost sm', type: 'button', onclick: changeOwnPassword }, icon('key'), 'كلمة مروري')
              : h('button', { class: 'btn ghost sm', type: 'button', onclick: () => resetPassword(m) }, icon('key'), 'كلمة مرور'),
            self ? null : h('button', { class: `btn sm ${m.active ? 'danger' : 'ghost'}`, type: 'button', onclick: () => toggleActive(m, 'managers') }, icon('power'), m.active ? 'إيقاف' : 'تفعيل')));
      })));
  }

  // --- الإعدادات ---
  function viewSettings(main, ov) {
    main.append(head('الإعدادات', 'أسماء الشركات وحسابك'),
      h('div', { class: 'card' }, h('h3', { class: 'card-title' }, 'الشركات'),
        ov.companies.map((c) => {
          const inp = h('input', { value: c.name, maxlength: 80, 'aria-label': 'اسم الشركة' });
          return h('form', { class: 'row field one-line', onsubmit: async (ev) => {
            ev.preventDefault();
            try { await api(`/api/admin/companies/${c.id}`, { method: 'PATCH', body: { name: inp.value } }); toast('تم حفظ اسم الشركة', 'ok'); }
            catch (ex) { if (ex.status !== 401) toast(ex.message, 'error'); }
          } }, logoChip(c.logo, 'kpi-logo'), h('div', { class: 'grow' }, inp), h('button', { class: 'btn sm', type: 'submit' }, 'حفظ'));
        })),
      h('div', { class: 'card' }, h('h3', { class: 'card-title' }, 'مواقع المكاتب'),
        h('p', { class: 'small muted' }, 'تُستخدم لتقدير إن كان التسجيل من داخل المكتب أو خارجه. أدق طريقة: افتح هذه الصفحة من هاتفك وأنت داخل المكتب واضغط «موقعي الحالي».'),
        ov.companies.map(officeForm)),
      notifyCard(),
      myAccountCard());
  }

  // يقبل رابط خرائط Google أو «خط عرض, خط طول».
  function parseLatLng(text) {
    let t = String(text || '');
    try { t = decodeURIComponent(t); } catch { /* نص عادي */ }
    // روابط «place» في Google Maps فيها مركز الخريطة بعد @ والدبوس نفسه بعد !3d…!4d — الدبوس أدق.
    const pin = t.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/);
    if (pin) return { lat: Number(pin[1]), lng: Number(pin[2]) };
    const m = t.match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
    return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
  }

  function officeForm(c) {
    const has = c.office_lat != null;
    const coords = h('input', { dir: 'ltr', value: has ? `${c.office_lat}, ${c.office_lng}` : '', placeholder: 'الصق رابط Google Maps أو 31.9, 35.2', 'aria-label': 'موقع المكتب' });
    const radius = h('input', { type: 'number', min: 10, max: 1000, step: 5, value: c.office_radius_m || 50, dir: 'ltr', 'aria-label': 'النطاق بالمتر' });
    const mapLink = h('a', { class: 'btn ghost sm', target: '_blank', rel: 'noopener noreferrer', href: has ? mapsUrl(c.office_lat, c.office_lng) : '#' }, icon('map'), 'الخريطة');
    const status = h('div', { class: 'hint' });
    const hereBtn = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => {
      if (!navigator.geolocation) return toast('المتصفح لا يدعم تحديد الموقع', 'error');
      hereBtn.disabled = true; status.textContent = 'جارٍ تحديد موقعك…';
      navigator.geolocation.getCurrentPosition((p) => {
        hereBtn.disabled = false;
        coords.value = `${p.coords.latitude.toFixed(7)}, ${p.coords.longitude.toFixed(7)}`;
        status.textContent = `تم أخذ موقعك (دقة ±${Math.round(p.coords.accuracy)} م). اضغط «حفظ» لاعتماده.`;
      }, () => { hereBtn.disabled = false; status.textContent = 'تعذّر تحديد موقعك. اسمح بإذن الموقع وحاول مرة أخرى.'; },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    } }, icon('pin'), 'موقعي الحالي');
    return h('form', { class: 'office', onsubmit: async (ev) => {
      ev.preventDefault();
      const ll = parseLatLng(coords.value);
      if (!ll) return toast('لم أتعرف على الإحداثيات. الصق رابط Google Maps أو اكتب: خط العرض, خط الطول', 'error');
      try {
        await api(`/api/admin/companies/${c.id}`, { method: 'PATCH', body: { office_lat: ll.lat, office_lng: ll.lng, office_radius_m: Number(radius.value) } });
        coords.value = `${ll.lat}, ${ll.lng}`;
        mapLink.href = mapsUrl(ll.lat, ll.lng);
        toast(`تم حفظ موقع مكتب ${c.name}`, 'ok');
      } catch (ex) { if (ex.status !== 401) toast(ex.message, 'error'); }
    } },
      h('div', { class: 'row' }, logoChip(c.logo), h('b', {}, c.name)),
      h('div', { class: 'office-grid' },
        h('div', {}, h('label', {}, 'موقع المكتب'), coords),
        h('div', {}, h('label', {}, 'النطاق (متر)'), radius)),
      h('div', { class: 'hint' }, 'النطاق يشمل المبنى وهامش خطأ GPS داخل المباني. 50 م مناسب لمكتب 140–150 م².'),
      status,
      h('div', { class: 'row mt' }, h('button', { class: 'btn sm', type: 'submit' }, 'حفظ'), hereBtn, mapLink));
  }

  // اسم المدير الظاهر في اللوحة، قابل للتعديل من حسابه.
  function myAccountCard() {
    const u = state.me.user;
    const nameInp = h('input', { id: 'my-name', value: u.full_name, maxlength: 80, required: true });
    return h('div', { class: 'card' }, h('h3', { class: 'card-title' }, 'حسابي'),
      h('form', { class: 'field', onsubmit: async (ev) => {
        ev.preventDefault();
        try {
          await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { full_name: nameInp.value } });
          await refreshMe();
          toast('تم حفظ الاسم', 'ok');
          showAdmin('settings');
        } catch (ex) { if (ex.status !== 401) toast(ex.message, 'error'); }
      } },
        h('label', { for: 'my-name' }, 'اسمك كما يظهر في النظام'),
        h('div', { class: 'input-action' }, nameInp, h('button', { class: 'btn', type: 'submit' }, 'حفظ')),
        h('div', { class: 'hint ltr' }, '@' + u.username)),
      h('div', { class: 'row mt' },
        h('button', { class: 'btn ghost', type: 'button', onclick: changeOwnPassword }, icon('key'), 'تغيير كلمة المرور'),
        h('button', { class: 'btn danger', type: 'button', onclick: logout }, icon('out'), 'تسجيل الخروج')));
  }

  // ---------- تحديث مباشر للوحة الإدارة ----------
  // عند أي دخول/خروج يرسل الخادم حدثًا فورًا، فتظهر رسالة وتتحدث الصفحة بدون إعادة تحميل.
  let live = null;
  function startLive() {
    if (live || !window.EventSource) return;
    live = new EventSource('/api/admin/events');
    live.addEventListener('attendance', (e) => {
      let ev;
      try { ev = JSON.parse(e.data); } catch { return; }
      const where = !ev.place ? '' : ev.place.place === 'inside' ? ' · في المكتب'
        : ` · ${ev.place.place === 'outside' ? 'خارج المكتب' : 'غير مؤكد'} (${fmtDist(ev.place.distance_m)})`;
      toast(`${ev.kind === 'in' ? 'دخول' : 'خروج'}: ${ev.employee_name} — ${fmtTime(ev.at)}${where}`, ev.place && ev.place.place !== 'inside' ? 'error' : 'ok');
      // تحديث الصفحة الحالية إن لم يكن المدير وسط نافذة أو كتابة
      if (['home', 'records'].includes(state.view) && !document.querySelector('dialog') && !document.activeElement?.matches('input, select')) {
        showAdmin(state.view);
      }
    });
  }
  function stopLive() { if (live) { live.close(); live = null; } }

  // ---------- إشعارات الهاتف للمدير (Web Push) ----------
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  function b64ToBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
  }
  async function currentSub() {
    if (!pushSupported()) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }
  async function enablePush() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('لم يتم السماح بالإشعارات. فعّلها من إعدادات المتصفح/الهاتف لهذا التطبيق ثم حاول مرة أخرى.');
    const { publicKey } = await api('/api/admin/push/key');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    try {
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    } catch {
      // اشتراك قديم بمفتاح مختلف — نلغيه ونعيد المحاولة
      if (sub) await sub.unsubscribe();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
    }
    await api('/api/admin/push/subscribe', { method: 'POST', body: sub.toJSON() });
  }
  async function disablePush() {
    const sub = await currentSub();
    if (!sub) return;
    await api('/api/admin/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe();
  }
  // يتأكد أن اشتراك هذا الجهاز محفوظ على الخادم (مثلًا بعد نقل قاعدة البيانات)
  async function syncPush() {
    try {
      const sub = await currentSub();
      if (sub && Notification.permission === 'granted') await api('/api/admin/push/subscribe', { method: 'POST', body: sub.toJSON() });
    } catch { /* غير مهم */ }
  }

  function pushHelpText() {
    if (!pushSupported()) {
      return isIos() && !isStandalone()
        ? 'على iPhone: ثبّت التطبيق أولًا (المشاركة ← «إضافة إلى الشاشة الرئيسية») ثم افتحه من الأيقونة وفعّل الإشعارات من هنا.'
        : 'هذا المتصفح لا يدعم الإشعارات. جرّب Chrome على Android أو التطبيق المثبّت على iPhone.';
    }
    if (Notification.permission === 'denied') return 'الإشعارات محظورة لهذا التطبيق. فعّلها من إعدادات الهاتف/المتصفح (الإشعارات) ثم ارجع هنا.';
    return null;
  }

  // بطاقة الإعدادات: تشغيل/إيقاف إشعارات هذا الجهاز + إشعار تجريبي
  function notifyCard() {
    const body = h('div', {}, h('div', { class: 'skeleton' }));
    const card = h('div', { class: 'card' }, h('h3', { class: 'card-title' }, 'إشعارات الحضور على هذا الجهاز'), body);
    async function draw() {
      const help = pushHelpText();
      if (help) return body.replaceChildren(msg('info', help));
      const on = !!(await currentSub().catch(() => null)) && Notification.permission === 'granted';
      const toggle = h('button', { class: `btn ${on ? 'danger' : ''}`, type: 'button', onclick: async () => {
        toggle.disabled = true;
        try {
          if (on) { await disablePush(); toast('تم إيقاف الإشعارات على هذا الجهاز', 'ok'); }
          else { await enablePush(); toast('تم تفعيل الإشعارات على هذا الجهاز', 'ok'); }
        } catch (e) { if (e.status !== 401) toast(e.message, 'error'); }
        draw();
      } }, icon(on ? 'x' : 'check'), on ? 'إيقاف الإشعارات' : 'تفعيل الإشعارات');
      const test = on ? h('button', { class: 'btn ghost', type: 'button', onclick: async () => {
        test.disabled = true;
        try { await api('/api/admin/push/test', { method: 'POST', body: {} }); toast('تم إرسال إشعار تجريبي', 'ok'); }
        catch (e) { if (e.status !== 401) toast(e.message, 'error'); }
        test.disabled = false;
      } }, 'إرسال إشعار تجريبي') : null;
      body.replaceChildren(
        h('div', { class: 'row field' }, h('span', { class: `pill ${on ? 'in' : 'out'}` }, on ? 'مفعّلة' : 'متوقفة'),
          h('span', { class: 'small muted' }, on ? 'سيصلك إشعار عند كل تسجيل دخول أو خروج، حتى لو كان التطبيق مغلقًا.' : 'لن تصلك إشعارات على هذا الجهاز.')),
        h('div', { class: 'row' }, toggle, test),
        h('p', { class: 'hint' }, 'الإعداد لكل جهاز على حدة. تسجيل الخروج من الحساب يوقف الإشعارات على الجهاز.'));
    }
    draw();
    return card;
  }

  // تذكير صغير في لوحة اليوم لتفعيل الإشعارات (مرة واحدة لكل جهاز)
  function notifyBanner() {
    let dismissed = false;
    try { dismissed = localStorage.getItem('notifyDismissed') === '1'; } catch { /* تخزين غير متاح */ }
    if (dismissed || !pushSupported() || Notification.permission !== 'default') return null;
    const box = h('div', { class: 'install' });
    const close = h('button', { class: 'close', type: 'button', 'aria-label': 'إخفاء', onclick: () => {
      try { localStorage.setItem('notifyDismissed', '1'); } catch { /* تجاهل */ }
      box.remove();
    } }, icon('x'));
    const btn = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      btn.disabled = true;
      try { await enablePush(); toast('تم تفعيل الإشعارات', 'ok'); box.remove(); }
      catch (e) { btn.disabled = false; if (e.status !== 401) toast(e.message, 'error'); }
    } }, 'تفعيل');
    box.append(h('img', { src: '/icons/icon-192.png', alt: '' }),
      h('div', { class: 'txt' }, h('b', {}, 'فعّل إشعارات الحضور'), 'يصلك إشعار على هاتفك عند كل دخول أو خروج'), btn, close);
    return box;
  }

  // ---------- تثبيت التطبيق على الهاتف ----------
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; document.querySelectorAll('.install').forEach((b) => b.replaceWith(installBanner())); });
  window.addEventListener('appinstalled', () => { document.querySelectorAll('.install').forEach((b) => b.remove()); });
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isPhone = () => matchMedia('(pointer: coarse)').matches;

  function installBanner() {
    let dismissed = false;
    try { dismissed = localStorage.getItem('installDismissed') === '1'; } catch { /* تخزين غير متاح */ }
    if (isStandalone() || dismissed || (!installPrompt && !isPhone())) return null;
    const box = h('div', { class: 'install' });
    const close = h('button', { class: 'close', type: 'button', 'aria-label': 'إخفاء', onclick: () => {
      try { localStorage.setItem('installDismissed', '1'); } catch { /* تجاهل */ }
      box.remove();
    } }, icon('x'));
    let how;
    if (installPrompt) {
      how = h('button', { class: 'btn sm', type: 'button', onclick: async () => { installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; box.remove(); } }, 'تثبيت');
    }
    const tip = installPrompt ? 'افتحه من شاشة هاتفك مثل أي تطبيق'
      : isIos() ? 'من Safari اضغط زر المشاركة ⬆︎ ثم «إضافة إلى الشاشة الرئيسية»'
        : 'من قائمة المتصفح ⋮ اختر «إضافة إلى الشاشة الرئيسية» أو «تثبيت التطبيق»';
    box.append(h('img', { src: '/icons/icon-192.png', alt: '' }), h('div', { class: 'txt' }, h('b', {}, 'ثبّت التطبيق على هاتفك'), tip), how, close);
    return box;
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* اختياري */ }); });
  }

  // ---------- الإقلاع ----------
  async function refreshMe() {
    state.me = await api('/api/me');
    state.skew = new Date(state.me.server_now) - Date.now();
  }

  async function boot() {
    try {
      await refreshMe();
    } catch (e) {
      if (e.status === 401) return;
      return mount(h('div', { class: 'auth' }, h('div', { class: 'auth-card' }, msg('error', e.message,
        h('div', {}, h('button', { class: 'btn sm mt', onclick: boot }, icon('refresh'), 'إعادة المحاولة'))))));
    }
    if (state.me.user.role === 'manager') {
      try { state.companies = (await api('/api/companies')).companies; } catch { /* تُحمّل لاحقًا */ }
      showAdmin('home');
      startLive();
      syncPush();
    } else {
      showEmployee();
    }
  }

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu')) document.querySelectorAll('.menu-list').forEach((m) => { m.hidden = true; });
  });
  boot();
})();
