'use strict';
/* Server Penilaian Ajang Kreatifitas Anak Sholih Sholihah
   Tanpa pustaka tambahan: cukup Node.js 18 ke atas.
   Menyimpan data di berkas JSON (atomik + cadangan otomatis), melayani aplikasi dan API. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUB = path.join(__dirname, 'public');
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const STORAGE = (process.env.STORAGE || 'file').toLowerCase();
const SESSION_MS = 12 * 3600 * 1000;
const FUTURE_MS = 24 * 3600 * 1000;
const SK = ['lombas', 'crit', 'open', 'as', 'jr', 'pes', 'pub', 'title', 'fin', 'tk', 'lt', 'sub', 'dr', 'dh', 'ttd', 'apv'];

if (STORAGE !== 'supabase') fs.mkdirSync(DATA_DIR, { recursive: true });
const DBF = path.join(DATA_DIR, 'db.json');

/* ---------- penyimpanan ---------- */
let DB = { rev: 0, epoch: 1, docs: {}, pins: {}, admin: null, adminDefault: false, sessions: {} };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function hashPin(pin) { const salt = crypto.randomBytes(8).toString('hex'); return salt + ':' + crypto.scryptSync(String(pin), salt, 32).toString('hex'); }
function checkPin(pin, stored) {
  const [salt, h] = String(stored || '').split(':'); if (!salt || !h) return false;
  const a = crypto.scryptSync(String(pin), salt, 32), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sleepMs = ms => new Promise(r => setTimeout(r, ms));

/* Penyimpanan berkas: seluruh data di satu berkas JSON (atomik) + cadangan tiap jam. */
function fileStorage() {
  let saveT = null, lastBackup = '';
  function flush() {
    saveT = null;
    try {
      const tmp = DBF + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(DB)); fs.renameSync(tmp, DBF);
      const d = new Date(), tag = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' + String(d.getHours()).padStart(2, '0');
      if (tag !== lastBackup) {
        lastBackup = tag; fs.copyFileSync(DBF, path.join(DATA_DIR, 'cadangan-' + tag + '.json'));
        const old = fs.readdirSync(DATA_DIR).filter(f => /^cadangan-.*\.json$/.test(f)).sort();
        while (old.length > 72) fs.unlinkSync(path.join(DATA_DIR, old.shift()));
      }
      st.lastOk = Date.now();
    } catch (e) { st.lastError = e.message; console.error('Gagal menyimpan data:', e.message); }
  }
  const sched = async () => { if (!saveT) saveT = setTimeout(flush, 250); };
  const st = { name: 'file', lastOk: 0, lastError: '',
    describe: () => 'Berkas JSON di ' + DBF,
    async init() {
      try { DB = Object.assign(DB, JSON.parse(fs.readFileSync(DBF, 'utf8'))); }
      catch (e) { if (e.code !== 'ENOENT') { console.error('PERINGATAN: db.json tidak terbaca (' + e.message + '). Memulai dari data kosong.'); try { fs.copyFileSync(DBF, DBF + '.rusak-' + Date.now()); } catch (x) {} } }
    },
    putDoc: sched, putKv: sched, replaceDocs: sched,
    async check() { fs.accessSync(DATA_DIR, fs.constants.W_OK); },
    flushNow() { if (saveT) { clearTimeout(saveT); flush(); } } };
  return st;
}

