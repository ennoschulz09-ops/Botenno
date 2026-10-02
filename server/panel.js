// Übergangs-Oberfläche für den PC-Betrieb: kleiner HTTP-Server nur auf 127.0.0.1 (von außen nicht erreichbar) mit
// Statusseite und JSON-API. Schutz gegen fremde Webseiten im selben Browser: Host-Prüfung (gegen DNS-Rebinding) und
// Pflicht-Header X-SmartLab bei allen ändernden Anfragen (fremde Seiten können ihn nicht ohne CORS-Freigabe setzen).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const STATIC = {
  '/': ['panel/index.html', 'text/html; charset=utf-8'],
  '/app.js': ['panel/app.js', 'text/javascript; charset=utf-8']
};
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const MAX_BODY = 64 * 1024 * 1024; // Vollsicherungen können mit großem Lern-Gedächtnis einige MB groß werden
const EXPORT_KINDS = new Set(['journal-json', 'journal-csv', 'learning-report-csv', 'learning-json', 'experiments-json', 'patterns-json', 'model-registry-json', 'analytics-json', 'logs-json', 'settings-json']);

function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP, ...extra });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { reject(new Error('Datei zu groß')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r2 = v => (num(v) == null ? null : Math.round(v * 100) / 100);

/* Alles, was die Oberfläche anzeigt, in einer Antwort (Abfrage alle 2 s). */
function statusOf(holder) {
  const core = holder.core, st = core.state, s = core.S(), K = holder.K, now = Date.now();
  const eq = core.equityInfo(), rd = core.readiness(), lv = core.learnView(), q = lv.quality;
  const closed = st.journal.filter(j => j.status === 'CLOSED' && j.result);
  const perf = K.perfStats(closed);
  const hyp = {}; for (const h of st.research.hypotheses) hyp[h.status] = (hyp[h.status] || 0) + 1;
  const apis = Object.keys(core.http.sources).map(n => core.http.snapshot(n)).filter(Boolean).map(a => ({ name: a.label, status: a.status, latency: a.latency != null ? Math.round(a.latency) : null, lastError: a.lastError || '' }));
  return {
    app: K.APP_VERSION, now, startedAt: holder.startedAt, dataDir: holder.dataDir, mock: holder.mock, lastBackup: holder.lastBackup ? path.basename(holder.lastBackup) : null,
    mode: st.mode,
    bot: { state: st.bot.state, desired: st.bot.desired, autoTrading: st.bot.autoTrading, emergency: st.bot.emergency, emergencyReason: st.bot.emergencyReason, safeMode: st.bot.safeMode, readiness: rd.state, reason: rd.reason },
    scanner: { running: st.scanner.running, lastAt: st.scanner.lastAt || null, lastMs: st.scanner.lastDuration, scans: st.metrics.counters.scans, tokens: st.markets.size, health: core.systemHealth().score },
    portfolio: { start: st.portfolio.startCapital, equity: r2(eq.equity), cash: r2(st.portfolio.cash), exposure: r2(eq.exposure), exposurePct: r2(eq.exposurePct), realized: r2(st.portfolio.realized), fees: r2(st.portfolio.fees), drawdownPct: r2(core.drawdownPct()) },
    perf: { trades: perf.trades, winRate: r2(perf.winRate), profitFactor: perf.profitFactor === Infinity ? null : r2(perf.profitFactor), expectancy: r2(perf.expectancy), net: r2(perf.net) },
    positions: st.positions.map(p => ({ id: p.id, symbol: p.symbol, mint: p.mint, openedAt: p.openedAt, costUsd: r2(p.costUsd), value: r2(p.value), pnlUsd: r2(p.pnlUsd), pnlPct: r2(p.pnlPct), entryPrice: p.entryPrice, lastPrice: p.lastPrice, stop: p.stop, stopType: p.stopType, lc: p.lc, buys: p.entries.length, noRoute: !!p.noRouteSince, priceLabel: p.priceLabel, strategy: p.strategy })),
    trades: closed.slice(0, 40).map(j => ({ id: j.id, symbol: j.symbol, openedAt: j.openedAt, closedAt: j.closedAt, sizeUsd: r2(j.sizeUsd), pnlUsd: r2(j.result.pnlUsd), pnlPct: r2(j.result.pnlPct), exitReason: j.exitReason, strategy: j.strategy, discovery: j.discovery || null, buys: (j.entries || []).length })),
    learn: {
      enabled: !!s.learnEnabled, records: q.total, learnable: q.learnable, excluded: q.excluded, byFlag: Object.fromEntries(Object.entries(q.byFlag).map(([k, n]) => [K.RECORD_FLAGS_DE[k] || k, n])),
      champion: lv.champion ? lv.champion.id : null, rules: lv.rulesText, hypotheses: hyp, drift: st.learn.drift ? st.learn.drift.status : 'NOT_ENOUGH_DATA', lastRunAt: st.learn.lastRunAt || null,
      lessons: st.learn.lessons.filter(l => l.status !== 'EXPIRED').slice(0, 6).map(l => ({ kind: l.kind, text: l.text, status: l.status }))
    },
    monitor: Object.values(st.monitor.active).map(a => ({ code: a.code, sev: a.sev, msg: a.msg })),
    apis,
    settings: { simCapitalUsd: s.simCapitalUsd, minScore: s.minScore, stopLossPct: s.stopLossPct, maxPositionPct: s.maxPositionPct, maxExposurePct: s.maxExposurePct, maxOpenPositions: s.maxOpenPositions, maxBuysPerCoin: s.maxBuysPerCoin, addOnlyInProfit: s.addOnlyInProfit, realQuotes: s.realQuotes, simLatencyMs: s.simLatencyMs },
    logs: core.log.entries.filter(e => e.level !== 'DEBUG').slice(-80).reverse().map(e => ({ ts: e.ts, level: e.level, category: e.category, message: e.message }))
  };
}

async function act(holder, body) {
  const core = holder.core, a = body.action;
  if (a === 'start') return core.start();
  if (a === 'pause') return core.pause();
  if (a === 'auto-on') return core.setAutoTrading(true);
  if (a === 'auto-off') return core.setAutoTrading(false);
  if (a === 'emergency') return core.emergencyStop('Not-Aus über die PC-Oberfläche');
  if (a === 'release') return core.releaseEmergency();
  if (a === 'fresh-start') return core.freshStart();
  if (a === 'learn-run') return { ok: true, result: core.learnRunNow() };
  if (a === 'sell') {
    const frac = body.frac === 'ALL' ? 'ALL' : Number(body.frac);
    if (frac !== 'ALL' && !(frac > 0 && frac <= 1)) return { ok: false, error: 'Ungültiger Anteil' };
    const r = await core.executeSell(String(body.posId || ''), frac, 'MANUAL', { auto: false, detail: 'Verkauf über die PC-Oberfläche' });
    return { ok: !!r.ok, error: r.error || (r.blockers && r.blockers.length ? r.blockers[0].msg : null) };
  }
  return { ok: false, error: 'Unbekannte Aktion' };
}

function startPanel(holder, { port, shutdown }) {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const server = http.createServer(async (req, res) => {
    try {
      if (!allowedHosts.has(String(req.headers.host || '').toLowerCase())) return send(res, 403, { ok: false, error: 'Nur lokal erreichbar' });
      const url = new URL(req.url, `http://localhost:${port}`);
      if (req.method === 'GET' && STATIC[url.pathname]) {
        const [file, type] = STATIC[url.pathname];
        return send(res, 200, fs.readFileSync(path.join(__dirname, file)), type);
      }
      if (req.method === 'GET' && url.pathname === '/api/status') return send(res, 200, statusOf(holder));
      if (req.method === 'GET' && url.pathname === '/api/backup') {
        const b = holder.core.exportBackup(), name = `smartlab-backup-pc-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        return send(res, 200, JSON.stringify(b), 'application/json; charset=utf-8', { 'Content-Disposition': `attachment; filename="${name}"` });
      }
      if (req.method === 'GET' && url.pathname === '/api/export') {
        const kind = url.searchParams.get('kind');
        if (!EXPORT_KINDS.has(kind)) return send(res, 400, { ok: false, error: 'Unbekannter Export' });
        const x = holder.core.exportData(kind);
        return send(res, 200, x.data, `${x.mime}; charset=utf-8`, { 'Content-Disposition': `attachment; filename="${x.name}"` });
      }
      if (req.method !== 'POST') return send(res, 404, { ok: false, error: 'Nicht gefunden' });
      if (req.headers['x-smartlab'] !== '1') return send(res, 403, { ok: false, error: 'Anfrage ohne Kennung abgelehnt' });
      const text = await readBody(req);
      if (url.pathname === '/api/action') { let b; try { b = JSON.parse(text); } catch (e) { return send(res, 400, { ok: false, error: 'Ungültige Anfrage' }); } return send(res, 200, await act(holder, b || {})); }
      if (url.pathname === '/api/settings') {
        const r = holder.core.importSettings(text);
        return send(res, 200, { ok: r.ok, errors: (r.errors || []).filter(e => !e.soft).map(e => e.msg).slice(0, 5) });
      }
      if (url.pathname === '/api/restore') {
        let obj; try { obj = JSON.parse(text); } catch (e) { return send(res, 400, { ok: false, error: 'Datei ist kein gültiges JSON' }); }
        const r = holder.core.restoreBackup(obj);
        if (!r.ok) return send(res, 200, r);
        await holder.reload();
        return send(res, 200, { ok: true });
      }
      if (url.pathname === '/api/shutdown') { send(res, 200, { ok: true }); setTimeout(shutdown, 100); return; }
      return send(res, 404, { ok: false, error: 'Nicht gefunden' });
    } catch (e) {
      try { holder.core.log.error('SYSTEM', 'Oberfläche: ' + e.message); } catch (x) { /* egal */ }
      if (!res.headersSent) send(res, 500, { ok: false, error: e.message });
    }
  });
  server.listen(port, '127.0.0.1');
  return server;
}

module.exports = { startPanel, statusOf };
