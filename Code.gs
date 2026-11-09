/**
 * TESR Board — Backend API (Google Apps Script)
 * ฐานข้อมูล: Google Sheet "TESR Board DB" · ไฟล์แนบ: Google Drive "TESR Board/ไฟล์แนบ"
 * รายชื่อพนักงาน + ล็อกอิน: อ่านจาก Sheet ระบบลงเวลา "Work tracking log" (แท็บ Employees / Settings) แบบอ่านอย่างเดียว
 *
 * ติดตั้ง:
 *  1) เลือกฟังก์ชัน setup → Run (อนุญาตสิทธิ์ครั้งแรก)
 *  2) Deploy → New deployment → Web app · Execute as: Me · Who has access: Anyone → คัดลอก URL
 */

const SHEET_ID    = '19vCSU0d3ZfhVSy2m8tik4qLZ88j6RN9FC8bsxg9S6gA';   // TESR Board DB
const FOLDER_ID   = '1eowBXaR-4Hvpxpzic2LUQKVh64Mk78L2';               // ไฟล์แนบ
const HR_SHEET_ID = '1Ot4QQc60u71hoIy3K5XOsxOJof0I2I1PnrF79Pq51_I';   // Work tracking log (ระบบลงเวลา)

const TABLES = {
  mrows:    { tab: 'Members',  show: ['name', 'email', 'role', 'dept', 'board_role', 'active'] },
  boards:   { tab: 'Boards',   show: ['name'] },
  lists:    { tab: 'Lists',    show: ['name', 'board_id', 'is_done'] },
  cards:    { tab: 'Cards',    show: ['title', 'list_id', 'assignees', 'priority', 'due', 'created_at', 'started_at', 'done_at'] },
  activity: { tab: 'Activity', show: ['at', 'member', 'action', 'card_id'] },
  kudos:    { tab: 'Kudos',    show: ['at', 'type', 'from', 'to', 'text'] },
  payments: { tab: 'Payments', show: ['at', 'card_id', 'by', 'status', 'name', 'url'] },  // 💳 หลักฐานการชำระเงิน
  customers:{ tab: 'Customers',show: ['name', 'tax', 'phone', 'pin'] }                       // 👤 PIN ลูกค้าสำหรับหน้ารวมออเดอร์
};
const HEAD = ['id', 'updated_at', 'json'];
const ADMIN_ONLY_WRITE = { mrows: 1, boards: 1, lists: 1 };
const P = () => PropertiesService.getScriptProperties();

/* ================= SETUP ================= */
function setup() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  Object.keys(TABLES).forEach(k => {
    const t = TABLES[k];
    const sh = ss.getSheetByName(t.tab) || ss.insertSheet(t.tab);
    const head = HEAD.concat(t.show);
    sh.getRange('A:Z').setNumberFormat('@');
    sh.getRange(1, 1, 1, head.length).setValues([head])
      .setFontWeight('bold').setBackground('#111111').setFontColor('#d4a72c');
    sh.setFrozenRows(1);
    sh.hideColumns(3); // คอลัมน์ json (ข้อมูลเต็ม) ซ่อนไว้
  });
  ['Sheet1', 'แผ่น1', 'แผ่นงาน1'].forEach(n => { const s = ss.getSheetByName(n); if (s && ss.getSheets().length > 1) ss.deleteSheet(s); });
  if (!P().getProperty('SECRET')) P().setProperty('SECRET', Utilities.getUuid() + Utilities.getUuid());
  const staff = getStaff_(true);
  Logger.log('✅ Setup เสร็จ · พนักงานที่ดึงได้: ' + staff.length + ' คน · ' + staff.map(x => x.name).join(', '));
}