/* Penyimpanan Supabase (Postgres) lewat REST (PostgREST). Kunci service_role hanya ada di server. */
function supabaseStorage() {
  const url = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const key = String(process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const base = url + '/rest/v1';
  const st = { name: 'supabase', lastOk: 0, lastError: '', describe: () => 'Supabase ' + url };
  function hdr(prefer) { const h = { apikey: key, 'Content-Type': 'application/json' }; if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key; if (prefer) h.Prefer = prefer; return h; }
  function hint(status, text) {
    if (status === 401 || status === 403) return 'Kunci ditolak. Pastikan SUPABASE_SERVICE_KEY berisi kunci service_role (atau secret key) dari proyek yang sama dengan SUPABASE_URL.';
    if (status === 404 || /PGRST205|PGRST202|does not exist|schema cache/i.test(text)) return 'Tabel belum ada. Jalankan berkas supabase/schema.sql di SQL Editor Supabase.';
    return '';
  }
  async function once(method, pq, body, prefer) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch(base + pq, { method, headers: hdr(prefer), body: body === undefined ? undefined : JSON.stringify(body), signal: ctl.signal });
      const tx = await r.text();
      if (!r.ok) { const e = new Error('Supabase ' + r.status + ': ' + tx.slice(0, 200)); e.status = r.status; e.hint = hint(r.status, tx); throw e; }
      return tx ? JSON.parse(tx) : null;
    } finally { clearTimeout(t); }
  }
  async function req(method, pq, body, prefer) {
    let last;
    for (let i = 0; i < 3; i++) {
      try { const v = await once(method, pq, body, prefer); st.lastOk = Date.now(); st.lastError = ''; return v; }
      catch (e) { last = e; if ((e.status && e.status < 500 && e.status !== 429) || i === 2) break; await sleepMs(300 * Math.pow(3, i)); }
    }
    st.lastError = last.message; throw last;
  }
  const up = (table, conflict, rows) => req('POST', '/' + table + '?on_conflict=' + conflict, rows, 'resolution=merge-duplicates,return=minimal');
  Object.assign(st, {
    async init() {
      const kv = {}; (await req('GET', '/ajang_kv?select=k,v')).forEach(r => { kv[r.k] = r.v; });
      const docs = {}; let off = 0;
      for (;;) {
        const page = await req('GET', '/ajang_docs?select=path,d,r&order=path&limit=1000&offset=' + off);
        page.forEach(r => { docs[r.path] = { d: r.d, r: Number(r.r) }; });
        if (page.length < 1000) break; off += 1000;
      }
      const state = kv.state || {};
      DB.docs = docs; DB.pins = kv.pins || {}; DB.sessions = kv.sessions || {};
      if (kv.admin) { DB.admin = kv.admin.hash; DB.adminDefault = !!kv.admin.def; }
      DB.epoch = Number(state.epoch) || 1;
      DB.rev = Math.max(Number(state.rev) || 0, ...Object.values(docs).map(e => e.r), 0);
    },
    putDoc: (p, entry) => up('ajang_docs', 'path', [{ path: p, d: entry.d, r: entry.r }]),
    putKv: (k, v) => up('ajang_kv', 'k', [{ k, v }]),
    async replaceDocs(docs) {
      await req('DELETE', '/ajang_docs?path=not.is.null');
      const rows = Object.keys(docs).map(p => ({ path: p, d: docs[p].d, r: docs[p].r }));
      for (let i = 0; i < rows.length; i += 200) await up('ajang_docs', 'path', rows.slice(i, i + 200));
    },
    async check() {
      const stamp = String(Date.now());
      await up('ajang_kv', 'k', [{ k: '_cek', v: { t: stamp } }]);
      const back = await req('GET', '/ajang_kv?select=v&k=eq._cek');
      await req('DELETE', '/ajang_kv?k=eq._cek');
      if (!back || !back[0] || back[0].v.t !== stamp) throw new Error('Data uji tidak terbaca kembali dari Supabase');
    },
    flushNow() {}
  });
  return st;
}
if (STORAGE === 'supabase' && !(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY))) {
  console.error('KONFIGURASI KURANG: STORAGE=supabase membutuhkan SUPABASE_URL dan SUPABASE_SERVICE_KEY.'); process.exit(1);
}
const storage = STORAGE === 'supabase' ? supabaseStorage() : fileStorage();
let sessT = null;
function persistSessions() { if (sessT) return; sessT = setTimeout(async () => { sessT = null; try { await storage.putKv('sessions', DB.sessions); } catch (e) { console.error('Sesi belum tersimpan, mencoba lagi:', e.message); setTimeout(persistSessions, 3000); } }, 400); }
let chain = Promise.resolve();
const locked = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
const unavailable = e => { console.error('Penyimpanan gagal:', e.message); return fail(503, 'unavailable', 'Penyimpanan sementara tidak tersedia. Coba lagi sebentar lagi.'); };

