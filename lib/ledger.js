import { analyze, feeCents, summarize } from './engine.js';
import { randomUUID } from 'node:crypto';
export function openPosition(market, state, mode, now = Date.now()) {
  const signal = analyze(market, state.settings, now);
  if (signal.state !== 'signal') throw new Error(`Entry blocked: ${signal.reasons.join(', ')}.`);
  if (state.positions.some(p => p.ticker === market.ticker && p.mode === mode)) throw new Error('A paper position already exists for this contract.');
  const stats = summarize(state.positions, mode, state.settings.bankroll);
  const budget = Math.min(state.settings.maxPosition, state.settings.maxExposure - stats.exposure, stats.available);
  const availableDepth = signal.side === 'yes' ? market.noBids[0]?.[1] : market.yesBids[0]?.[1];
  let contracts = Math.min(Math.floor(budget * 100 / signal.entry), Math.floor(availableDepth || 0));
  while (contracts > 0 && (contracts * signal.entry + feeCents(signal.entry, contracts)) / 100 > budget) contracts--;
  if (contracts < 1) throw new Error('Insufficient available balance, exposure allowance, or displayed depth.');
  const fees = feeCents(signal.entry, contracts) / 100;
  return { id: randomUUID(), ticker: market.ticker, asset: market.asset, title: market.title, mode, side: signal.side, entry: signal.entry, contracts, fees, cost: contracts * signal.entry / 100 + fees, score: signal.confidence, edge: signal.edge, openedAt: now, closeTime: market.closeTime, status: 'open', result: null, pnl: null };
}
export function settlePosition(position, result, now = Date.now()) {
  if (position.status !== 'open' || !['yes', 'no'].includes(result)) return position;
  return { ...position, status: 'settled', result, settledAt: now, pnl: Number(((position.side === result ? position.contracts : 0) - position.cost).toFixed(2)) };
}