/* ================= HTTP ================= */
function doGet() { return out_({ ok: true, app: 'TESR Board API', ver: ver_(), track: true }); }

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return out_({ error: 'bad_request' }); }
  try {
    if (req.action === 'track') return out_(track_(req));            // 🚚 หน้าลูกค้า (ลิงก์ออเดอร์ · ไม่ใช้บัญชีพนักงาน)
    if (req.action === 'trackPay') return out_(trackPay_(req));      // 💳 ลูกค้าแนบสลิป
    if (req.action === 'portal') return out_(portal_(req));          // 👤 ลูกค้าดูทุกออเดอร์ของตัวเอง (เลขภาษี/เบอร์ + PIN)
    if (req.action === 'login') return out_(login_(req.user, req.pass, req.remember));
    const u = verify_(req.token);
    if (!u) return out_({ error: 'auth' });
    switch (req.action) {
      case 'load':       return out_(loadAll_());
      case 'ver':        return out_({ ver: ver_() });
      case 'renew':      return out_({ token: sign_({ id: u.id, role: memberRole_(u.id) || u.role, rem: u.rem !== false, exp: Date.now() + (u.rem === false ? SHORT_DAYS : LONG_DAYS) * 864e5 }) });
      case 'upsert':     return out_(upsert_(u, req.table, req.rows || []));
      case 'remove':     return out_(remove_(u, req.table, req.ids || []));
      case 'upload':     return out_(upload_(req));
      case 'removeFile': return out_(removeFile_(req.id));
    }
    return out_({ error: 'unknown_action' });
  } catch (err) {
    return out_({ error: String(err && err.message || err) });
  }
}
const out_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);

