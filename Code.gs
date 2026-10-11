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
  kudos:    { tab: 'Kudos',    show: ['at', 'type', 'from', 'to', 'text'] }
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
function doGet() { return out_({ ok: true, app: 'TESR Board API', ver: ver_() }); }

function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (x) { return out_({ error: 'bad_request' }); }
  try {
    if (req.action === 'login') return out_(login_(req.user, req.pass));
    const u = verify_(req.token);
    if (!u) return out_({ error: 'auth' });
    switch (req.action) {
      case 'load':       return out_(loadAll_());
      case 'ver':        return out_({ ver: ver_() });
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

function login_(user, pass) {
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
  return { user: me, token: sign_({ id: me.id, role: me.role, exp: Date.now() + 30 * 864e5 }) };
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
