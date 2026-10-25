'use strict';
/* Tiruan sederhana PostgREST (API REST Supabase) untuk pengujian tanpa internet.
   Meniru kontrak yang dipakai server: apikey, on_conflict + Prefer: resolution=merge-duplicates,
   filter k=eq.x / path=not.is.null, limit/offset, kode galat 401/404. */
const http = require('http');
function createMock(expectedKey) {
  const tables = { ajang_docs: new Map(), ajang_kv: new Map() }, log = [];
  const pk = { ajang_docs: 'path', ajang_kv: 'k' };
  const ctl = { failNext: 0, failStatus: 503, missingTable: false, log, tables };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x'), m = /^\/rest\/v1\/([a-z_]+)$/.exec(u.pathname);
    const out = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      if (req.headers.apikey !== expectedKey) return out(401, { message: 'Invalid API key' });
      if (!m) return out(404, {});
      const t = m[1];
      log.push({ method: req.method, table: t, query: u.search, prefer: req.headers.prefer || '', auth: req.headers.authorization || '', apikey: req.headers.apikey });
      if (ctl.failNext > 0) { ctl.failNext--; return out(ctl.failStatus, { message: 'sementara tidak tersedia' }); }
      if (ctl.missingTable || !tables[t]) return out(404, { code: 'PGRST205', message: "Could not find the table 'public." + t + "' in the schema cache" });
      const key = pk[t], tb = tables[t];
      const q = u.searchParams;
      const matchRow = row => { for (const [k, v] of q.entries()) { if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue; if (/^eq\./.test(v) && String(row[k]) !== v.slice(3)) return false; if (v === 'not.is.null' && row[k] == null) return false; } return true; };
      if (req.method === 'GET') {
        let rows = [...tb.values()].filter(matchRow).sort((a, b) => String(a[key]).localeCompare(String(b[key])));
        const off = +q.get('offset') || 0, lim = +q.get('limit') || 1000; return out(200, rows.slice(off, off + Math.min(lim, 1000)));
      }
      if (req.method === 'POST') {
        const rows = JSON.parse(body || '[]'); if (!Array.isArray(rows)) return out(400, { message: 'harus array' });
        if (q.get('on_conflict') !== key || !/resolution=merge-duplicates/.test(req.headers.prefer || '')) return out(409, { code: '23505', message: 'duplicate key value violates unique constraint' });
        for (const r of rows) tb.set(r[key], JSON.parse(JSON.stringify(r))); return out(201);
      }
      if (req.method === 'DELETE') { if (![...q.keys()].length) return out(400, { message: 'DELETE requires a WHERE clause' }); for (const [k, r] of [...tb.entries()]) if (matchRow(r)) tb.delete(k); return out(204); }
      out(405, {});
    });
  });
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok(Object.assign(ctl, { srv, port: srv.address().port, close: () => srv.close() }))));
}
module.exports = { createMock };