/* ================= AUTH ================= */
function secret_() {
  let k = P().getProperty('SECRET');
  if (!k) { k = Utilities.getUuid() + Utilities.getUuid(); P().setProperty('SECRET', k); }
  return k;
}
function hmac_(s) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s, secret_())); }
function sign_(o) { const p = Utilities.base64EncodeWebSafe(JSON.stringify(o), Utilities.Charset.UTF_8); return p + '.' + hmac_(p); }
function verify_(t) {
  if (!t) return null;
  const parts = String(t).split('.');
  if (parts.length !== 2 || hmac_(parts[0]) !== parts[1]) return null;
  const o = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString('UTF-8'));
  return o.exp > Date.now() ? o : null;
}
function isAdmin_(u) { return u.id === 'admin' || memberRole_(u.id) === 'admin'; }
function memberRole_(id) { const m = readTable_('mrows').find(r => r.id === id); return m && m.board_role; }
function normPhone_(p) { const d = String(p || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; } // เทียบ 9 หลักท้าย (รองรับ 08x / +668x / เลข 0 หาย)
function sha_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

const LONG_DAYS = 180, SHORT_DAYS = 1; // จำเครื่องนี้ = 180 วัน (ต่ออายุอัตโนมัติทุกครั้งที่เปิดใช้), ไม่จำ = 1 วัน
function login_(user, pass, remember) {
  const u = String(user || '').trim().toLowerCase(), pw = String(pass || '').trim();
  if (!u || !pw) return { error: 'invalid' };
  const cache = CacheService.getScriptCache(), fk = 'fail_' + u, fails = +(cache.get(fk) || 0);
  if (fails >= 8) return { error: 'locked' };

  let me = null;
  // 1) Admin สำรอง (Script Properties: ADMIN_EMAIL + ADMIN_PASSWORD)
  const ae = String(P().getProperty('ADMIN_EMAIL') || '').toLowerCase(), ap = P().getProperty('ADMIN_PASSWORD');
  if (ae && ap && u === ae && pw === ap) me = { id: 'admin', role: 'admin' };
  // 2) Admin ของระบบลงเวลา (แท็บ Settings: adminUser + adminHash / adminPassword)
  if (!me) {
    const st = hrSettings_();
    if (st.adminUser && String(st.adminUser).trim().toLowerCase() === u) {
      const h = String(st.adminHash || ''), plain = String(st.adminPassword || '');
      if (plain && pw === plain) me = { id: 'admin', role: 'admin' };
      else if (h.indexOf('$') > 0) {
        const salt = h.split('$')[0], hx = h.split('$')[1];
        if ([salt + '|' + pw, salt + pw, pw + salt, salt + ':' + pw].some(x => sha_(x) === hx)) me = { id: 'admin', role: 'admin' };
      }
    }
  }
  // 3) พนักงาน: อีเมล (หรือ username) + เบอร์โทร
  if (!me) {
    const e = employeesRaw_().find(d =>
      (String(d.email || '').trim().toLowerCase() === u || String(d.username || '').trim().toLowerCase() === u) &&
      String(d.active).toUpperCase() !== 'FALSE' &&
      normPhone_(d.phone) && normPhone_(d.phone) === normPhone_(pw));
    if (e) {
      me = { id: String(e.id || e.code || e.email), code: String(e.code || ''), name: e.name || '', position: e.position || '', email: u };
      me.role = memberRole_(me.id) || 'member';
    }
  }
  if (!me) { cache.put(fk, String(fails + 1), 900); return { error: 'invalid' }; }
  cache.remove(fk);
  if (me.id === 'admin') {
    const m = readTable_('mrows').find(r => r.id === 'admin');
    me.name = (m && m.name) || 'Anon'; me.email = u; me.position = 'CEO · Owner';
  }
  const days = remember === false ? SHORT_DAYS : LONG_DAYS;
  return { user: me, token: sign_({ id: me.id, role: me.role, rem: days === LONG_DAYS, exp: Date.now() + days * 864e5 }) };
}

/* ================= EMPLOYEES (Sheet ระบบลงเวลา · อ่านอย่างเดียว) ================= */
function hrTab_(name) {
  const sh = SpreadsheetApp.openById(HR_SHEET_ID).getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getDisplayValues(), h = v.shift().map(x => String(x).trim());
  return v.filter(r => r.join('') !== '').map(r => { const o = {}; h.forEach((k, i) => o[k] = r[i]); return o; });
}
function hrSettings_() { const o = {}; hrTab_('Settings').forEach(r => o[r.key] = r.value); return o; }
function employeesRaw_() { return hrTab_('Employees').filter(d => d.name); }
function getStaff_(fresh) {
  const c = CacheService.getScriptCache();
  if (!fresh) { const x = c.get('staff'); if (x) return JSON.parse(x); }
  const s = employeesRaw_().map(d => ({
    id: String(d.id || d.code || d.email), code: String(d.code || ''), name: d.name || '', position: d.position || '',
    email: String(d.email || '').trim().toLowerCase(), active: String(d.active).toUpperCase() !== 'FALSE'
  })).sort((a, b) => a.code.localeCompare(b.code));
  c.put('staff', JSON.stringify(s), 300);
  return s; // ไม่ส่งเบอร์โทร / รหัสผ่านออกไป
}

/* ================= DATA ================= */
function sheet_(t) {
  if (!TABLES[t]) throw new Error('bad_table');
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(TABLES[t].tab);
  if (!sh) { setup(); sh = ss.getSheetByName(TABLES[t].tab); } // สร้างแท็บอัตโนมัติถ้ายังไม่ได้รัน setup
  return sh;
}
function readTable_(t) {
  const sh = sheet_(t), n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 3, n - 1, 1).getValues()
    .map(r => { try { return JSON.parse(r[0]); } catch (e) { return null; } }).filter(Boolean);
}
function ver_() { return P().getProperty('VER') || '0'; }
function bump_() { const v = String(Date.now()); P().setProperty('VER', v); return v; }
function loadAll_() {
  const o = { ver: ver_(), staff: getStaff_() };
  Object.keys(TABLES).forEach(t => o[t] = readTable_(t));
  o.activity = o.activity.slice(-2000);
  return o;
}
function safe_(v) { v = String(v); return /^[=+\-@]/.test(v) ? "'" + v : v; }
function rowOf_(t, o, names) {
  const show = TABLES[t].show.map(k => {
    let v = o[k];
    if (k === 'assignees' && Array.isArray(v)) v = v.map(id => names[id] || id).join(', ');
    else if (k === 'list_id' || k === 'board_id') v = names[v] || v;
    else if (k === 'from' || k === 'to') v = names[v] || v;
    else if (Array.isArray(v)) v = v.join(', ');
    else if (v && typeof v === 'object') v = JSON.stringify(v);
    return v == null ? '' : safe_(v);
  });
  return [o.id, new Date().toISOString(), JSON.stringify(o)].concat(show);
}
function upsert_(u, t, rows) {
  if (ADMIN_ONLY_WRITE[t] && !isAdmin_(u)) throw new Error('forbidden');
  if (t === 'kudos') rows.forEach(r => {   // 🙏 ส่งในนามตัวเองเท่านั้น · บันทึก Safety ได้เฉพาะ Admin
    if (r.type === 'safety' ? !isAdmin_(u) : (r.from !== u.id || r.to === u.id)) throw new Error('forbidden');
  });
  const names = {}; getStaff_().forEach(s => names[s.id] = s.name); names.admin = 'Admin';
  if (t === 'cards' || t === 'lists') readTable_('lists').concat(readTable_('boards')).forEach(x => names[x.id] = x.name);
  return writeRows_(t, rows, names);
}
function writeRows_(t, rows, names) {
  names = names || {};
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = sheet_(t), n = sh.getLastRow(), idx = {};
    if (n > 1) sh.getRange(2, 1, n - 1, 1).getValues().forEach((r, i) => idx[String(r[0])] = i + 2);
    const add = [];
    rows.forEach(o => {
      if (!o || !o.id) return;
      const r = rowOf_(t, o, names);
      if (idx[o.id]) sh.getRange(idx[o.id], 1, 1, r.length).setValues([r]); else add.push(r);
    });
    if (add.length) sh.getRange(sh.getLastRow() + 1, 1, add.length, add[0].length).setValues(add);
    if (t === 'activity' && sh.getLastRow() > 6000) sh.deleteRows(2, 1000);
    return { ok: true, ver: bump_() };
  } finally { lock.releaseLock(); }
}
function remove_(u, t, ids) {
  if (ADMIN_ONLY_WRITE[t] && !isAdmin_(u)) throw new Error('forbidden');
  if (t === 'kudos' && !isAdmin_(u)) {
    const bad = readTable_('kudos').filter(k => ids.indexOf(k.id) >= 0 && k.from !== u.id);
    if (bad.length) throw new Error('forbidden');
  }
  if (t === 'cards' && !isAdmin_(u)) {
    const own = readTable_('cards').filter(c => ids.indexOf(c.id) >= 0 && c.created_by !== u.id);
    if (own.length) throw new Error('forbidden');
  }
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const sh = sheet_(t), n = sh.getLastRow();
    if (n > 1) {
      const v = sh.getRange(2, 1, n - 1, 1).getValues();
      for (let i = v.length - 1; i >= 0; i--) if (ids.indexOf(String(v[i][0])) >= 0) sh.deleteRow(i + 2);
    }
    return { ok: true, ver: bump_() };
  } finally { lock.releaseLock(); }
}

