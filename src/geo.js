'use strict';
// تقدير مكان التسجيل بالنسبة لمكتب الشركة.
// GPS الهاتف داخل المباني دقته عادة 10–50 م، لذلك لا يمكن الحكم على مساحة 140 م² بدقة المتر؛
// نستخدم نطاقًا حول المكتب (office_radius_m) ونأخذ دقة القراءة بالحسبان:
//   inside    : المسافة ≤ النطاق
//   outside   : حتى مع أفضل احتمال للدقة، القراءة أبعد من النطاق (المسافة − الدقة > النطاق)
//   uncertain : القراءة قريبة لكن دقتها لا تكفي للحكم — تحتاج نظرة من المدير
const EARTH_R = 6371000;
const rad = (d) => (d * Math.PI) / 180;

function distanceM(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(a));
}

function classifyPlace(lat, lng, accuracy, office) {
  if (lat == null || lng == null || !office || office.lat == null || office.lng == null) return null;
  const radius = office.radius || 50;
  const d = distanceM(lat, lng, office.lat, office.lng);
  const acc = Math.max(0, accuracy || 0);
  const place = d <= radius ? 'inside' : d - acc > radius ? 'outside' : 'uncertain';
  return { place, distance_m: Math.round(d) };
}

module.exports = { distanceM, classifyPlace };