/* ---------- utilitas ---------- */
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN' };
function send(res, code, obj) { const b = JSON.stringify(obj); res.writeHead(code, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, SEC)); res.end(b); }
function fail(status, code, error) { return Object.assign(new Error(error), { status, code }); }
const bad = m => { throw fail(400, 'bad_request', m); };
const deny = m => { throw fail(403, 'denied', m); };
function readBody(req, limit) {
  return new Promise((ok, no) => {
    let n = 0; const c = [];
    req.on('data', d => { n += d.length; if (n > limit) { c.length = 0; req.pause(); no(fail(413, 'bad_request', 'Data terlalu besar')); return; } c.push(d); });
    req.on('end', () => { try { ok(c.length ? JSON.parse(Buffer.concat(c).toString('utf8')) : {}); } catch (e) { no(fail(400, 'bad_request', 'JSON tidak valid')); } });
    req.on('error', no);
  });
}
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const num = v => (v != null && isFinite(v) ? Number(v) : null);
const now = () => Date.now();
function clientIp(req) { return (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?'; }
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function deepMerge(a, b) { const o = Object.assign({}, a); for (const k of Object.keys(b)) o[k] = isObj(b[k]) && isObj(o[k]) ? deepMerge(o[k], b[k]) : b[k]; return o; }

/* ---------- sesi dan login ---------- */
const fails = {};
function newSession(info) {
  const tok = crypto.randomBytes(24).toString('hex');
  DB.sessions[sha(tok)] = Object.assign({ exp: now() + SESSION_MS }, info);
  for (const k of Object.keys(DB.sessions)) if (DB.sessions[k].exp < now()) delete DB.sessions[k];
  persistSessions(); return tok;
}
function auth(req) {
  const m = /^Bearer ([a-f0-9]{48})$/.exec(req.headers.authorization || ''); if (!m) return null;
  const k = sha(m[1]), s = DB.sessions[k];
  if (!s || s.exp < now()) { if (s) { delete DB.sessions[k]; persistSessions(); } return null; }
  return Object.assign({ key: k }, s);
}
const setup = () => { const e = DB.docs['meta/setup']; return e && e.d ? e.d.d : null; };
async function doLogin(req, res) {
  const ip = clientIp(req), f = fails[ip];
  if (f && f.n >= 8 && now() - f.t < 300000) return send(res, 429, { code: 'rate_limited', error: 'Terlalu banyak percobaan' });
  const b = await readBody(req, 2000), pin = str(b.pin, 40);
  let info = null, dp = false;
  if (b.role === 'a') { if (pin && checkPin(pin, DB.admin)) { info = { r: 'a' }; dp = !!DB.adminDefault; } }
  else if (b.role === 'j') {
    const st = setup(), id = Object.keys(DB.pins).find(k => DB.pins[k] === pin);
    const a = id && st && Array.isArray(st.as) ? st.as.find(x => x && x.id === id) : null;
    if (pin && a) info = { r: 'j', id: a.id, nm: str(a.name, 60), l: a.l || '' };
  }
  if (!info) { fails[ip] = { n: (f && now() - f.t < 300000 ? f.n : 0) + 1, t: now() }; return send(res, 401, { code: 'bad_login', error: 'PIN salah' }); }
  delete fails[ip];
  const token = newSession(info);
  send(res, 200, { token, me: info.r === 'a' ? { r: 'a' } : { r: 'j', id: info.id, nm: info.nm, l: info.l }, dp });
}

/* ---------- aturan data ---------- */
const pesOf = pid => { const s = setup(); return s && Array.isArray(s.pes) ? s.pes.find(p => p && p.id === pid) : null; };
const juriOk = (l, jid) => { const s = setup(), a = s && s.jr && s.jr[l]; return Array.isArray(a) && a.some(j => j && j.id === jid); };
const sentT = pid => { const d = DB.docs['sn/' + pid]; return d ? +d.d.t || 0 : 0; };
function canEdit(a, p) {
  if (a.r === 'a') return true;
  if (a.l && a.l !== p.l) return false;
  const s = setup(); if (!s) return false;
  if (s.fin && s.fin[p.l + '|' + p.t]) return false;
  const st = sentT(p.id); if (!st) return true;
  const ap = s.apv && s.apv[p.id]; return !!(ap && +ap.s === st);
}
function vSc(id, d, a, old) {
  const m = /^([a-z0-9]{4,40})_([a-z0-9]{4,40})$/.exec(id); if (!m) bad('ID dokumen nilai tidak valid');
  if (!isObj(d) || d.p !== m[1] || d.j !== m[2] || !isObj(d.cells)) bad('Isi dokumen nilai tidak valid');
  const p = pesOf(d.p); if (!p || !juriOk(p.l, d.j)) bad('Peserta atau juri tidak dikenal');
  if (a.r !== 'a' && a.l && a.l !== p.l) deny('Bukan lomba Anda');
  const keys = Object.keys(d.cells); if (keys.length > 20) bad('Terlalu banyak kriteria');
  const oc = (old && old.cells) || {}, out = { p: d.p, j: d.j, cells: Object.assign({}, oc) }; let changed = false;
  for (const k of keys) {
    if (!/^\d{1,2}$/.test(k)) bad('Nomor kriteria tidak valid');
    const c = d.cells[k]; if (!isObj(c)) bad('Sel nilai tidak valid');
    const v = c.v == null ? null : Number(c.v); if (v !== null && !(isFinite(v) && v >= 0 && v <= 100)) bad('Nilai harus 0 sampai 100');
    const t = Number(c.t); if (!(t > 0 && t <= now() + FUTURE_MS)) bad('Cap waktu tidak valid');
    const h = Array.isArray(c.h) ? c.h.slice(-10).map(e => { e = e || {}; const r = { u: str(e.u, 80), t: Number(e.t) || 0, a: str(e.a, 60), o: num(e.o), v: num(e.v) }; if (e.x) r.x = 1; return r; }) : [];
    const cur = oc[k];
    if (cur && cur.t >= t) continue;                 /* nilai terbaru menang; yang lebih lama diabaikan */
    out.cells[k] = { v, t, a: str(c.a, 60), h }; changed = true;
  }
  if (changed && !canEdit(a, p)) deny('Nilai peserta ini terkunci atau di luar lomba Anda');
  return { doc: out, changed };
}
function vSn(id, d, a) {
  if (!isObj(d) || d.p !== id) bad('Dokumen kirim nilai tidak valid');
  const p = pesOf(id); if (!p) bad('Peserta tidak dikenal');
  const t = Number(d.t); if (!(t > 0 && t <= now() + FUTURE_MS)) bad('Cap waktu tidak valid');
  const cur = sentT(id); if (t < cur) return { doc: { p: id, t: cur }, changed: false };
  if (t > cur && !canEdit(a, p)) deny('Nilai peserta ini terkunci atau di luar lomba Anda');
  return { doc: { p: id, t }, changed: t > cur };
}
const RK = { menunggu: 0, disetujui: 1, ditolak: 1, selesai: 2 };
function vRq(id, d, a, old) {
  if (!/^[a-z0-9]{4,40}$/.test(id) || !isObj(d) || d.id !== id) bad('Dokumen permintaan tidak valid');
  const p = pesOf(d.p); if (!p) bad('Peserta tidak dikenal');
  if (RK[d.st] === undefined) bad('Status tidak valid');
  const doc = { id, p: d.p, l: p.l, g: p.t, t: +d.t || 0, a: str(d.a, 60), r: str(d.r, 300), st: d.st, ut: +d.ut || 0, by: str(d.by, 40), n: str(d.n, 300) };
  if (a.r !== 'a') {
    if (a.l && a.l !== p.l) deny('Bukan lomba Anda');
    if (!old) { if (doc.st !== 'menunggu') deny('Permintaan baru harus berstatus menunggu'); doc.a = a.nm; }
    else { if (!(old.st === 'disetujui' && doc.st === 'selesai')) deny('Hanya admin yang dapat memutuskan permintaan'); return { doc: Object.assign({}, old, { st: 'selesai', ut: doc.ut }), changed: true }; }
  } else if (old && RK[old.st] > RK[doc.st]) return { doc: old, changed: false };
  return { doc, changed: true };
}
function vSetup(d, a) {
  if (a.r !== 'a') deny('Hanya admin yang dapat mengubah pengaturan');
  if (!isObj(d) || !isObj(d.d) || !(+d.t > 0)) bad('Dokumen pengaturan tidak valid');
  if (JSON.stringify(d).length > 700000) bad('Pengaturan terlalu besar');
  const o = {}; for (const k of SK) if (d.d[k] !== undefined) o[k] = d.d[k];
  const arr = ['lombas', 'as', 'pes', 'tk', 'dh'], obj = ['crit', 'open', 'jr', 'fin', 'lt', 'dr', 'ttd', 'apv'];
  for (const k of arr) if (o[k] !== undefined && !Array.isArray(o[k])) bad('Bidang ' + k + ' harus berupa daftar');
  for (const k of obj) if (o[k] !== undefined && !isObj(o[k])) bad('Bidang ' + k + ' harus berupa objek');
  if (o.as && o.as.length > 300) bad('Terlalu banyak asisten');
  if (o.pes && o.pes.length > 3000) bad('Terlalu banyak peserta');
  const pins = {}; if (o.as) o.as = o.as.map(x => { x = x || {}; const id = str(x.id, 40), pin = str(x.pin, 40); if (id && pin) pins[id] = pin; return { id, name: str(x.name, 60), l: str(x.l, 40) }; });
  return { doc: { t: +d.t, d: o }, pins };
}
function vBrand(d, a) {
  if (a.r !== 'a') deny('Hanya admin yang dapat mengubah logo');
  const logo = isObj(d) ? String(d.logo || '') : ''; if (logo && !/^data:image\/(png|jpeg|webp|gif);base64,/.test(logo)) bad('Logo tidak valid'); if (logo.length > 350000) bad('Logo terlalu besar');
  return { doc: { logo }, changed: true };
}
function view(a, p, d) { if (p === 'meta/setup' && a.r === 'a' && d.d.as) return { t: d.t, d: Object.assign({}, d.d, { as: d.d.as.map(x => Object.assign({}, x, { pin: DB.pins[x.id] || '' })) }) }; return d; }
function canRead(a, p, d) {
  if (a.r === 'a' || p === 'meta/setup' || p === 'meta/brand') return true;
  if (!/^(sc|sn|rq)\//.test(p)) return false;
  const pe = pesOf(d.p); return !!pe && (!a.l || a.l === pe.l);
}
async function writeDoc(a, op, p, data) {
  return locked(async () => {
    if (a.r !== 'a' && !/^(sc|sn|rq)\//.test(p)) deny('Tidak ada izin menulis');
    const cur = DB.docs[p], old = cur ? cur.d : null; let res; const id = p.split('/')[1];
    if (op === 'update' && !old) throw fail(400, 'invalid_argument', 'Dokumen belum ada');
    const body = op === 'update' ? deepMerge(old, data) : data;
    if (p === 'meta/setup') res = vSetup(body, a);
    else if (p === 'meta/brand') res = vBrand(body, a);
    else if (/^sc\/[^/]+$/.test(p)) res = vSc(id, op === 'update' ? { p: old.p, j: old.j, cells: data.cells || {} } : data, a, old);
    else if (/^sn\/[^/]+$/.test(p)) res = vSn(id, body, a);
    else if (/^rq\/[^/]+$/.test(p)) res = vRq(id, body, a, old);
    else bad('Jalur dokumen tidak dikenal');
    if (p === 'meta/setup') res.changed = true;
    if (!res.changed && old) return DB.rev;
    const rev = DB.rev + 1, entry = { d: res.doc, r: rev };
    try {
      if (p === 'meta/setup') await storage.putKv('pins', res.pins);
      await storage.putDoc(p, entry);
    } catch (e) { throw unavailable(e); }
    if (p === 'meta/setup') DB.pins = res.pins;
    DB.rev = rev; DB.docs[p] = entry; notify(); return rev;
  });
}

/* ---------- perubahan (long-poll) ---------- */
const waiters = new Set();
function docsSince(a, since) {
  const out = [];
  for (const p of Object.keys(DB.docs)) { const e = DB.docs[p]; if (e.r > since && canRead(a, p, e.d)) out.push({ path: p, d: view(a, p, e.d), r: e.r }); }
  return out;
}
function notify() { for (const w of Array.from(waiters)) { const docs = docsSince(w.a, w.since); if (docs.length) { clearTimeout(w.timer); waiters.delete(w); send(w.res, 200, { rev: DB.rev, epoch: DB.epoch, docs }); } } }

/* ---------- penyaji berkas ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ico': 'image/x-icon', '.svg': 'image/svg+xml' };
function serveStatic(req, res, pathname) {
  let f = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  const full = path.normalize(path.join(PUB, f));
  if (!full.startsWith(PUB + path.sep) && full !== PUB) { res.writeHead(403, SEC); return res.end('Dilarang'); }
  fs.readFile(full, (e, buf) => {
    if (e) { res.writeHead(404, SEC); return res.end('Tidak ditemukan'); }
    const ext = path.extname(full);
    res.writeHead(200, Object.assign({ 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=86400' }, SEC)); res.end(buf);
  });
}

/* ---------- rute ---------- */
async function api(req, res, u) {
  const r = u.pathname.slice(5), q = u.searchParams;
  if (r === 'health') return send(res, 200, { ok: true, app: 'ajang', v: 1, storage: storage.name });
  if (r === 'login' && req.method === 'POST') return doLogin(req, res);
  if (r === 'brand') { const s = setup() || {}, b = DB.docs['meta/brand']; return send(res, 200, { title: s.title || '', sub: s.sub || '', logo: b ? b.d.logo : '' }); }
  const a = auth(req); if (!a) return send(res, 401, { code: 'unauthenticated', error: 'Silakan masuk' });
  if (r === 'me') return send(res, 200, { me: a.r === 'a' ? { r: 'a' } : { r: 'j', id: a.id, nm: a.nm, l: a.l }, dp: a.r === 'a' && !!DB.adminDefault });
  if (r === 'logout' && req.method === 'POST') { delete DB.sessions[a.key]; persistSessions(); return send(res, 200, { ok: true }); }
  if (r === 'doc' && req.method === 'GET') { const p = q.get('path') || '', e = DB.docs[p]; return send(res, 200, { v: e && canRead(a, p, e.d) ? view(a, p, e.d) : null }); }
  if (r === 'doc' && req.method === 'POST') { const b = await readBody(req, 1500000); const rev = await writeDoc(a, b.op === 'update' ? 'update' : 'set', str(b.path, 120), b.data); return send(res, 200, { ok: true, rev }); }
  if (r === 'changes') {
    const since = +q.get('since') || 0, epoch = +q.get('epoch') || 0, wait = Math.min(25, +q.get('wait') || 0);
    if (epoch && epoch !== DB.epoch) return send(res, 200, { reset: true, epoch: DB.epoch, rev: DB.rev, docs: [] });
    const docs = docsSince(a, since);
    if (docs.length || !wait || since === 0) return send(res, 200, { rev: DB.rev, epoch: DB.epoch, docs });
    const w = { a, since, res, timer: null }; waiters.add(w);
    w.timer = setTimeout(() => { waiters.delete(w); send(res, 200, { rev: DB.rev, epoch: DB.epoch, docs: [] }); }, wait * 1000);
    res.on('close', () => { clearTimeout(w.timer); waiters.delete(w); }); return;
  }
  if (a.r !== 'a') throw fail(403, 'denied', 'Hanya admin');
  if (r === 'status') return send(res, 200, { storage: storage.name, detail: storage.describe(), docs: Object.keys(DB.docs).length, rev: DB.rev, epoch: DB.epoch, sessions: Object.keys(DB.sessions).length, uptime: Math.round(process.uptime()), lastOk: storage.lastOk, lastError: storage.lastError });
  if (r === 'admin/pin' && req.method === 'POST') { const b = await readBody(req, 2000), pin = str(b.pin, 40); if (pin.length < 4 || pin === '1234') bad('PIN minimal 4 karakter dan bukan 1234'); const h = hashPin(pin); try { await storage.putKv('admin', { hash: h, def: false }); } catch (e) { throw unavailable(e); } DB.admin = h; DB.adminDefault = false; return send(res, 200, { ok: true }); }
  if (r === 'backup') { res.writeHead(200, Object.assign({ 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="cadangan-ajang.json"', 'Cache-Control': 'no-store' }, SEC)); return res.end(JSON.stringify({ app: 'ajang', rev: DB.rev, docs: DB.docs, pins: DB.pins })); }
  if (r === 'restore' && req.method === 'POST') {
    const b = await readBody(req, 30000000); if (b.app !== 'ajang' || !isObj(b.docs)) bad('Berkas cadangan tidak valid');
    await locked(async () => {
      const rev = (DB.rev || 0) + 1, docs = {}; for (const k of Object.keys(b.docs)) { const e = b.docs[k]; if (e && isObj(e.d)) docs[k] = { d: e.d, r: rev }; }
      const pins = isObj(b.pins) ? b.pins : {};
      try { await storage.replaceDocs(docs); await storage.putKv('pins', pins); await storage.putKv('state', { rev, epoch: DB.epoch + 1 }); } catch (e) { throw unavailable(e); }
      DB.docs = docs; DB.pins = pins; DB.rev = rev; DB.epoch++; notify();
    });
    return send(res, 200, { ok: true });
  }
  if (r === 'reset' && req.method === 'POST') {
    await locked(async () => {
      const rev = DB.rev + 1;
      try { await storage.replaceDocs({}); await storage.putKv('pins', {}); await storage.putKv('state', { rev, epoch: DB.epoch + 1 }); } catch (e) { throw unavailable(e); }
      DB.docs = {}; DB.pins = {}; DB.epoch++; DB.rev = rev;
      for (const w of Array.from(waiters)) { clearTimeout(w.timer); waiters.delete(w); send(w.res, 200, { reset: true, epoch: DB.epoch, rev: DB.rev, docs: [] }); }
    });
    return send(res, 200, { ok: true });
  }
  send(res, 404, { code: 'not_found', error: 'Tidak ditemukan' });
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/')) api(req, res, u).catch(e => { if (e.status === 413) { res.setHeader('Connection', 'close'); res.on('finish', () => req.destroy()); } if (!res.headersSent) send(res, e.status || 500, { code: e.code || 'server_error', error: e.status ? e.message : 'Terjadi kesalahan pada server' }); if (!e.status) console.error(e); });
  else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, u.pathname);
  else { res.writeHead(405, SEC); res.end(); }
});
server.requestTimeout = 0; server.headersTimeout = 30000; server.keepAliveTimeout = 65000;
function shutdown() { try { storage.flushNow(); } catch (e) {} process.exit(0); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
async function boot() {
  try { await storage.init(); await storage.check(); }
  catch (e) { console.error('\nGAGAL TERHUBUNG KE PENYIMPANAN (' + storage.name + '): ' + e.message + (e.hint ? '\n-> ' + e.hint : '') + '\n'); process.exit(1); }
  if (!DB.admin) {
    DB.admin = hashPin(process.env.ADMIN_PIN || '1234'); DB.adminDefault = !process.env.ADMIN_PIN;
    try { await storage.putKv('admin', { hash: DB.admin, def: DB.adminDefault }); } catch (e) { console.error('Gagal menyimpan PIN admin:', e.message); process.exit(1); }
  }
  server.listen(PORT, HOST, () => {
    console.log('Server Penilaian Ajang berjalan di port ' + PORT + '. Penyimpanan: ' + storage.describe());
    if (DB.adminDefault) console.log('PERINGATAN: PIN admin masih bawaan (1234). Segera ganti setelah masuk, atau jalankan dengan ADMIN_PIN=...');
  });
}
if (require.main === module) boot();
module.exports = { server, boot };