/* ================= FILES (Google Drive) ================= */
function upload_(r) {
  const blob = Utilities.newBlob(Utilities.base64Decode(r.data), r.type || 'application/octet-stream', r.name || 'file');
  const f = DriveApp.getFolderById(FOLDER_ID).createFile(blob);
  try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* นโยบายองค์กรอาจไม่อนุญาต */ }
  const id = f.getId();
  return { id: id, url: 'https://drive.google.com/file/d/' + id + '/view', thumb: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w400' };
}
function removeFile_(id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {} return { ok: true }; }

/* ================= 🚚 CUSTOMER TRACKING (หน้า track.html · สาธารณะ · อ่านอย่างเดียว) =================
 * การ์ดที่เปิด "ลิงก์ติดตาม" จะมี c.trk = { on, token, unit, ref, title, customer, eta, note, docs{}, ship{}, inv, evidence, classInfo }
 * ขั้นที่ลูกค้าเห็น = คอลัมน์ของบอร์ดที่ตั้ง "ชื่อขั้นที่ลูกค้าเห็น" (l.pub) ไว้ · ถ้าบอร์ดยังไม่ตั้งเลย ใช้ชื่อคอลัมน์ทั้งหมด
 * คอลัมน์ที่ไม่มี pub = ขั้นภายใน → ลูกค้าเห็นเป็นขั้นสาธารณะก่อนหน้า
 * ส่งออกเฉพาะข้อมูลสาธารณะ: ไม่มีผู้รับผิดชอบ คอมเมนต์ เช็คลิสต์ ไฟล์แนบ หรือรายละเอียดภายใน
 * c.trk.int (🔒 ข้อมูลภายในทีม: ขั้นต่อไป ช่องทางติดต่อ การเงิน บันทึกทีม) ห้ามส่งออกในฟังก์ชันใดของลูกค้า
 */
const HANDOVER_ROOT_ID = '1PuUBsXmCo0mnQDcdvDqbDwtH_Qiv_Hni';   // TESR shop tracking and handover (แอป Handover)
const TRK_UNITS = { shop: 'TESR Shop', academy: 'TESR Academy', logistics: 'TESR Logistics' };
const TRK_DOCS = {
  shop:      [['q', 'ใบเสนอราคา'], ['inv', 'ใบแจ้งหนี้ / ใบส่งสินค้า'], ['tax', 'ใบเสร็จรับเงิน / ใบกำกับภาษี']],
  academy:   [['inv', 'ใบแจ้งหนี้'], ['tax', 'ใบเสร็จรับเงิน / ใบกำกับภาษี'], ['guide', 'คู่มือเตรียมตัวก่อนเรียน']],
  logistics: [['inv', 'ใบแจ้งหนี้ค่าบริการ'], ['tax', 'ใบเสร็จรับเงิน / ใบกำกับภาษี']]
};
const okUrl_ = u => { u = String(u || '').trim(); return /^https?:\/\/\S+$/i.test(u) ? u : ''; };
const str_ = (v, n) => String(v == null ? '' : v).trim().slice(0, n || 300);

