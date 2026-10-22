const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const num = (v, places = 1) => v === null || v === undefined ? '—' : Number(v).toFixed(places);
const money = v => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v || 0);
const signed = v => `${v >= 0 ? '+' : ''}${num(v)}`;
const compact = v => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
const names = { radar: 'Market radar', signals: 'Signal feed', portfolio: 'Paper portfolio', analytics: 'Performance', strategy: 'Strategy lab', settings: 'Configuration' };
let view = names[location.hash.slice(1)] ? location.hash.slice(1) : 'radar';
let mode = localStorage.getItem('chemical-x-mode') === 'live' ? 'live' : 'demo';
let snapshot = null, selected = null, filter = 'All markets', search = '', busy = false, paused = false, refreshSequence = 0;
let toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 5000); }
async function api(path, data) {
  const response = await fetch(`${path}${path.includes('?') ? '&' : '?'}mode=${mode}`, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
function chart(points, large = false) {
  const values = points.map(p => p.price).filter(Number.isFinite);
  if (values.length < 2) return `<svg class="${large ? 'chart' : 'spark'}" viewBox="0 0 280 100" role="img" aria-label="Waiting for price history"><text x="15" y="55" fill="#777" font-size="10">Waiting for trades</text></svg>`;
  const width = 280, height = 100, min = Math.min(...values) - 1.4, max = Math.max(...values) + 1.4;
  const line = values.map((v, i) => `${i * width / (values.length - 1)},${height - (v - min) / (max - min) * height}`).join(' ');
  return `<svg class="${large ? 'chart' : 'spark'}" viewBox="0 0 280 100" preserveAspectRatio="none" role="img" aria-label="${mode === 'demo' ? 'Simulated' : 'Observed'} YES price history">${large ? '<path d="M0 25H280M0 50H280M0 75H280M56 0V100M112 0V100M168 0V100M224 0V100" fill="none" stroke="#242424" stroke-width=".7"/><polygon points="0,100 '+line+' 280,100" fill="#ffffff06"/>' : ''}<polyline points="${line}" fill="none" stroke="${large ? '#ddd' : '#9a9a9a'}" stroke-width="${large ? 1.5 : 2.5}" vector-effect="non-scaling-stroke"/></svg>`;
}
function bar(value) { return `<svg class="imbalance-bar" viewBox="0 0 100 5" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="5" fill="#333"/><rect width="${Math.max(0, Math.min(100, value))}" height="5" fill="#c6c6c6"/></svg>`; }
function header(title, description, actions = '') {
  return `<div class="page-heading"><div><div class="eyebrow">THE SHORT-TERM ADVANTAGE</div><h1>${title}</h1><p>${description}</p></div><div class="heading-actions">${actions}<select class="feed-select" id="mode-select" aria-label="Market data source"><option value="demo" ${mode === 'demo' ? 'selected' : ''}>◉ Simulation</option><option value="live" ${mode === 'live' ? 'selected' : ''}>◉ Kalshi live</option></select></div></div>`;
}
function banner() {
  const bot = snapshot.automation, report = bot.report;
  const blockers = report?.blocked.flatMap(item => item.reasons) || [];
  const summary = [...new Set(blockers)].join(' · ');
  return `<div class="simulation-banner"><span>◈</span>${mode === 'demo' ? '<strong>SIMULATED FEED</strong> Synthetic prices & outcomes. Switch to Kalshi live for real market data.' : '<strong>LIVE KALSHI DATA / PAPER ORDERS</strong> Real prices; simulated positions. This app does not submit real-money orders.'}</div>
    ${bot.enabled ? `<div class="notice">${bot.error ? 'Paper bot waiting for data' : 'Paper bot scanning every 10 seconds'} · max ${money(snapshot.settings.maxExposure)} open exposure.
    ${report ? `<br>Last scan: ${report.scanned} markets · ${report.qualified} qualified · ${report.opened} paper positions opened.${summary ? `<br>Entry blockers: ${escape(summary)}` : ''}` : ''}
    ${bot.error ? '<br>' + escape(bot.error) : ''}</div>` : ''}
    ${snapshot.feedError ? `<div class="notice" role="alert">${escape(snapshot.feedError)} <button class="button small" id="retry-feed">Retry connection</button></div>` : ''}
    ${(snapshot.feedWarnings || []).map(w => `<div class="notice" role="status">${escape(w)}</div>`).join('')}`;
}
function metrics() {
  const s = snapshot.stats, signals = snapshot.markets.filter(m => m.signal.state === 'signal'), best = signals.length ? Math.max(...signals.map(m => m.signal.edge)) : null;
  return `<div class="metrics">
    <div class="metric"><div class="metric-label">Average buy-in <span class="metric-symbol">↘</span></div><div class="metric-value">${num(s.averageEntry)}<small>¢</small></div><div class="metric-bottom"><span class="tiny-tag">TARGET</span> ≤ ${snapshot.settings.idealEntry}¢ ideal · &lt; ${snapshot.settings.maxEntry}¢ limit</div></div>
    <div class="metric"><div class="metric-label">Realized win rate <span class="metric-symbol">◷</span></div><div class="metric-value">${num(s.winRate)}<small>%</small></div><div class="metric-bottom">${s.settled ? `<b>${s.wins}/${s.settled}</b> ${mode === 'demo' ? 'simulated' : 'paper'} settlements` : 'No settled positions yet'} · goal 68%+</div></div>
    <div class="metric"><div class="metric-label">Qualified signals <span class="metric-symbol">ϟ</span></div><div class="metric-value">${String(signals.length).padStart(2, '0')}<small>/ ${String(snapshot.markets.length).padStart(2, '0')} markets</small></div><div class="metric-bottom"><span class="status-dot"></span> ${signals.length ? 'Entry conditions met' : 'Waiting for an eligible setup'}</div></div>
    <div class="metric"><div class="metric-label">Best estimated edge <span class="metric-symbol">↗</span></div><div class="metric-value">${best === null ? '—' : '+' + num(best)}<small>¢</small></div><div class="metric-bottom">After est. fees <span class="tiny-tag">MODEL</span></div></div>
  </div>`;
}
function timer(seconds) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`; }
function marketCard(m) {
  const s = m.signal;
  return `<article class="market-card ${selected === m.ticker ? 'selected' : ''}"><div class="card-head"><span class="coin ${m.icon.length > 1 ? 'small-coin' : ''}">${escape(m.icon)}</span><div class="asset-name">${escape(m.asset)} <span>/ USD</span><small>${m.category === 'Crypto' ? 'CRYPTO' : 'FINANCIAL'} · ${m.synthetic || /15M/.test(m.ticker) ? '15 MIN' : 'CUSTOM'}</small></div><span class="signal-badge ${s.state}">${s.state === 'signal' ? 'ϟ SIGNAL' : s.state === 'watch' ? '◷ WATCH' : '• NEUTRAL'}</span></div>
  <div class="card-title" title="${escape(m.title)}">${escape(m.title)}</div><div class="card-numbers"><div class="entry-price">${num(s.entry, 0)}<small>¢</small><span class="side-tag">${s.side.toUpperCase()} ↗</span></div>${chart(m.history)}</div>
  <div class="card-stats"><div class="card-stat"><label>SIGNAL SCORE</label>${num(s.confidence)}<span>%</span></div><div class="card-stat"><label>EST. EDGE</label>${s.edge === null ? '—' : signed(s.edge)}¢</div><div class="card-stat"><label>VOLUME</label>${compact(m.volume)}</div></div>
  <div class="card-bottom"><span>◷ <span data-countdown="${m.closeTime}">${timer(s.secondsLeft)}</span> to close</span><button data-select="${escape(m.ticker)}" aria-label="Analyze ${escape(m.name)}">Analyze ↗</button></div></article>`;
}
function detail() {
  const m = snapshot.markets.find(m => m.ticker === selected);
  if (!m) return '<div class="empty"><div class="empty-icon">⌖</div><h3>No market selected</h3><p>Select a market to inspect order flow.</p></div>';
  const s = m.signal, hasPosition = snapshot.positions.some(p => p.ticker === m.ticker);
  return `<aside class="detail-panel" aria-label="Selected market analysis"><div class="detail-header"><div class="detail-header-top"><span class="detail-kicker">SIGNAL INSPECTOR</span><span class="tiny-tag">${m.synthetic ? 'SIMULATED' : 'KALSHI'}</span></div><h2>${escape(m.name)} <span class="side-tag">${m.synthetic || /15M/.test(m.ticker) ? '15M' : 'CUSTOM'}</span></h2><p>${escape(m.title)}</p></div><div class="detail-body"><div class="detail-price"><div><strong>${num(s.entry, 0)}</strong><small> ¢</small><span class="side-tag">${s.side.toUpperCase()}</span></div><div><label>ESTIMATED NET EDGE</label>${s.edge === null ? '—' : signed(s.edge)}¢ ↗</div></div>${chart(m.history, true)}<div class="chart-labels"><span>YES PRICE HISTORY</span><span>${m.synthetic ? 'SYNTHETIC' : 'RECENT TRADES'}</span></div>
  <div class="subheading">ORDER FLOW <span>LAST 60 SECONDS</span></div><div class="flow-line"><span>Book imbalance</span><b>${signed(s.imbalance * 100)}%</b></div>${bar((s.imbalance + 1) * 50)}<div class="flow-line"><span>Aggressor delta</span><b>${signed(s.delta * 100)}%</b></div>${bar((s.delta + 1) * 50)}<p class="flow-description">${s.buy.toLocaleString()} YES buys / ${s.sell.toLocaleString()} NO buys<br>${s.imbalance >= 0 ? 'YES' : 'NO'} depth leads · ${num(s.spread, 0)}¢ spread</p>
  <div class="subheading">DEPTH OF MARKET <span>TOP 4 LEVELS</span></div><table class="book-table"><thead><tr><th>YES BID</th><th>SIZE</th><th>NO BID</th><th>SIZE</th></tr></thead><tbody>${Array.from({ length: 4 }, (_, i) => `<tr><td>${num(m.yesBids[i]?.[0], 0)}¢</td><td>${m.yesBids[i] ? compact(m.yesBids[i][1]) : '—'}</td><td>${num(m.noBids[i]?.[0], 0)}¢</td><td>${m.noBids[i] ? compact(m.noBids[i][1]) : '—'}</td></tr>`).join('')}</tbody></table></div>
  <div class="detail-foot"><button class="button primary" data-trade="${escape(m.ticker)}" ${s.state !== 'signal' || hasPosition || busy ? 'disabled' : ''}>${hasPosition ? '✓ Position recorded' : `Paper buy ${s.side.toUpperCase()} · ${num(s.entry, 0)}¢`} <span>↗</span></button><p>${s.reasons.length ? escape(s.reasons.join(' · ')) : `Up to ${money(snapshot.settings.maxPosition)} · displayed depth capped · est. fees included`}</p><button class="rules-button" data-rules="${escape(m.ticker)}">Settlement rules & methodology ↗</button></div></aside>`;
}
function botButton() { return `<button class="button ${snapshot.automation.enabled ? '' : 'primary'}" id="bot-button" ${!snapshot.automation.enabled && (snapshot.feedError || !snapshot.markets.length) ? 'disabled title="Market data is required before starting the paper bot"' : ''}>${snapshot.automation.enabled ? '■ Stop paper bot' : 'ϟ Start paper bot'}</button>`; }
function renderRadar() {
  const markets = snapshot.markets.filter(m => (filter === 'All markets' || filter === 'Signals' && m.signal.state === 'signal' || m.category === filter) && `${m.asset} ${m.title}`.toLowerCase().includes(search.toLowerCase()));
  return header('Market radar', 'Read the flow. Find your edge. Get ahead of settlement.', botButton() + '<button class="button" id="pause-button">'+(paused ? '▶ Resume feed' : 'Ⅱ Pause feed')+'</button>') + banner() + metrics() + `<div class="section-bar"><div class="tabs" role="group" aria-label="Filter markets">${['All markets', 'Crypto', 'Financial', 'Signals'].map(f => `<button class="tab ${filter === f ? 'active' : ''}" data-filter="${f}">${f}${f === 'All markets' ? `<span>${snapshot.markets.length}</span>` : ''}</button>`).join('')}</div><div class="section-meta"><input class="search" id="search" type="search" placeholder="Search markets…" aria-label="Search markets" value="${escape(search)}"></div></div><div class="radar-layout"><div><div class="market-grid">${markets.map(marketCard).join('') || '<div class="empty"><div class="empty-icon">⌖</div><h3>No matching markets</h3><p>Adjust your filters or check the data connection.</p></div>'}</div><div class="note-strip"><span>⌁</span><span><b>CONVICTION, WITH CONSTRAINTS.</b> Entry ≤ ${snapshot.settings.maxEntry}¢ · net edge ≥ ${snapshot.settings.minEdge}¢ · score ≥ ${snapshot.settings.minScore}%. Scores are research estimates, not validated settlement probabilities.</span></div></div>${detail()}</div>`;
}
function renderSignals() {
  const markets = [...snapshot.markets].sort((a, b) => (b.signal.edge ?? -100) - (a.signal.edge ?? -100));
  return header('Signal feed', 'Every setup, ranked by estimated edge. Every entry gate visible.') + banner() + metrics() + `<div class="table-panel"><div class="panel-head"><h2>Opportunity queue</h2><span>${markets.length} MARKETS SCANNED</span></div><div class="table-scroll"><table class="data-table"><thead><tr><th>MARKET</th><th>SIDE / ENTRY</th><th>SCORE</th><th>NET EDGE</th><th>ENTRY GATES</th><th></th></tr></thead><tbody>${markets.map(m => `<tr><td><strong>${escape(m.asset)}</strong><small>${escape(m.ticker)}</small></td><td>${m.signal.side.toUpperCase()} / ${num(m.signal.entry, 0)}¢</td><td>${num(m.signal.confidence)}%</td><td>${signed(m.signal.edge)}¢</td><td>${m.signal.state === 'signal' ? '✓ Qualified' : escape(m.signal.reasons.join(' · '))}</td><td><button class="button small" data-inspect="${escape(m.ticker)}">Inspect ↗</button></td></tr>`).join('') || '<tr><td colspan="6">Waiting for market data.</td></tr>'}</tbody></table></div></div>`;
}
function renderPortfolio() {
  const s = snapshot.stats;
  return header('Paper portfolio', 'A persistent ledger. Real settlement discipline. Zero real orders.', botButton() + '<button class="button" id="export-button">↓ Export CSV</button>') + banner() + `<div class="metrics">${[['Paper balance', money(snapshot.settings.bankroll + s.pnl), 'Starting balance + realized P&L'], ['Open exposure', money(s.exposure), `${s.open} open positions`], ['Realized P&L', money(s.pnl), 'Includes estimated taker fees'], ['Available capital', money(s.available), 'After open exposure']].map(([label, value, note]) => `<div class="metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-bottom">${note}</div></div>`).join('')}</div><div class="table-panel"><div class="panel-head"><h2>Position ledger</h2><div>${mode === 'demo' ? '<button class="button small" id="advance-button">Advance simulation +15m ↗</button>' : '<span>Settles against official Kalshi results</span>'}</div></div>${snapshot.positions.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>CONTRACT</th><th>SIDE</th><th>ENTRY</th><th>QTY</th><th>COST + FEES</th><th>STATUS</th><th>NET P&L</th></tr></thead><tbody>${snapshot.positions.map(p => `<tr><td><strong>${escape(p.asset)}</strong><small>${escape(p.ticker)}</small></td><td>${p.side.toUpperCase()}</td><td>${num(p.entry, 0)}¢</td><td>${p.contracts}</td><td>${money(p.cost)}<small>${money(p.fees)} EST. FEES</small></td><td>${p.status === 'open' ? '◷ Open' : p.result === p.side ? '↗ Won' : '↘ Lost'}</td><td>${p.pnl === null ? '—' : money(p.pnl)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><div class="empty-icon">▤</div><h3>Your first edge starts here.</h3><p>Open an eligible market in the radar and place a paper position. Entries, fees, and outcomes will appear here.</p><button class="button" data-go="radar">Explore market radar ↗</button></div>'}</div><div class="note-strip">${mode === 'demo' ? 'Simulation outcomes are deterministic fixtures, independent of the signal score. Advance the clock to test settlement mechanics. They do not measure strategy performance.' : 'Paper fills assume execution at displayed ask, capped to displayed size; actual fills, latency and slippage can differ. Final results are recorded only after Kalshi reports a settled YES/NO outcome.'}</div>`;
}
function renderAnalytics() {
  const s = snapshot.stats;
  const settled = snapshot.positions.filter(p => p.status === 'settled').sort((a, b) => a.settledAt - b.settledAt);
  let total = 0;
  const curve = [{ price: 0 }, ...settled.map(p => ({ price: total += p.pnl }))];
  return header('Performance', 'Evidence over conviction. Track the outcomes that actually settled.') + banner() + metrics() + `<div class="grid-two"><div class="panel"><div class="panel-head"><h2>Cumulative paper P&L</h2><span>${mode.toUpperCase()} DATA</span></div><div class="panel-content">${settled.length ? chart(curve, true) : '<div class="empty"><div class="empty-icon">⌁</div><h3>No performance history yet</h3><p>Settled positions will build the equity curve.</p></div>'}<div class="factor-row"><span>Net realized P&L</span><b>${money(s.pnl)}</b></div><div class="factor-row"><span>Estimated fees, all positions</span><b>${money(snapshot.positions.reduce((sum, p) => sum + p.fees, 0))}</b></div></div></div><div class="panel"><div class="panel-head"><h2>Target scorecard</h2><span>UNVERIFIED TARGETS</span></div><div class="panel-content"><div class="factor-row"><span>Average entry / ideal</span><b>${num(s.averageEntry)}¢ / 53¢</b></div><div class="factor-row"><span>Win rate / baseline goal</span><b>${num(s.winRate)}% / 68%</b></div><div class="factor-row"><span>Stretch win rate</span><b>72%+</b></div><div class="factor-row"><span>Settled sample</span><b>${s.settled} positions</b></div><div class="factor-row"><span>95% Wilson interval</span><b>${s.interval ? `${num(s.interval[0])}–${num(s.interval[1])}%` : 'Awaiting outcomes'}</b></div><p class="analytics-note">${mode === 'demo' ? 'Synthetic settlements validate the software, not predictive accuracy.' : 'Paper results are observations, not a guarantee. Correlated positions and small samples limit statistical conclusions.'} The signal model has not been fitted or calibrated on historical data.</p></div></div></div>`;
}
function renderStrategy() {
  return header('Strategy lab', 'An inspectable order-flow engine. No black-box promises.') + banner() + `<div class="grid-two"><div class="panel"><div class="panel-head"><h2>01 / Directional conviction</h2><span>RESEARCH MODEL</span></div><div class="panel-content"><p>A bounded heuristic scores the YES side from weighted liquidity, aggressive taker flow, and recent price drift. The higher-scoring side is evaluated for entry.</p><div class="formula">YES score = clamp(<br> 50 + 26 × imbalance<br> + 19 × trade delta<br> + 7 × price drift, 8, 92)</div><div class="factor-row"><span>Book imbalance</span><b>(YES − NO) / total depth</b></div><div class="factor-row"><span>Trade delta / 60s</span><b>(YES − NO) / total buys</b></div><div class="factor-row"><span>Depth weighting</span><b>1 / (1 + level × 0.4)</b></div><p>This score is not a calibrated probability. Order-flow imbalance can reflect temporary liquidity and does not determine the official settlement reference.</p></div></div><div class="panel"><div class="panel-head"><h2>02 / Entry discipline</h2><span>ALL GATES REQUIRED</span></div><div class="panel-content">${[['Maximum entry', `${snapshot.settings.maxEntry}¢`], ['Ideal entry', `${snapshot.settings.idealEntry}¢`], ['Minimum estimated net edge', `${snapshot.settings.minEdge}¢`], ['Minimum signal score', `${snapshot.settings.minScore}%`], ['Maximum spread', `${snapshot.settings.maxSpread}¢`], ['Weighted depth / each side', `${snapshot.settings.minDepth} contracts`], ['Minimum recent trades', '5 in 60 seconds'], ['Feed age / closing cutoff', '≤ 15s / ≥ 30s']].map(([label, value]) => `<div class="factor-row"><span>${label}</span><b>${value}</b></div>`).join('')}<button class="button" data-go="settings">Tune risk parameters ↗</button></div></div><div class="panel"><div class="panel-head"><h2>03 / Costs & execution</h2></div><div class="panel-content"><p>Estimated taker fees use ceil(0.07 × contracts × p × (1 − p) × 100) cents. Edge uses a conservative one-contract fee. Position sizing includes the rounded batch fee and is capped by balance, exposure, position limit, and displayed ask depth.</p><p>Fees are estimates; market-specific schedules may differ. Paper execution does not model queue priority, price impact, or the delay between observation and fill.</p></div></div><div class="panel"><div class="panel-head"><h2>04 / Path to validation</h2></div><div class="panel-content"><p>Collect timestamped books, trade prints, settlement reference prices, and final outcomes per contract. Evaluate separately by market and time-to-close using chronological held-out samples, then calibrate probabilities and account for fees and slippage.</p><p>Current limitations: polled books, no authenticated stream, no external reference-price model, no historical backtest, and no live order submission. Financial tickers require explicit configuration and contract-specific rule review.</p></div></div></div>`;
}
const fields = [['maxEntry','Maximum entry (¢)','Hard limit per contract, before fees.'],['idealEntry','Ideal entry (¢)','Preferred entry target.'],['minScore','Minimum signal score (%)','Uncalibrated model gate, not a win-rate guarantee.'],['minEdge','Minimum estimated edge (¢)','After estimated one-contract fees.'],['minDepth','Minimum weighted depth','Required on both sides of the book.'],['maxSpread','Maximum spread (¢)','Reject wider or illiquid quotes.'],['maxPosition','Maximum position ($)','Includes estimated fees.'],['maxExposure','Maximum total exposure ($)','Across open positions in this data mode.'],['bankroll','Initial paper balance ($)','Used to calculate available paper capital.']];
function renderSettings() {
  return header('Configuration', 'Set your constraints. The engine only acts inside them.') + `<form id="settings-form"><div class="grid-two"><div class="panel"><div class="panel-head"><h2>Signal & risk parameters</h2><span>PAPER EXECUTION</span></div><div class="panel-content"><div class="form-grid">${fields.map(([key, label, hint]) => `<div class="field"><label for="${key}">${label}</label><input id="${key}" name="${key}" type="number" step="1" required value="${snapshot.settings[key]}"><small>${hint}</small></div>`).join('')}</div></div></div><div><div class="panel"><div class="panel-head"><h2>Market data connections</h2><span>PUBLIC READ ONLY</span></div><div class="panel-content"><div class="factor-row"><span>Default crypto series</span><b>BTC / ETH / SOL 15M</b></div><p>Live mode discovers KXBTC15M, KXETH15M and KXSOL15M contracts. Add specific financial or other market tickers below. Their actual settlement horizon and rules apply.</p><div class="field"><label for="custom-tickers">Additional Kalshi tickers</label><input id="custom-tickers" placeholder="Comma-separated market tickers" value="${escape(snapshot.customTickers.join(', '))}"><small>Up to six exact market tickers. Requires access to api.elections.kalshi.com. No credentials are required by this public connector.</small></div><p>The simulation uses synthetic crypto and financial fixtures. Its financial contracts are examples, not a claim that matching Kalshi products exist.</p></div></div><div class="panel spaced-panel"><div class="panel-head"><h2>Paper ledger</h2></div><div class="panel-content"><p>Settings and paper positions persist locally in this workspace. Simulation and live-data paper ledgers are kept separate.</p><button type="button" class="button" id="reset-button">Reset ${mode === 'demo' ? 'simulation' : 'live-data paper'} ledger</button></div></div></div></div><div class="form-actions"><button type="submit" class="button primary">Save configuration ↗</button><button type="button" class="button" id="defaults-button">Restore default parameters</button></div></form>`;
}
function render() {
  $('#breadcrumb').textContent = names[view];
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (!snapshot) { $('#main').innerHTML = '<div class="loading">INITIALIZING CHEMICAL X…</div>'; return; }
  if (!snapshot.markets.some(m => m.ticker === selected)) selected = snapshot.markets[0]?.ticker;
  $('#nav-count').textContent = String(snapshot.markets.length).padStart(2, '0');
  const renderer = { radar: renderRadar, signals: renderSignals, portfolio: renderPortfolio, analytics: renderAnalytics, strategy: renderStrategy, settings: renderSettings }[view];
  $('#main').innerHTML = renderer();
}
async function refresh(force = false) {
  if (paused && !force) return;
  const sequence = ++refreshSequence;
  try {
    const data = await api('/api/snapshot');
    if (sequence !== refreshSequence) return;
    snapshot = data;
    lastClientTime = Date.now();
    $('#feed-status').textContent = data.feedError ? 'Live feed disconnected' : mode === 'demo' ? 'Simulation engine connected' : data.feedWarnings?.length ? 'Kalshi feed connected · check warnings' : 'Kalshi public feed connected';
    $('#updated').textContent = `SYNC ${new Date().toLocaleTimeString('en-GB', { timeZone: 'UTC' })} UTC`;
    if (view !== 'settings' || force) {
      const input = document.activeElement?.id === 'search';
      const position = input ? $('#search').selectionStart : 0;
      render();
      if (input) { $('#search')?.focus(); try { $('#search')?.setSelectionRange(position, position); } catch {} }
    }
  } catch (error) { $('#feed-status').textContent = 'Server disconnected'; toast(error.message); }
}
function navigate(next) { view = next; location.hash = next; render(); }
function modal(title, text) { $('#modal-content').innerHTML = `<h2>${escape(title)}</h2><p>${escape(text)}</p>`; $('#modal').showModal(); }
async function trade(ticker) {
  if (busy) return;
  if (paused) return toast('Resume the feed before opening a paper position.');
  busy = true; render();
  try { const { position } = await api('/api/positions', { ticker }); toast(`Paper position opened: ${position.contracts} ${position.side.toUpperCase()} at ${position.entry}¢. ${money(position.cost)} including estimated fees.`); }
  catch (error) { toast(error.message); }
  finally { busy = false; await refresh(true); }
}
function exportCSV() {
  const cols = ['ticker','mode','side','entry','contracts','fees','cost','score','status','result','pnl','openedAt','settledAt'];
  const csv = [cols.join(','), ...snapshot.positions.map(p => cols.map(c => `"${String(p[c] ?? '').replaceAll('"', '""')}"`).join(','))].join('\n');
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = `chemical-x-${mode}-ledger.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); toast('Paper ledger exported.');
}
document.addEventListener('click', async event => {
  const el = event.target.closest('button, a'); if (!el) return;
  if (el.dataset.view || el.dataset.go) return navigate(el.dataset.view || el.dataset.go);
  if (el.dataset.filter) { filter = el.dataset.filter; return render(); }
  if (el.dataset.select) { selected = el.dataset.select; return render(); }
  if (el.dataset.inspect) { selected = el.dataset.inspect; return navigate('radar'); }
  if (el.dataset.trade) return trade(el.dataset.trade);
  if (el.dataset.rules) { const m = snapshot.markets.find(m => m.ticker === el.dataset.rules); return modal(`${m.name} · Settlement rules`, `${m.rule}\n\nSignal score: heuristic only. Entry edge assumes this score behaves like a probability; that assumption has not been validated. Paper fills are capped to displayed depth and use estimated fees.`); }
  if (el.id === 'modal-close') return $('#modal').close();
  if (el.id === 'help-button') return modal('Chemical X / Research terminal', 'Order flow. Entry discipline. Measured outcomes.\n\nChemical X is an original paper-trading research application. Its 68–72% win-rate and 53–63¢ entry targets are goals, not proven results. The order-flow score is an uncalibrated heuristic.\n\nSimulation is fully synthetic. Live mode uses public Kalshi data and never falls back to simulated prices. All orders are paper-only. See Strategy lab for the model, costs, and limitations.');
  if (el.id === 'pause-button') { paused = !paused; render(); $('#feed-status').textContent = paused ? 'Display paused · automation unchanged' : 'Reconnecting'; if (!paused) await refresh(true); }
  if (el.id === 'bot-button') { try { const enabled = !snapshot.automation.enabled; await api('/api/automation', { enabled }); await refresh(true); toast(enabled ? (snapshot.automation.error ? 'Paper bot is waiting for market data. See the connection error above.' : 'Paper bot started. See the latest scan and entry blockers above.') : 'Paper bot stopped. Existing positions remain in the ledger.'); } catch (error) { toast(error.message); } }
  if (el.id === 'retry-feed') { paused = false; await refresh(true); }
  if (el.id === 'export-button') exportCSV();
  if (el.id === 'advance-button') { try { await api('/api/demo/advance', {}); await refresh(true); toast('Simulation advanced 15 minutes. Eligible paper positions settled.'); } catch (error) { toast(error.message); } }
  if (el.id === 'reset-button') { if (confirm(`Delete all ${mode} paper positions? This cannot be undone.`)) { try { await api('/api/reset', {}); await refresh(true); toast('Paper ledger reset.'); } catch (error) { toast(error.message); } } }
  if (el.id === 'defaults-button') { const defaults = { maxEntry:63,idealEntry:53,minEdge:5,minScore:68,minDepth:100,maxSpread:8,maxPosition:25,maxExposure:150,bankroll:1000 }; fields.forEach(([key]) => { $(`#${key}`).value = defaults[key]; }); toast('Defaults loaded. Save configuration to apply.'); }
});
document.addEventListener('change', async event => {
  if (event.target.id === 'mode-select') { mode = event.target.value; localStorage.setItem('chemical-x-mode', mode); snapshot = null; selected = null; paused = false; render(); await refresh(true); }
});
document.addEventListener('input', event => { if (event.target.id === 'search') { search = event.target.value; const position = event.target.selectionStart; render(); $('#search').focus(); try { $('#search').setSelectionRange(position, position); } catch {} } });
document.addEventListener('submit', async event => {
  if (event.target.id !== 'settings-form') return;
  event.preventDefault();
  const settings = Object.fromEntries(fields.map(([key]) => [key, Number($(`#${key}`).value)]));
  const customTickers = $('#custom-tickers').value.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
  try { await api('/api/settings', { settings, customTickers }); await refresh(true); toast('Configuration saved. Entry gates updated.'); } catch (error) { toast(error.message); }
});
window.addEventListener('hashchange', () => { const next = location.hash.slice(1); if (names[next] && next !== view) { view = next; render(); } });
setInterval(() => {
  $('#clock').textContent = `${new Date().toLocaleTimeString('en-GB', { timeZone: 'UTC' })} UTC`;
  if (snapshot && !paused) document.querySelectorAll('[data-countdown]').forEach(el => { const now = Date.now() + (snapshot.now - lastClientTime); el.textContent = timer(Math.max(0, Math.floor((Number(el.dataset.countdown) - now) / 1000))); });
}, 1000);
let lastClientTime = Date.now();
render(); await refresh(true);
setInterval(() => refresh(), 10000);
