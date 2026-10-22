import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, DEFAULT_SETTINGS, feeCents, summarize, validateSettings } from '../lib/engine.js';
import { demoMarkets, normalizeMarket, demoResult } from '../lib/feeds.js';
import { openPosition, settlePosition } from '../lib/ledger.js';
const now = 1800000050000;
function market() { return demoMarkets(now)[0]; }
function state(settings = {}) { return { settings: { ...DEFAULT_SETTINGS, ...settings }, positions: [] }; }

test('dominant YES book and aggressive flow select YES; mirrored book selects NO', () => {
  const m = market(), s = analyze(m, DEFAULT_SETTINGS, now);
  assert.equal(s.side, 'yes'); assert.equal(s.state, 'signal'); assert.ok(s.confidence > 68); assert.ok(s.edge > 5);
  const mirror = { ...m, yesBids: m.noBids, noBids: m.yesBids, yesBid: m.noBid, noBid: m.yesBid, yesAsk: m.noAsk, noAsk: m.yesAsk, trades: m.trades.map(t => ({ ...t, side: t.side === 'yes' ? 'no' : 'yes', price: 100 - t.price })), history: m.history.map(t => ({ ...t, price: 100 - t.price })) };
  const n = analyze(mirror, DEFAULT_SETTINGS, now);
  assert.equal(n.side, 'no'); assert.ok(Math.abs(n.confidence - s.confidence) < 0.001);
});
test('all trade windows exclude stale and future trades', () => {
  const m = market();
  m.trades = [{ side: 'yes', count: 1000, time: now - 61000 }, { side: 'yes', count: 1000, time: now + 1 }];
  const s = analyze(m, DEFAULT_SETTINGS, now);
  assert.equal(s.delta, 0); assert.ok(s.reasons.includes('Insufficient trade flow'));
});
test('stale, closing, expensive, wide, and incomplete markets cannot qualify', () => {
  const cases = [
    [{ updatedAt: now - 16000 }, 'Stale feed'],
    [{ closeTime: now + 29000 }, 'Closing window'],
    [{ closeTime: NaN }, 'Invalid settlement time'],
    [{ yesAsk: 90 }, 'Entry above limit'],
    [{ yesAsk: 62, yesBid: 20 }, 'Wide spread'],
    [{ yesBids: [] }, 'Incomplete book'],
    [{ status: 'settled' }, 'Market closed'],
    [{ yesBid: 70, noBid: 70 }, 'Crossed book']
  ];
  for (const [patch, reason] of cases) {
    const s = analyze({ ...market(), ...patch }, DEFAULT_SETTINGS, now);
    assert.ok(s.reasons.includes(reason), reason); assert.notEqual(s.state, 'signal');
  }
});
test('fee rounds up at the batch level; sizing includes fees and depth caps', () => {
  assert.equal(feeCents(50), 2); assert.equal(feeCents(50, 100), 175);
  const s = state(); const m = market(); m.noBids[0][1] = 12;
  const p = openPosition(m, s, 'demo', now);
  assert.ok(p.contracts <= 12); assert.ok(p.cost <= 25); assert.ok(p.fees > 0);
  assert.equal(p.cost, p.contracts * p.entry / 100 + p.fees);
});
test('exposure, duplicate-contract and signal gates are enforced at entry', () => {
  const m = market(), s = state();
  const p = openPosition(m, s, 'demo', now); s.positions.push(p);
  assert.throws(() => openPosition(m, s, 'demo', now), /already exists/);
  const exhausted = state({ maxExposure: 1, maxPosition: 1 });
  exhausted.positions.push({ ...p, ticker: 'OTHER', cost: 1 });
  assert.throws(() => openPosition(m, exhausted, 'demo', now), /Insufficient/);
  assert.throws(() => openPosition({ ...m, updatedAt: now - 20000 }, state(), 'demo', now), /Stale/);
});
test('settlement payout includes acquisition cost and fees; settled positions are immutable', () => {
  const p = openPosition(market(), state(), 'demo', now);
  const won = settlePosition(p, p.side, now + 900000);
  assert.equal(won.pnl, Number((p.contracts - p.cost).toFixed(2)));
  const lost = settlePosition(p, p.side === 'yes' ? 'no' : 'yes');
  assert.equal(lost.pnl, Number((-p.cost).toFixed(2)));
  assert.deepEqual(settlePosition(won, 'no'), won);
});
test('realized metrics do not invent wins, and live/demo ledgers remain separate', () => {
  const p = openPosition(market(), state(), 'demo', now);
  assert.equal(summarize([p], 'demo', 1000).winRate, null);
  const won = settlePosition(p, p.side);
  const stats = summarize([won], 'demo', 1000);
  assert.equal(stats.winRate, 100); assert.equal(stats.averageEntry, p.entry); assert.ok(stats.interval[0] < 100);
  assert.equal(summarize([won], 'live', 1000).trades, 0);
});
test('settings reject invalid values and contradictory risk limits', () => {
  assert.throws(() => validateSettings({ maxEntry: NaN }), /Invalid/);
  assert.throws(() => validateSettings({ idealEntry: 70, maxEntry: 63 }), /Ideal entry/);
  assert.throws(() => validateSettings({ maxPosition: 200, maxExposure: 100 }), /Position limit/);
  assert.deepEqual(validateSettings({}), DEFAULT_SETTINGS);
});
test('Kalshi fixed-point and legacy books normalize to complementary executable asks', () => {
  const m = { ticker: 'KXBTC15M-TEST', title: 'BTC test', status: 'active', close_time: new Date(now + 900000).toISOString() };
  const result = normalizeMarket(m, { orderbook_fp: { yes_dollars: [['0.48', '20.00'], ['0.50', '30']], no_dollars: [['0.47', '40']] } }, { trades: [{ created_time: new Date(now).toISOString(), taker_side: 'yes', count_fp: '4.00', yes_price_dollars: '0.53' }] }, now);
  assert.equal(result.yesBid, 50); assert.equal(result.yesAsk, 53); assert.equal(result.noAsk, 50); assert.equal(result.trades[0].price, 53); assert.equal(result.trades[0].count, 4);
  const legacy = normalizeMarket(m, { orderbook: { yes: [[48, 20]], no: [[49, 25]] } }, { trades: [] }, now);
  assert.equal(legacy.yesAsk, 51);
  const empty = normalizeMarket(m, {}, {}, now); assert.equal(empty.yesAsk, null);
});
test('synthetic markets roll at 15-minute boundaries and outcome is repeatable', () => {
  const m = market(), next = demoMarkets(now + 900000)[0];
  assert.notEqual(m.ticker, next.ticker); assert.equal(next.closeTime - m.closeTime, 900000);
  assert.equal(demoResult(m.ticker), demoResult(m.ticker)); assert.ok(['yes','no'].includes(demoResult(m.ticker)));
});
