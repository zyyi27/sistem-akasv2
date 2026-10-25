'use strict';
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path');
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ajang-')), PORT = 4100 + Math.floor(Math.random() * 500);
let proc, pass = 0, failN = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('LULUS  ' + n); } else { failN++; console.log('GAGAL  ' + n + (extra ? ' -> ' + extra : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function start() { proc = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: Object.assign({}, process.env, { PORT, DATA_DIR: DIR, TRUST_PROXY: '1' }), stdio: 'ignore' }); return waitUp(); }
async function waitUp() { for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) return; } catch (e) {} await sleep(100); } throw new Error('server tidak naik'); }
async function stop() { proc.kill('SIGTERM'); await sleep(500); }
let ipN = 1;
async function call(m, p, body, tok, ip) { const r = await fetch(`http://127.0.0.1:${PORT}/api/${p}`, { method: m, headers: Object.assign({ 'Content-Type': 'application/json', 'X-Forwarded-For': ip || ('10.0.0.' + (ipN++)) }, tok ? { Authorization: 'Bearer ' + tok } : {}), body: body ? JSON.stringify(body) : undefined }); let j = {}; try { j = await r.json(); } catch (e) {} return { s: r.status, j }; }
const put = (tok, op, p, data) => call('POST', 'doc', { op, path: p, data }, tok);
(async () => {
  await start();
  ok('health', (await call('GET', 'health')).j.app === 'ajang');
  ok('sebelum masuk, data tidak bisa dibaca (401)', (await call('GET', 'changes?since=0')).s === 401);
  ok('PIN admin salah ditolak', (await call('POST', 'login', { role: 'a', pin: '9999' })).s === 401);
  const A = await call('POST', 'login', { role: 'a', pin: '1234' }); const adm = A.j.token;
  ok('admin masuk, PIN bawaan ditandai', A.s === 200 && A.j.dp === true && /^[a-f0-9]{48}$/.test(adm));
  // pengaturan awal
  const setupDoc = (extra) => ({ t: Date.now(), d: Object.assign({ title: 'Festival Uji', sub: 'Tema', lombas: [{ id: 'l0', n: 'Mewarnai' }, { id: 'l1', n: 'Adzan' }], crit: {}, open: { l0: true, l1: true }, as: [{ id: 'as1abcd', name: 'Siti', pin: '5555', l: 'l0' }, { id: 'as2abcd', name: 'Budi', pin: '6666', l: 'l1' }], jr: { l0: [{ id: 'jr0aaaa', name: 'J1' }, { id: 'jr0bbbb', name: 'J2' }, { id: 'jr0cccc', name: 'J3' }], l1: [{ id: 'jr1aaaa', name: 'K1' }] }, pes: [{ id: 'pe0aaaa', nm: 'Aisyah', l: 'l0', t: 0, no: 1 }, { id: 'pe1aaaa', nm: 'Umar', l: 'l1', t: 0, no: 1 }], fin: {}, apv: {}, tk: ['A', 'B', 'C'], lt: {}, pub: false, dr: {}, dh: [], ttd: {} }, extra || {}) });
  ok('admin menyimpan pengaturan', (await put(adm, 'set', 'meta/setup', setupDoc())).s === 200);
  ok('brand publik (tanpa masuk) memuat judul', (await call('GET', 'brand')).j.title === 'Festival Uji');
  const adminView = (await call('GET', 'doc?path=meta%2Fsetup', null, adm)).j.v;
  ok('admin melihat PIN asisten', adminView.d.as[0].pin === '5555');
  // asisten
  ok('PIN asisten salah ditolak', (await call('POST', 'login', { role: 'j', pin: '0000' })).s === 401);
  const S1 = await call('POST', 'login', { role: 'j', pin: '5555' }); const as1 = S1.j.token;
  ok('asisten Siti masuk dan terikat ke lomba l0', S1.s === 200 && S1.j.me.l === 'l0' && S1.j.me.nm === 'Siti');
  const asView = (await call('GET', 'doc?path=meta%2Fsetup', null, as1)).j.v;
  ok('asisten TIDAK melihat PIN siapa pun', asView.d.as.every(x => !x.pin));
  const t1 = Date.now();
  const cell = (v, t) => ({ v, t, a: 'Siti', h: [] });
  ok('asisten menulis nilai di lomba sendiri', (await put(as1, 'set', 'sc/pe0aaaa_jr0aaaa', { p: 'pe0aaaa', j: 'jr0aaaa', cells: { 0: cell(80, t1) } })).s === 200);
  const o = await put(as1, 'set', 'sc/pe1aaaa_jr1aaaa', { p: 'pe1aaaa', j: 'jr1aaaa', cells: { 0: cell(80, t1) } });
  ok('asisten ditolak menulis di lomba orang lain (403)', o.s === 403 && o.j.code === 'denied');
  ok('nilai 150 ditolak (400)', (await put(as1, 'update', 'sc/pe0aaaa_jr0aaaa', { cells: { 1: cell(150, t1 + 1) } })).s === 400);
  ok('cap waktu jauh di masa depan ditolak', (await put(as1, 'update', 'sc/pe0aaaa_jr0aaaa', { cells: { 1: cell(10, Date.now() + 9e8) } })).s === 400);
  ok('peserta tak dikenal ditolak', (await put(as1, 'set', 'sc/zzzzzz_jr0aaaa', { p: 'zzzzzz', j: 'jr0aaaa', cells: { 0: cell(5, t1) } })).s === 400);
  ok('update pada dokumen yang belum ada -> invalid_argument', (await put(as1, 'update', 'sc/pe0aaaa_jr0bbbb', { cells: { 0: cell(70, t1) } })).j.code === 'invalid_argument');
  await put(as1, 'set', 'sc/pe0aaaa_jr0bbbb', { p: 'pe0aaaa', j: 'jr0bbbb', cells: { 0: cell(70, t1) } });
  await put(as1, 'update', 'sc/pe0aaaa_jr0aaaa', { cells: { 0: cell(10, t1 - 5000) } });
  const cur = (await call('GET', 'doc?path=sc%2Fpe0aaaa_jr0aaaa', null, as1)).j.v;
  ok('nilai lama (cap waktu lebih kecil) tidak menimpa yang baru', cur.cells[0].v === 80);
  ok('asisten tidak boleh mengubah pengaturan (403)', (await put(as1, 'set', 'meta/setup', setupDoc())).s === 403);
  ok('asisten tidak boleh mengubah logo (403)', (await put(as1, 'set', 'meta/brand', { logo: '' })).s === 403);
  ok('jalur sembarang ditolak', (await put(as1, 'set', 'x/y', { a: 1 })).s === 403);
  // kirim nilai lalu terkunci
  const tSent = Date.now() + 10;
  ok('asisten mengirim nilai (sn)', (await put(as1, 'set', 'sn/pe0aaaa', { p: 'pe0aaaa', t: tSent })).s === 200);
  const lk = await put(as1, 'update', 'sc/pe0aaaa_jr0aaaa', { cells: { 0: cell(99, tSent + 5) } });
  ok('setelah terkirim, mengubah nilai ditolak server (403)', lk.s === 403, JSON.stringify(lk));
  // permintaan koreksi
  const rq = { id: 'rq1aaaa', p: 'pe0aaaa', st: 'menunggu', t: Date.now(), ut: Date.now(), a: 'siapa saja', r: 'Salah ketik nilai' };
  ok('asisten membuat permintaan koreksi', (await put(as1, 'set', 'rq/rq1aaaa', rq)).s === 200);
  ok('asisten tidak bisa menyetujui permintaannya sendiri', (await put(as1, 'set', 'rq/rq1aaaa', Object.assign({}, rq, { st: 'disetujui' }))).s === 403);
  ok('admin menyetujui permintaan', (await put(adm, 'set', 'rq/rq1aaaa', Object.assign({}, rq, { st: 'disetujui', by: 'Admin', ut: Date.now() + 1 }))).s === 200);
  ok('asisten tetap terkunci sampai persetujuan tercatat di pengaturan', (await put(as1, 'update', 'sc/pe0aaaa_jr0aaaa', { cells: { 0: cell(88, tSent + 6) } })).s === 403);
  await put(adm, 'set', 'meta/setup', setupDoc({ apv: { pe0aaaa: { s: tSent, q: 'rq1aaaa' } } }));
  ok('setelah persetujuan, asisten boleh mengoreksi', (await put(as1, 'update', 'sc/pe0aaaa_jr0aaaa', { cells: { 0: cell(88, tSent + 7) } })).s === 200);
  ok('asisten menandai permintaan selesai', (await put(as1, 'set', 'rq/rq1aaaa', Object.assign({}, rq, { st: 'selesai', ut: Date.now() + 2 }))).s === 200);
  ok('kirim ulang menguncinya lagi', (await put(as1, 'set', 'sn/pe0aaaa', { p: 'pe0aaaa', t: tSent + 100 })).s === 200 && (await put(as1, 'update', 'sc/pe0aaaa_jr0aaaa', { cells: { 0: cell(77, tSent + 120) } })).s === 403);
  // pengesahan
  await put(adm, 'set', 'meta/setup', setupDoc({ fin: { 'l1|0': Date.now() } }));
  const S2 = await call('POST', 'login', { role: 'j', pin: '6666' }); const as2 = S2.j.token;
  ok('hasil yang sudah disahkan mengunci asisten (403)', (await put(as2, 'set', 'sc/pe1aaaa_jr1aaaa', { p: 'pe1aaaa', j: 'jr1aaaa', cells: { 0: cell(50, Date.now()) } })).s === 403);
  ok('admin tetap boleh mengoreksi', (await put(adm, 'set', 'sc/pe1aaaa_jr1aaaa', { p: 'pe1aaaa', j: 'jr1aaaa', cells: { 0: cell(55, Date.now()) } })).s === 200);
  // pembacaan terfilter
  const ch1 = (await call('GET', 'changes?since=0', null, as1)).j.docs.map(d => d.path), ch2 = (await call('GET', 'changes?since=0', null, as2)).j.docs.map(d => d.path);
  ok('asisten lomba A hanya melihat dokumen lomba A', ch1.some(p => p.startsWith('sc/pe0')) && !ch1.some(p => p.startsWith('sc/pe1')));
  ok('asisten lomba B hanya melihat dokumen lomba B', ch2.some(p => p.startsWith('sc/pe1')) && !ch2.some(p => p.startsWith('sc/pe0')));
  // long-poll
  const rev = (await call('GET', 'changes?since=0', null, as1)).j.rev; const t0 = Date.now();
  const waiting = call('GET', `changes?since=${rev}&wait=10`, null, adm);
  await sleep(300); await put(adm, 'update', 'sc/pe0aaaa_jr0bbbb', { cells: { 0: cell(71, Date.now()) } });
  const lp = await waiting;
  ok('long-poll langsung terjawab saat ada perubahan (' + (Date.now() - t0) + ' ms)', lp.j.docs.length >= 1 && Date.now() - t0 < 2500);
  const idle = await call('GET', `changes?since=${lp.j.rev}&wait=1`, null, adm);
  ok('long-poll tanpa perubahan kembali kosong', idle.j.docs.length === 0);
  // PIN admin
  ok('ganti PIN admin ke 1234 ditolak', (await call('POST', 'admin/pin', { pin: '1234' }, adm)).s === 400);
  ok('asisten tidak bisa ganti PIN admin', (await call('POST', 'admin/pin', { pin: 'abcd1234' }, as1)).s === 403);
  ok('admin ganti PIN', (await call('POST', 'admin/pin', { pin: 'rahasia9' }, adm)).s === 200);
  ok('PIN lama tidak berlaku, PIN baru berlaku tanpa tanda bawaan', (await call('POST', 'login', { role: 'a', pin: '1234' })).s === 401 && (await call('POST', 'login', { role: 'a', pin: 'rahasia9' })).j.dp === false);
  // cadangan dan pemulihan
  const bk = await fetch(`http://127.0.0.1:${PORT}/api/backup`, { headers: { Authorization: 'Bearer ' + adm } }).then(r => r.json());
  ok('cadangan berisi dokumen', bk.app === 'ajang' && Object.keys(bk.docs).length >= 6 && bk.pins.as1abcd === '5555');
  ok('asisten tidak boleh mengunduh cadangan', (await fetch(`http://127.0.0.1:${PORT}/api/backup`, { headers: { Authorization: 'Bearer ' + as1 } })).status === 403);
  // ketahanan: simpan ke disk, mulai ulang, sesi dan data tetap ada
  await sleep(500); await stop(); await start();
  ok('setelah server dimulai ulang, sesi asisten masih berlaku', (await call('GET', 'me', null, as1)).s === 200);
  ok('setelah dimulai ulang, nilai masih ada', (await call('GET', 'doc?path=sc%2Fpe0aaaa_jr0aaaa', null, as1)).j.v.cells[0].v === 88);
  ok('berkas cadangan otomatis dibuat', fs.readdirSync(DIR).some(f => /^cadangan-/.test(f)));
  // reset dan epoch
  const ep = (await call('GET', 'changes?since=0', null, adm)).j.epoch;
  ok('reset oleh admin', (await call('POST', 'reset', {}, adm)).s === 200);
  const rs = (await call('GET', `changes?since=0&epoch=${ep}`, null, adm)).j;
  ok('klien lain diberi tahu data direset (epoch berubah)', rs.reset === true && rs.epoch !== ep);
  ok('setelah reset, data kosong', (await call('GET', 'changes?since=0', null, adm)).j.docs.length === 0);
  const rst = await call('POST', 'restore', bk, adm);
  ok('pemulihan dari cadangan berhasil', rst.s === 200 && (await call('GET', 'doc?path=sc%2Fpe0aaaa_jr0aaaa', null, adm)).j.v.cells[0].v === 88);
  // keamanan berkas
  const tr = await fetch(`http://127.0.0.1:${PORT}/..%2f..%2fserver.js`); ok('penelusuran jalur (path traversal) diblokir', tr.status >= 400);
  const tr2 = await fetch(`http://127.0.0.1:${PORT}/data/db.json`); ok('berkas data tidak bisa diunduh lewat web', tr2.status === 404);
  let bigS = 0; try { bigS = (await call('POST', 'doc', { op: 'set', path: 'sn/x', data: { pad: 'x'.repeat(1600000) } }, adm)).s; } catch (e) { bigS = 413; } ok('isi terlalu besar ditolak (413)', bigS === 413);
  // pembatasan percobaan login
  const ipX = '203.0.113.9'; let last; for (let i = 0; i < 9; i++) last = await call('POST', 'login', { role: 'a', pin: 'salah' + i }, null, ipX);
  ok('percobaan PIN berulang dibatasi (429)', last.s === 429);
  ok('IP lain tidak ikut terblokir', (await call('POST', 'login', { role: 'a', pin: 'rahasia9' }, null, '203.0.113.10')).s === 200);
  await stop();
  console.log(`\nTotal: ${pass} lulus, ${failN} gagal`); process.exit(failN ? 1 : 0);
})().catch(e => { console.error(e); try { proc.kill(); } catch (x) {} process.exit(1); });