function track_(r) {
  const c = cardByTok_(r.o);
  if (!c) return { error: 'not_found' };
  const acc = access_(c, r);
  if (acc.error) return acc;
  const all = readTable_('lists').filter(l => l.board_id === c.board_id).sort((a, b) => (+a.pos || 0) - (+b.pos || 0));
  const cur = all.find(l => l.id === c.list_id);
  if (!cur) return { error: 'not_found' };
  const t = c.trk, unit = TRK_UNITS[t.unit] ? t.unit : 'shop';

  const pubs = all.filter(l => String(l.pub || '').trim());
  const steps = pubs.length ? pubs : all;
  let ci = -1;
  steps.forEach((l, i) => { if ((+l.pos || 0) <= (+cur.pos || 0)) ci = i; });
  const done = !!cur.is_done, n = steps.length;

  // เวลาที่การ์ดเข้าแต่ละคอลัมน์ (จากเส้นทางงาน)
  const trail = Array.isArray(c.trail) ? c.trail : [];
  const entered = l => { let at = ''; trail.forEach(e => { if (e.t !== 'back' && (e.list_id === l.id || (!e.list_id && e.list === l.name))) at = e.at || at; }); return at; };

  const out = steps.map((l, i) => ({
    label: str_(l.pub || l.name, 80),
    desc: str_(l.pub_desc, 200),
    state: done || i < ci ? 'done' : (i === Math.max(ci, 0) ? 'now' : 'todo'),
    at: (done || i <= ci) ? entered(l) : ''
  }));
  const pct = done ? 100 : Math.min(95, Math.round((Math.max(ci, 0) + 0.5) / n * 100));

  const base = {
    ok: true, locked: !acc.full, ct: acc.ct || undefined,
    ref: str_(t.ref, 40), title: str_(t.title || c.title, 160),
    unit: unit, unitLabel: TRK_UNITS[unit],
    start: String(c.created_at || '').slice(0, 10), eta: /^\d{4}-\d{2}-\d{2}$/.test(t.eta || '') ? t.eta : '',
    done: done, doneAt: done ? (c.done_at || entered(cur) || '') : '',
    pct: pct, steps: out, updated: c.updated_at || ''
  };
  if (!acc.full) return base;   // ยังไม่ยืนยันตัวตน → เห็นแค่สถานะ/ขั้นตอน
  return Object.assign(base, {
    customer: str_(t.customer, 120), note: str_(t.note, 1000), classInfo: str_(t.classInfo, 200),
    docs: TRK_DOCS[unit].map(d => ({ label: d[1], url: okUrl_(t.docs && t.docs[d[0]]) })),
    ship: unit === 'academy' ? null : {
      carrier: str_(t.ship && t.ship.carrier, 60), no: str_(t.ship && t.ship.no, 60), url: okUrl_(t.ship && t.ship.url)
    },
    evidence: unit === 'academy' ? '' : (okUrl_(t.evidence) || findHandover_(t.inv)),
    payments: readTable_('payments').filter(p => p.card_id === c.id)
      .sort((a, b) => String(a.at).localeCompare(String(b.at)))
      .map(p => ({ url: okUrl_(p.url), thumb: okUrl_(p.thumb), name: str_(p.name, 80), at: p.at || '',
                   by: p.by === 'customer' ? 'customer' : 'staff', status: ['ok', 'rejected'].indexOf(p.status) >= 0 ? p.status : 'pending',
                   note: str_(p.note, 200) }))
  });
}

