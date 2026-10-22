import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

test('HTTP workflow: snapshot → gated entry → duplicate rejection → settlement → persistence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chemical-x-test-'));
  await writeFile(join(dir, 'state.json'), JSON.stringify({ settings: {}, positions: [], customTickers: [], demoOffset: 1800000050000 - Date.now() }));
  let child;
  const port = 34000 + Math.floor(Math.random() * 10000);
  async function start() {
    child = spawn(process.execPath, ['server.js'], { cwd: new URL('..', import.meta.url), env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dir }, stdio: ['ignore','pipe','pipe'] });
    await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('Server exited during startup'); }), new Promise((_, reject) => { const timeout = setTimeout(() => reject(new Error('Startup timed out')), 5000); timeout.unref(); })]);
  }
  async function stop() { const done = once(child, 'exit'); child.kill(); await done; }
  async function request(path, data) {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : {});
    return { status: r.status, data: await r.json() };
  }
  try {
    await start();
    assert.equal((await request('/api/health')).data.execution, 'paper-only');
    let s = (await request('/api/snapshot')).data;
    assert.equal(s.markets.length, 6); assert.equal(s.stats.winRate, null);
    const market = s.markets.find(m => m.signal.state === 'signal');
    assert.ok(market, 'The fixed-time fixture has eligible signals');
    const entry = await request('/api/positions', { ticker: market.ticker }); assert.equal(entry.status, 201);
    assert.equal((await request('/api/positions', { ticker: market.ticker })).status, 400);
    await request('/api/demo/advance', {});
    s = (await request('/api/snapshot')).data;
    assert.equal(s.stats.settled, 1); assert.equal(s.positions[0].status, 'settled');
    await stop(); await start();
    assert.equal((await request('/api/snapshot')).data.stats.settled, 1);
    assert.equal((await request('/api/automation', { enabled: true })).data.automation.enabled, true);
    assert.ok((await request('/api/snapshot')).data.stats.open > 0);
    await request('/api/automation', { enabled: false });
    assert.equal((await request('/api/snapshot')).data.automation.enabled, false);
    assert.equal((await request('/api/settings', { settings: { maxEntry: -1 }, customTickers: [] })).status, 400);
    const crossOrigin = await fetch(`http://127.0.0.1:${port}/api/reset`, { method:'POST', headers: {'Content-Type':'application/json', Origin:'https://other.example'}, body:'{}' });
    assert.equal(crossOrigin.status, 403);
    await request('/api/reset', {}); assert.equal((await request('/api/snapshot')).data.positions.length, 0);
  } finally { if (child && child.exitCode === null) await stop(); await rm(dir, { recursive: true, force: true }); }
});
