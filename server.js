import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS, validateSettings, analyze, summarize } from './lib/engine.js';
import { demoMarkets, demoResult, liveMarkets, liveResult } from './lib/feeds.js';
import { openPosition, settlePosition } from './lib/ledger.js';
const root = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || join(root, '.data');
mkdirSync(dataDir, { recursive: true });
const file = join(dataDir, 'state.json');
let state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { settings: { ...DEFAULT_SETTINGS }, positions: [], customTickers: [], demoOffset: 0 };
state.settings = validateSettings(state.settings);
state.customTickers ||= [];
state.demoOffset ||= 0;
function save() { writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 }); renameSync(`${file}.tmp`, file); }
let liveCache = { at: 0, markets: [] }, pendingLive;
const automation = { demo: { enabled: false, lastScan: null, error: null }, live: { enabled: false, lastScan: null, error: null } };
let scanning = false;
async function scan() {
  if (scanning) return;
  scanning = true;
  try {
    for (const mode of ['demo', 'live']) {
      if (!automation[mode].enabled) continue;
      try {
        await settle(mode);
        const markets = await getMarkets(mode);
        if (!automation[mode].enabled) continue;
        const now = Date.now() + (mode === 'demo' ? state.demoOffset : 0);
        for (const market of markets.sort((a, b) => (analyze(b, state.settings, now).edge ?? -100) - (analyze(a, state.settings, now).edge ?? -100))) {
          if (analyze(market, state.settings, now).state !== 'signal') continue;
          if (state.positions.some(p => p.mode === mode && p.ticker === market.ticker)) continue;
          try { state.positions.unshift(openPosition(market, state, mode, now)); save(); } catch { /* Entry gates and risk caps remain authoritative. */ }
        }
        automation[mode].lastScan = Date.now(); automation[mode].error = null;
      } catch (error) { automation[mode].error = error.message; }
    }
  } finally { scanning = false; }
}
setInterval(scan, 10000).unref();
async function getMarkets(mode) {
  if (mode === 'demo') return demoMarkets(Date.now() + state.demoOffset);
  if (Date.now() - liveCache.at < 10000) return liveCache.markets;
  if (!pendingLive) pendingLive = liveMarkets(state.customTickers).then(markets => { liveCache = { at: Date.now(), markets }; return markets; }).finally(() => { pendingLive = null; });
  return pendingLive;
}
async function settle(mode) {
  const now = Date.now() + (mode === 'demo' ? state.demoOffset : 0);
  let changed = false;
  for (let i = 0; i < state.positions.length; i++) {
    const p = state.positions[i];
    if (p.mode !== mode || p.status !== 'open' || p.closeTime > now) continue;
    let result;
    if (mode === 'demo') result = demoResult(p.ticker);
    else { try { result = await liveResult(p.ticker); } catch { continue; } }
    if (result) { state.positions[i] = settlePosition(p, result, now); changed = true; }
  }
  if (changed) save();
}
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 16000) throw new Error('Request too large.'); }
  return text ? JSON.parse(text) : {};
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const mode = url.searchParams.get('mode') || 'demo';
    if (!['demo', 'live'].includes(mode)) return json(res, 400, { error: 'Unknown data mode.' });
    if (req.method === 'POST') {
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: 'Cross-origin writes are not allowed.' });
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Expected JSON.' });
    }
    if (url.pathname === '/api/health') return json(res, 200, { status: 'ok', app: 'Chemical X', execution: 'paper-only' });
    if (url.pathname === '/api/snapshot' && req.method === 'GET') {
      await settle(mode);
      let markets = [], feedError = null;
      try { markets = await getMarkets(mode); } catch (error) { feedError = `Live data unavailable: ${error.message} Check access to api.elections.kalshi.com. No simulated data is substituted.`; }
      const now = Date.now() + (mode === 'demo' ? state.demoOffset : 0);
      return json(res, 200, { mode, now, feedError, automation: automation[mode], markets: markets.map(m => ({ ...m, signal: analyze(m, state.settings, now) })), settings: state.settings, customTickers: state.customTickers, positions: state.positions.filter(p => p.mode === mode), stats: summarize(state.positions, mode, state.settings.bankroll) });
    }
    if (url.pathname === '/api/automation' && req.method === 'POST') {
      const data = await body(req);
      if (typeof data.enabled !== 'boolean') throw new Error('Expected enabled boolean.');
      automation[mode].enabled = data.enabled;
      if (data.enabled) await scan();
      return json(res, 200, { automation: automation[mode] });
    }
    if (url.pathname === '/api/positions' && req.method === 'POST') {
      const data = await body(req);
      await settle(mode);
      const markets = await getMarkets(mode);
      const market = markets.find(m => m.ticker === data.ticker);
      if (!market) return json(res, 404, { error: 'Market is no longer available. Refresh the feed.' });
      const position = openPosition(market, state, mode, Date.now() + (mode === 'demo' ? state.demoOffset : 0));
      state.positions.unshift(position); save();
      return json(res, 201, { position });
    }
    if (url.pathname === '/api/settings' && req.method === 'POST') {
      const data = await body(req);
      const settings = validateSettings(data.settings);
      if (!Array.isArray(data.customTickers) || data.customTickers.length > 6 || data.customTickers.some(t => typeof t !== 'string' || !/^[A-Z0-9-]{3,100}$/.test(t))) throw new Error('Provide up to six valid Kalshi market tickers.');
      state.settings = settings; state.customTickers = [...new Set(data.customTickers)]; liveCache.at = 0; save();
      return json(res, 200, { saved: true });
    }
    if (url.pathname === '/api/demo/advance' && req.method === 'POST') {
      state.demoOffset += 900000; save(); await settle('demo');
      return json(res, 200, { advanced: true });
    }
    if (url.pathname === '/api/reset' && req.method === 'POST') {
      await body(req); automation[mode].enabled = false; state.positions = state.positions.filter(p => p.mode !== mode); save();
      return json(res, 200, { reset: true });
    }
    if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
    const routes = { '/': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css', '/favicon.svg': 'favicon.svg' };
    const path = routes[url.pathname];
    if (!path) return json(res, 404, { error: 'Not found.' });
    res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[extname(path)], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'" });
    res.end(readFileSync(join(root, 'public', path)));
  } catch (error) { json(res, 400, { error: error.message || 'Request failed.' }); }
});
const port = Number(process.env.PORT || 4317);
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is already occupied. Chemical X did not start or affect the existing service. Choose an unused PORT.`
    : `Chemical X could not start: ${error.message}`);
  process.exit(1);
});
server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Chemical X listening on port ${port} · paper execution only`));