/* ---------- ตัวตนลูกค้า: เลขผู้เสียภาษี (13 หลัก) หรือเบอร์โทร (เทียบ 9 หลักท้าย) ---------- */
function keyOf_(v) { const d = String(v || '').replace(/\D/g, ''); return d.length === 13 ? 'T' + d : d.length >= 9 && d.length <= 12 ? 'P' + d.slice(-9) : ''; }
function cardKeys_(c) { const t = c.trk || {}; return [keyOf_(t.tax), keyOf_(t.phone)].filter(Boolean); }
function cardByTok_(tok) {
  tok = String(tok || '').trim();
  if (!/^[a-z0-9]{10,40}$/i.test(tok)) return null;
  return readTable_('cards').find(x => x.trk && x.trk.on && x.trk.token === tok) || null;
}
// token ลูกค้า: เซ็นด้วยกุญแจแยกจากพนักงาน → ใช้เรียก API ฝั่งพนักงานไม่ได้
function hmacC_(s) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature('cust|' + s, secret_() + '|customer')); }
function signC_(keys) { const p = Utilities.base64EncodeWebSafe(JSON.stringify({ k: keys, exp: Date.now() + 30 * 864e5 }), Utilities.Charset.UTF_8); return p + '.' + hmacC_(p); }
function verifyC_(t) {
  const a = String(t || '').split('.');
  if (a.length !== 2 || hmacC_(a[0]) !== a[1]) return [];
  try { const o = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(a[0])).getDataAsString('UTF-8')); return o.exp > Date.now() && Array.isArray(o.k) ? o.k : []; } catch (e) { return []; }
}
function tooMany_(k) { return +(CacheService.getScriptCache().get('cf_' + k) || 0) >= 8; }
function fail_(k) { const c = CacheService.getScriptCache(), n = +(c.get('cf_' + k) || 0) + 1; c.put('cf_' + k, String(n), 900); }
/* สิทธิ์ดูข้อมูลเต็มของออเดอร์: (1) การ์ดยังไม่ผูกเลขภาษี/เบอร์ → เปิดเต็ม  (2) token ลูกค้าที่มีกุญแจตรง  (3) กรอกเลขภาษี/เบอร์ตรง */
function access_(c, r) {
  const keys = cardKeys_(c);
  if (!keys.length) return { full: true };
  if (verifyC_(r.ct).some(k => keys.indexOf(k) >= 0)) return { full: true };
  if (r.key) {
    const lk = 'o_' + c.trk.token;
    if (tooMany_(lk)) return { error: 'locked' };
    const k = keyOf_(r.key);
    if (k && keys.indexOf(k) >= 0) return { full: true, ct: signC_(mergeKeys_(r.ct, k)) };
    fail_(lk); return { error: 'bad_key' };
  }
  return { full: false };
}
function mergeKeys_(ct, k) { const a = verifyC_(ct); if (a.indexOf(k) < 0) a.push(k); return a.slice(-6); }

/* 👤 หน้ารวมออเดอร์: login = เลขภาษี/เบอร์ + PIN (แท็บ Customers) · หรือส่ง ct เดิมมา */
function portal_(r) {
  let keys = [], ct = '';
  if (r.key) {
    const k = keyOf_(r.key), pin = String(r.pin || '').replace(/\D/g, '');
    if (!k || pin.length < 4) return { error: 'invalid' };
    if (tooMany_('p_' + k)) return { error: 'locked' };
    const ok = readTable_('customers').some(x => String(x.pin || '') === pin && (keyOf_(x.tax) === k || keyOf_(x.phone) === k));
    if (!ok) { fail_('p_' + k); return { error: 'invalid' }; }
    keys = [k]; ct = signC_(mergeKeys_(r.ct, k));
  } else {
    keys = verifyC_(r.ct);
    if (!keys.length) return { error: 'auth' };
  }
  const lists = {}; readTable_('lists').forEach(l => lists[l.id] = l);
  const orders = readTable_('cards').filter(c => c.trk && c.trk.on && cardKeys_(c).some(k => keys.indexOf(k) >= 0)).map(c => {
    const l = lists[c.list_id]; if (!l) return null;
    const bl = Object.keys(lists).map(id => lists[id]).filter(x => x.board_id === c.board_id).sort((a, b) => (+a.pos || 0) - (+b.pos || 0));
    const pubs = bl.filter(x => String(x.pub || '').trim()), steps = pubs.length ? pubs : bl;
    let ci = 0; steps.forEach((x, i) => { if ((+x.pos || 0) <= (+l.pos || 0)) ci = i; });
    const done = !!l.is_done, t = c.trk;
    return { o: t.token, ref: str_(t.ref, 40), title: str_(t.title || c.title, 160), unitLabel: TRK_UNITS[t.unit] || TRK_UNITS.shop,
      stage: done ? 'เสร็จสมบูรณ์' : str_(steps[ci] && (steps[ci].pub || steps[ci].name), 80),
      pct: done ? 100 : Math.min(95, Math.round((ci + 0.5) / steps.length * 100)), done: done,
      eta: t.eta || '', updated: c.updated_at || '', customer: str_(t.customer, 120) };
  }).filter(Boolean).sort((a, b) => (a.done - b.done) || String(b.updated).localeCompare(String(a.updated)));
  return { ok: true, ct: ct || undefined, orders: orders };
}

