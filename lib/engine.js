export const DEFAULT_SETTINGS = Object.freeze({ maxEntry: 63, idealEntry: 53, minEdge: 5, minScore: 68, minDepth: 100, maxSpread: 8, maxPosition: 25, maxExposure: 150, bankroll: 1000 });

export function validateSettings(input) {
  const ranges = { maxEntry: [1, 90], idealEntry: [1, 90], minEdge: [1, 30], minScore: [50, 95], minDepth: [10, 10000], maxSpread: [1, 25], maxPosition: [1, 1000], maxExposure: [1, 10000], bankroll: [100, 1000000] };
  const out = {};
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const value = input[key] ?? DEFAULT_SETTINGS[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${key}: expected ${min}–${max}.`);
    out[key] = value;
  }
  if (out.idealEntry > out.maxEntry) throw new Error('Ideal entry must be at or below the maximum entry.');
  if (out.maxPosition > out.maxExposure) throw new Error('Position limit must be at or below total exposure.');
  return out;
}
export function feeCents(price, contracts = 1) {
  return Math.ceil(0.07 * contracts * (price / 100) * (1 - price / 100) * 100 - 1e-9);
}
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const depth = levels => levels.reduce((sum, [price, quantity], i) => sum + quantity / (1 + i * 0.4), 0);

// A transparent research heuristic, not a fitted or calibrated probability model.
export function analyze(market, settings = DEFAULT_SETTINGS, now = Date.now()) {
  const yesDepth = depth(market.yesBids);
  const noDepth = depth(market.noBids);
  const imbalance = (yesDepth - noDepth) / Math.max(1, yesDepth + noDepth);
  const trades = market.trades.filter(t => t.time >= now - 60_000 && t.time <= now);
  const buy = trades.filter(t => t.side === 'yes').reduce((s, t) => s + t.count, 0);
  const sell = trades.filter(t => t.side === 'no').reduce((s, t) => s + t.count, 0);
  const delta = (buy - sell) / Math.max(1, buy + sell);
  const history = market.history;
  const drift = history.length > 1 ? clamp((history.at(-1).price - history.at(-10)?.price || 0) / 12, -1, 1) : 0;
  const score = clamp(50 + 26 * imbalance + 19 * delta + 7 * drift, 8, 92);
  const side = score >= 50 ? 'yes' : 'no';
  const confidence = side === 'yes' ? score : 100 - score;
  const entry = side === 'yes' ? market.yesAsk : market.noAsk;
  const bid = side === 'yes' ? market.yesBid : market.noBid;
  const spread = entry === null || bid === null ? null : Math.max(0, entry - bid);
  const fee = entry === null ? 0 : feeCents(entry);
  const edge = entry === null ? null : confidence - entry - fee;
  const secondsLeft = Math.max(0, Math.floor((market.closeTime - now) / 1000));
  const reasons = [];
  if (now - market.updatedAt > 15000) reasons.push('Stale feed');
  if (entry === null || bid === null || !market.yesBids.length || !market.noBids.length) reasons.push('Incomplete book');
  if (!Number.isFinite(market.closeTime)) reasons.push('Invalid settlement time');
  if (market.yesBid !== null && market.noBid !== null && market.yesBid + market.noBid > 100) reasons.push('Crossed book');
  if (market.status !== 'open') reasons.push('Market closed');
  if (secondsLeft < 30) reasons.push('Closing window');
  if (entry !== null && entry > settings.maxEntry) reasons.push('Entry above limit');
  if (confidence < settings.minScore) reasons.push('Weak signal');
  if (edge !== null && edge < settings.minEdge) reasons.push('Insufficient edge');
  if (Math.min(yesDepth, noDepth) < settings.minDepth) reasons.push('Thin liquidity');
  if (spread !== null && spread > settings.maxSpread) reasons.push('Wide spread');
  if (trades.length < 5) reasons.push('Insufficient trade flow');
  const state = reasons.length ? (confidence >= 60 ? 'watch' : 'neutral') : 'signal';
  return { side, confidence, entry, spread, fee, edge, imbalance, delta, drift, buy, sell, yesDepth, noDepth, secondsLeft, reasons, state, ideal: entry !== null && entry <= settings.idealEntry };
}

export function summarize(positions, mode, bankroll) {
  const all = positions.filter(p => p.mode === mode);
  const settled = all.filter(p => p.status === 'settled');
  const open = all.filter(p => p.status === 'open');
  const wins = settled.filter(p => p.result === p.side).length;
  const contracts = all.reduce((s, p) => s + p.contracts, 0);
  const cost = all.reduce((s, p) => s + p.entry * p.contracts / 100, 0);
  const pnl = settled.reduce((s, p) => s + p.pnl, 0);
  const exposure = open.reduce((s, p) => s + p.cost, 0);
  const winRate = settled.length ? wins / settled.length * 100 : null;
  const n = settled.length;
  let interval = null;
  if (n) {
    const p = wins / n, z = 1.96, denom = 1 + z * z / n;
    const center = (p + z * z / (2 * n)) / denom;
    const margin = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom;
    interval = [Math.max(0, center - margin) * 100, Math.min(1, center + margin) * 100];
  }
  return { trades: all.length, settled: n, wins, open: open.length, averageEntry: contracts ? cost * 100 / contracts : null, pnl, exposure, available: bankroll + pnl - exposure, winRate, interval };
}
