'use strict';
// كل الأوقات تُخزّن UTC، وتُعرض وتُفلتر حسب توقيت مكان العمل (Asia/Hebron)
// بغض النظر عن توقيت الخادم أو جهاز المدير.
const WORK_TZ = 'Asia/Hebron';

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: WORK_TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

function zonedParts(date) {
  const p = {};
  for (const { type, value } of partsFmt.formatToParts(date)) p[type] = value;
  return p;
}

// فرق توقيت Asia/Hebron عن UTC بالميلي ثانية في لحظة معينة (يراعي التوقيت الصيفي).
function tzOffsetMs(date) {
  const p = zonedParts(date);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// تحويل منتصف ليل يوم محلي (YYYY-MM-DD) في Asia/Hebron إلى لحظة UTC.
function localMidnightToUtc(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (Number.isNaN(guess)) return null;
  let t = guess - tzOffsetMs(new Date(guess));
  t = guess - tzOffsetMs(new Date(t)); // تصحيح ثانٍ عند حدود التوقيت الصيفي
  return new Date(t);
}

function addDays(ymd, n) {
  const [y, mo, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + n)).toISOString().slice(0, 10);
}

function localDate(iso) {
  const p = zonedParts(new Date(iso));
  return `${p.year}-${p.month}-${p.day}`;
}

function localDateTime(iso) {
  const p = zonedParts(new Date(iso));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// مدة العمل بالدقائق الكاملة = الخروج − الدخول، محسوبة من اللحظتين الكاملتين.
function durationMinutes(inIso, outIso) {
  if (!inIso || !outIso) return null;
  return Math.floor((Date.parse(outIso) - Date.parse(inIso)) / 60000);
}

function formatHm(minutes) {
  if (minutes == null) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

const timeFmt = new Intl.DateTimeFormat('ar-u-nu-latn', { timeZone: WORK_TZ, hour: 'numeric', minute: '2-digit', hour12: true });

// مثل: «10:27 ص»
function localTime(iso) {
  return timeFmt.format(new Date(iso));
}

// مثل: «8 س 05 د»
function formatDuration(minutes) {
  if (minutes == null) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} س ${String(m).padStart(2, '0')} د` : `${m} د`;
}

module.exports = { WORK_TZ, localMidnightToUtc, addDays, localDate, localDateTime, localTime, durationMinutes, formatHm, formatDuration };
