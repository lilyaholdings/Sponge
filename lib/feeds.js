const ASSETS = [
  { asset: 'BTC', name: 'Bitcoin', category: 'Crypto', base: 97450, strike: '$97,450', icon: '₿' },
  { asset: 'ETH', name: 'Ethereum', category: 'Crypto', base: 2730, strike: '$2,730', icon: 'Ξ' },
  { asset: 'SOL', name: 'Solana', category: 'Crypto', base: 186.5, strike: '$186.50', icon: '◎' },
  { asset: 'SPX', name: 'S&P 500', category: 'Financial', base: 6025, strike: '6,025', icon: 'S' },
  { asset: 'NDX', name: 'Nasdaq 100', category: 'Financial', base: 21500, strike: '21,500', icon: 'N' },
  { asset: 'GOLD', name: 'Gold', category: 'Financial', base: 2910, strike: '$2,910', icon: 'Au' }
];
function wave(i, t) { return Math.sin(t / 27 + i * 1.4) * 1.8 + Math.sin(t / 11 + i) * 0.8; }
export function demoMarkets(now = Date.now()) {
  const period = Math.floor(now / 900000), closeTime = (period + 1) * 900000, t = now / 1000;
  return ASSETS.map((a, i) => {
    const positive = i % 2 === 0;
    const mid = Math.round(50 + wave(i, t) + (i === 3 ? 12 : 0));
    const yesBid = mid - 2, noBid = 100 - mid - 2;
    const strong = i < 3;
    const yesQuantity = positive ? (strong ? 880 : 420) : 170;
    const noQuantity = positive ? 180 : (strong ? 850 : 400);
    const yesBids = Array.from({ length: 7 }, (_, j) => [yesBid - j, Math.round(yesQuantity / (1 + j * 0.3) + 30 * Math.sin(t / 13 + j))]);
    const noBids = Array.from({ length: 7 }, (_, j) => [noBid - j, Math.round(noQuantity / (1 + j * 0.3) + 25 * Math.cos(t / 17 + j))]);
    const trades = Array.from({ length: 30 }, (_, j) => ({ time: now - j * 1900, side: (j % 7 < (strong ? 6 : 4)) === positive ? 'yes' : 'no', count: 18 + ((j * 17 + i * 13) % 140), price: mid }));
    const history = Array.from({ length: 90 }, (_, j) => ({ time: now - (89 - j) * 10000, price: 50 + wave(i, t - (89 - j) * 10) + (i === 3 ? 12 : 0) }));
    return { ...a, ticker: `DEMO-${a.asset}-${period}`, title: `${a.name} above ${a.strike}`, subtitle: '15-minute settlement · synthetic fixture', status: 'open', closeTime, updatedAt: now, yesBid, noBid, yesAsk: 100 - noBid, noAsk: 100 - yesBid, yesBids, noBids, trades, history, volume: 21450 + i * 8734 + Math.floor((now % 900000) / 1000) * 13, synthetic: true, rule: 'Simulation only. Settlement uses a deterministic synthetic outcome at the end of this 15-minute window. This is not a real contract, price, or performance backtest.' };
  });
}
export function demoResult(ticker) {
  const parts = ticker.split('-');
  const i = ASSETS.findIndex(a => a.asset === parts[1]);
  return Math.sin(Number(parts[2]) * 2.41 + i * 1.7) >= 0 ? 'yes' : 'no';
}
const API = 'https://api.elections.kalshi.com/trade-api/v2';
async function request(path, fetcher = fetch) {
  let response;
  try { response = await fetcher(`${API}${path}`, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } }); }
  catch (error) {
    const code = error.cause?.code || error.code || error.name;
    throw new Error(`Kalshi connection failed (${code}) at ${path}. Check this computer's network, proxy, and TLS configuration.`);
  }
  if (!response.ok) {
    const hint = response.status === 429 ? 'Request rate limited; retry after the next scan.' : response.status === 401 || response.status === 403 ? 'Access was denied by Kalshi or the network proxy.' : 'The requested market endpoint is unavailable.';
    throw new Error(`Kalshi HTTP ${response.status} at ${path}. ${hint}`);
  }
  return response.json();
}
const cents = value => value === undefined || value === null || value === '' ? null : Math.round(Number(value) * 100);
const levels = (fp, legacy) => (fp ? fp.map(([p, q]) => [cents(p), Number(q)]) : (legacy || []).map(([p, q]) => [Number(p), Number(q)])).filter(([p, q]) => Number.isFinite(p) && p > 0 && p < 100 && Number.isFinite(q) && q > 0).sort((a, b) => b[0] - a[0]);
export function normalizeMarket(m, book, tradeData, now = Date.now()) {
  const ob = book.orderbook_fp || book.orderbook || {};
  const yesBids = levels(ob.yes_dollars, ob.yes), noBids = levels(ob.no_dollars, ob.no);
  const yesBid = yesBids[0]?.[0] ?? null, noBid = noBids[0]?.[0] ?? null;
  const asset = /BTC/.test(m.ticker) ? 'BTC' : /ETH/.test(m.ticker) ? 'ETH' : /SOL/.test(m.ticker) ? 'SOL' : m.ticker.split('-')[0];
  const trades = (tradeData.trades || []).map(t => ({ time: Date.parse(t.created_time), side: t.taker_side, count: Number(t.count_fp ?? t.count), price: cents(t.yes_price_dollars) ?? Number(t.yes_price) })).filter(t => ['yes', 'no'].includes(t.side) && Number.isFinite(t.count) && Number.isFinite(t.price) && Number.isFinite(t.time));
  return { ticker: m.ticker, asset, name: ASSETS.find(a => a.asset === asset)?.name || asset, category: ['BTC', 'ETH', 'SOL'].includes(asset) ? 'Crypto' : 'Financial', icon: ASSETS.find(a => a.asset === asset)?.icon || '↗', title: m.title, subtitle: m.subtitle || m.yes_sub_title || 'Kalshi contract', status: ['active', 'open'].includes(m.status) ? 'open' : m.status, closeTime: Date.parse(m.close_time), updatedAt: now, yesBid, noBid, yesAsk: noBid === null ? null : 100 - noBid, noAsk: yesBid === null ? null : 100 - yesBid, yesBids, noBids, trades, history: [...trades].sort((a, b) => a.time - b.time).map(t => ({ time: t.time, price: t.price })), volume: Number(m.volume_fp ?? m.volume ?? 0), synthetic: false, rule: [m.rules_primary, m.rules_secondary].filter(Boolean).join('\n\n') || 'Review the contract settlement rules on Kalshi before relying on this market.', strike: m.yes_sub_title || '' };
}
export async function liveMarkets(customTickers = [], fetcher = fetch) {
  const sources = [
    ...['KXBTC15M', 'KXETH15M', 'KXSOL15M'].map(series => ({
      label: series,
      load: async () => {
        const data = await request(`/markets?status=open&series_ticker=${series}&limit=10`, fetcher);
        return (data.markets || []).sort((a, b) => Date.parse(a.close_time) - Date.parse(b.close_time)).slice(0, 2);
      }
    })),
    ...customTickers.map(ticker => ({ label: ticker, load: async () => [(await request(`/markets/${encodeURIComponent(ticker)}`, fetcher)).market].filter(Boolean) }))
  ];
  const results = await Promise.allSettled(sources.map(source => source.load()));
  const warnings = [], found = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') found.push(...result.value);
    else warnings.push(`${sources[i].label}: ${result.reason.message}`);
  });
  if (results.every(result => result.status === 'rejected')) throw new Error(warnings.join(' '));
  const unique = [...new Map(found.map(m => [m.ticker, m])).values()];
  const markets = [];
  // Limit bursts when several custom financial contracts are configured.
  for (let i = 0; i < unique.length; i += 2) {
    const batch = unique.slice(i, i + 2);
    const loaded = await Promise.allSettled(batch.map(async m => {
      const [book, trades] = await Promise.all([
        request(`/markets/${encodeURIComponent(m.ticker)}/orderbook?depth=10`, fetcher),
        request(`/markets/trades?ticker=${encodeURIComponent(m.ticker)}&limit=100`, fetcher)
      ]);
      return normalizeMarket(m, book, trades);
    }));
    loaded.forEach((result, j) => {
      if (result.status === 'fulfilled') markets.push(result.value);
      else warnings.push(`${batch[j].ticker}: ${result.reason.message}`);
    });
  }
  if (unique.length && !markets.length) throw new Error(warnings.join(' '));
  if (!unique.length) warnings.push('No open contracts were returned for the configured series. The feed is reachable; no paper entries can be placed until a contract is available.');
  return { markets, warnings };
}
export async function liveResult(ticker) {
  const { market } = await request(`/markets/${encodeURIComponent(ticker)}`);
  return market.status === 'settled' && ['yes', 'no'].includes(market.result) ? market.result : null;
}