/* หาโฟลเดอร์หลักฐานจากแอป Handover ตามเลข INV (ชื่อโฟลเดอร์ขึ้นต้นด้วย INV เช่น INV00125_09112026) */
function findHandover_(inv) {
  inv = String(inv || '').trim();
  if (!/^[\w\-\/.]{3,40}$/.test(inv)) return '';
  const cache = CacheService.getScriptCache(), key = 'ho_' + inv.replace(/[^\w]/g, '_'), hit = cache.get(key);
  if (hit !== null) return hit;
  let url = '';
  try {
    const it = DriveApp.searchFolders("title contains '" + inv.replace(/['\\]/g, '') + "' and trashed = false");
    while (it.hasNext() && !url) {
      const f = it.next();
      if (f.getName().toUpperCase().indexOf(inv.toUpperCase()) === 0 && underRoot_(f)) url = f.getUrl();
    }
  } catch (e) { /* ไม่มีสิทธิ์ Drive / ค้นไม่ได้ → ไม่แสดงลิงก์ */ }
  cache.put(key, url, url ? 21600 : 600);
  return url;
}
function underRoot_(f) { // ต้องอยู่ใต้โฟลเดอร์ Handover (root → ปี → Tax ID → INV)
  let p = f, depth = 0;
  while (depth++ < 5) {
    const ps = p.getParents(); if (!ps.hasNext()) return false;
    p = ps.next(); if (p.getId() === HANDOVER_ROOT_ID) return true;
  }
  return false;
}

/* 💳 ลูกค้าแนบสลิปจากหน้า track.html → สถานะ "รอตรวจสอบ" ให้พนักงานกดยืนยันในการ์ด */
const PAY_MAX_BYTES = 8e6, PAY_MAX_PER_CARD = 10;
function trackPay_(r) {
  const c = cardByTok_(r.o);
  if (!c) return { error: 'not_found' };
  if (!access_(c, { ct: r.ct }).full) return { error: 'auth' };
  const tok = c.trk.token, type = String(r.type || '');
  if (!/^image\/(jpeg|png|webp|heic|heif)$|^application\/pdf$/.test(type)) return { error: 'bad_type' };
  const cache = CacheService.getScriptCache(), rk = 'pay_' + tok;
  if (cache.get(rk)) return { error: 'too_fast' };
  const mine = readTable_('payments').filter(p => p.card_id === c.id && p.by === 'customer');
  if (mine.length >= PAY_MAX_PER_CARD) return { error: 'too_many' };
  const bytes = Utilities.base64Decode(String(r.data || ''));
  if (!bytes.length || bytes.length > PAY_MAX_BYTES) return { error: 'too_big' };
  cache.put(rk, '1', 15);
  const ext = type === 'application/pdf' ? '.pdf' : type === 'image/png' ? '.png' : '.jpg';
  const name = 'สลิป ' + (c.trk.ref || c.id.slice(0, 8)) + ' ' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HHmm') + ext;
  const f = DriveApp.getFolderById(FOLDER_ID).createFile(Utilities.newBlob(bytes, type, name));
  try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  const id = f.getId(), at = new Date().toISOString();
  writeRows_('payments', [{ id: Utilities.getUuid(), card_id: c.id, by: 'customer', status: 'pending', name: name, at: at,
    url: 'https://drive.google.com/file/d/' + id + '/view', thumb: type === 'application/pdf' ? '' : 'https://drive.google.com/thumbnail?id=' + id + '&sz=w400', path: id }]);
  writeRows_('activity', [{ id: Utilities.getUuid(), card_id: c.id, board_id: c.board_id, member: null, action: '💳 ลูกค้าแนบหลักฐานการชำระเงิน (รอตรวจสอบ)', at: at }]);
  return { ok: true };
}
