'use strict';
const { spawn } = require('child_process'), path = require('path');
const { createMock } = require('./mock-postgrest');
let pass = 0, failN = 0;
const ok = (n, c, x) => { if (c) { pass++; console.log('LULUS  ' + n); } else { failN++; console.log('GAGAL  ' + n + (x ? ' -> ' + x : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = 'eyJhbGciOiJIUzI1NiJ9.service-role-uji.abc', PORT = 4700 + Math.floor(Math.random() * 90);
let proc, out = '';
function start(env) { out = ''; proc = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT, STORAGE: 'supabase', TRUST_PROXY: '1', ADMIN_PIN: 'pin-admin-1' }, env) }); proc.stdout.on('data', d => out += d); proc.stderr.on('data', d => out += d); }
async function up() { for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) return await r.json(); } catch (e) {} await sleep(100); } return null; }
const stop = async () => { proc.kill('SIGTERM'); await sleep(400); };
let ip = 1;
async function call(m, p, body, tok) { const r = await fetch(`http://127.0.0.1:${PORT}/api/${p}`, { method: m, headers: Object.assign({ 'Content-Type': 'application/json', 'X-Forwarded-For': '10.1.0.' + (ip++) }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; }
const put = (tok, op, p, data) => call('POST', 'doc', { op, path: p, data }, tok);
(async () => {
  const mock = await createMock(KEY), env = { SUPABASE_URL: 'http://127.0.0.1:' + mock.port, SUPABASE_SERVICE_KEY: KEY };
  // --- salah kunci: gagal naik dengan pesan jelas
  start({ SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_KEY: 'kunci-salah' }); await sleep(1500);
  ok('kunci salah: server berhenti dengan petunjuk jelas', /GAGAL TERHUBUNG/.test(out) && /service_role/.test(out) && !(await up()), out.slice(0, 160)); await stop();
  // --- tabel belum dibuat
  mock.missingTable = true; start(env); await sleep(1500);
  ok('tabel belum ada: petunjuk menjalankan schema.sql', /schema\.sql/.test(out)); await stop(); mock.missingTable = false;
  // --- normal
  start(env); const h = await up();
  ok('server naik dengan penyimpanan Supabase', h && h.storage === 'supabase');
  ok('uji tulis-baca saat start tidak meninggalkan sisa', !mock.tables.ajang_kv.has('_cek'));
  const reqs = mock.log.filter(l => l.method === 'POST');
  ok('upsert memakai on_conflict dan Prefer merge-duplicates', reqs.length > 0 && reqs.every(l => /on_conflict=(k|path)/.test(l.query) && /resolution=merge-duplicates/.test(l.prefer)));
  ok('kunci dikirim lewat header apikey (dan Bearer untuk kunci JWT)', mock.log.every(l => l.apikey === KEY && l.auth === 'Bearer ' + KEY));
  ok('PIN admin tersimpan sebagai hash (bukan teks biasa)', mock.tables.ajang_kv.has('admin') && !JSON.stringify(mock.tables.ajang_kv.get('admin')).includes('pin-admin-1'));
  const A = await call('POST', 'login', { role: 'a', pin: 'pin-admin-1' }); const adm = A.j.token;
  ok('masuk memakai ADMIN_PIN dari lingkungan', A.s === 200 && A.j.dp === false);
  const setup = { t: Date.now(), d: { title: 'Festival Uji', lombas: [{ id: 'l0', n: 'Mewarnai' }], crit: {}, open: { l0: true }, as: [{ id: 'as1abcd', name: 'Siti', pin: '5555', l: 'l0' }], jr: { l0: [{ id: 'jr0aaaa', name: 'J1' }] }, pes: [{ id: 'pe0aaaa', nm: 'Aisyah', l: 'l0', t: 0, no: 1 }], fin: {}, apv: {}, tk: ['A', 'B', 'C'], lt: {}, dr: {}, dh: [], ttd: {} } };
  ok('pengaturan tersimpan ke Supabase', (await put(adm, 'set', 'meta/setup', setup)).s === 200 && mock.tables.ajang_docs.has('meta/setup'));
  ok('PIN asisten disimpan terpisah dan tidak ada di dokumen pengaturan', mock.tables.ajang_kv.get('pins').v.as1abcd === '5555' && !JSON.stringify(mock.tables.ajang_docs.get('meta/setup')).includes('5555'));
  const S1 = await call('POST', 'login', { role: 'j', pin: '5555' }); const as1 = S1.j.token; await sleep(700);
  const t1 = Date.now();
  ok('asisten menulis nilai', (await put(as1, 'set', 'sc/pe0aaaa_jr0aaaa', { p: 'pe0aaaa', j: 'jr0aaaa', cells: { 0: { v: 80, t: t1, a: 'Siti', h: [] } } })).s === 200);
  ok('nilai ada di tabel Supabase sebelum server membalas', mock.tables.ajang_docs.get('sc/pe0aaaa_jr0aaaa').d.cells[0].v === 80);
  // --- gangguan Supabase saat menulis: ditolak 503, data tidak berubah
  mock.failNext = 9; mock.failStatus = 503;
  const bad = await put(as1, 'update', 'sc/pe0aaaa_jr0aaaa', { cells: { 0: { v: 99, t: t1 + 10, a: 'Siti', h: [] } } });
  ok('saat Supabase gangguan, server membalas 503 (klien akan mengulang)', bad.s === 503 && bad.j.code === 'unavailable', JSON.stringify(bad));
  mock.failNext = 0;
  ok('nilai di memori tidak berubah akibat tulis yang gagal', (await call('GET', 'doc?path=sc%2Fpe0aaaa_jr0aaaa', null, as1)).j.v.cells[0].v === 80);
  ok('setelah Supabase pulih, tulis berhasil', (await put(as1, 'update', 'sc/pe0aaaa_jr0aaaa', { cells: { 0: { v: 91, t: t1 + 20, a: 'Siti', h: [] } } })).s === 200);
  mock.failNext = 1; mock.failStatus = 503;
  ok('gangguan singkat (1 kali) ditutup otomatis oleh percobaan ulang', (await put(as1, 'update', 'sc/pe0aaaa_jr0aaaa', { cells: { 0: { v: 92, t: t1 + 30, a: 'Siti', h: [] } } })).s === 200);
  // sesi baru yang tersimpan saat Supabase sedang gangguan harus tersimpan ulang otomatis
  mock.failNext = 3; mock.failStatus = 503; const SX = await call('POST', 'login', { role: 'j', pin: '5555' }); await sleep(6500);
  const shaT = t => require('crypto').createHash('sha256').update(t).digest('hex');
  ok('sesi yang gagal tersimpan dicoba ulang otomatis sampai berhasil', !!mock.tables.ajang_kv.get('sessions').v[shaT(SX.j.token)]);
  // --- status admin
  const stt = (await call('GET', 'status', null, adm)).j;
  ok('status admin menampilkan penyimpanan dan jumlah dokumen', stt.storage === 'supabase' && stt.docs >= 2);
  ok('asisten tidak boleh melihat status', (await call('GET', 'status', null, as1)).s === 403);
  // --- mulai ulang: semua data dimuat dari Supabase
  await sleep(700); await stop(); start(env); await up();
  ok('setelah server dimulai ulang, nilai dimuat dari Supabase', (await call('GET', 'doc?path=sc%2Fpe0aaaa_jr0aaaa', null, as1)).j.v.cells[0].v === 92);
  ok('sesi asisten bertahan (tersimpan di Supabase)', (await call('GET', 'me', null, as1)).s === 200);
  ok('login admin masih memakai PIN yang sama', (await call('POST', 'login', { role: 'a', pin: 'pin-admin-1' })).s === 200);
  // --- ganti PIN, cadangan, reset, pulihkan
  ok('ganti PIN admin tersimpan', (await call('POST', 'admin/pin', { pin: 'baru-9999' }, adm)).s === 200);
  const bk = await fetch(`http://127.0.0.1:${PORT}/api/backup`, { headers: { Authorization: 'Bearer ' + adm } }).then(r => r.json());
  ok('cadangan berisi dokumen dari Supabase', Object.keys(bk.docs).length >= 2);
  ok('reset mengosongkan tabel Supabase', (await call('POST', 'reset', {}, adm)).s === 200 && mock.tables.ajang_docs.size === 0);
  ok('pulihkan dari cadangan mengisi kembali Supabase', (await call('POST', 'restore', bk, adm)).s === 200 && mock.tables.ajang_docs.size >= 2);
  await sleep(700); await stop(); start(env); await up();
  ok('setelah reset+pulihkan+mulai ulang: PIN baru dan data utuh', (await call('POST', 'login', { role: 'a', pin: 'baru-9999' })).s === 200 && (await call('GET', 'doc?path=sc%2Fpe0aaaa_jr0aaaa', null, adm)).j.v.cells[0].v === 92);
  ok('epoch bertahan setelah mulai ulang', mock.tables.ajang_kv.get('state').v.epoch >= 3);
  await stop(); mock.close();
  console.log(`\nTotal: ${pass} lulus, ${failN} gagal`); process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); try { proc.kill(); } catch (x) {} process.exit(1); });
