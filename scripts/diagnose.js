import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { runtimeError } from './runtime.js';
const root = fileURLToPath(new URL('../', import.meta.url));
console.log(`Chemical X diagnostics | ${process.platform} | Node ${process.version}`);
const error = runtimeError(process.version);
if (error) { console.error(`FAIL: ${error}`); process.exit(1); }
for (const file of ['server.js','public/index.html','public/app.js','lib/engine.js']) {
  if (!existsSync(new URL(`../${file}`, import.meta.url))) { console.error(`FAIL: ${file} is missing. Extract the complete ZIP first.`); process.exit(1); }
}
console.log('PASS: required runtime and application files.');
const port = Number(process.env.PORT || 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535) { console.error('FAIL: invalid PORT.'); process.exit(1); }
const probe = net.createServer();
const available = await new Promise(resolve => {
  probe.once('error', () => resolve(false));
  probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
});
if (!available) { console.error(`FAIL: port ${port} is occupied. No existing process was stopped. Close a previous Chemical X terminal or select an unused PORT.`); process.exit(1); }
console.log(`PASS: port ${port} is available.`);
const child = spawn(process.execPath, ['scripts/launch.js','--no-browser'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) }, stdio: ['ignore','pipe','pipe'] });
child.stderr.on('data', chunk => process.stderr.write(chunk));
try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Startup timed out after 10 seconds.')), 10000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('exit', code => { clearTimeout(timeout); reject(new Error(`Launcher exited with code ${code}.`)); });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.includes('Chemical X listening')) { clearTimeout(timeout); resolve(); } });
  });
  const base = `http://127.0.0.1:${port}`;
  const health = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) }).then(r => r.json());
  if (health.app !== 'Chemical X') throw new Error('Unexpected service answered the health check.');
  const snapshot = await fetch(`${base}/api/snapshot?mode=demo`, { signal: AbortSignal.timeout(5000) }).then(r => r.json());
  if (snapshot.markets?.length !== 6) throw new Error(snapshot.error || 'Dashboard API did not return six simulation markets.');
  console.log('PASS: server starts and dashboard API returns six simulation markets.');
  console.log('Local startup passed. Run npm run launch and keep that terminal open. Live Kalshi access and predictive performance are separate checks.');
} catch (error) { console.error(`FAIL: ${error.message}`); process.exitCode = 1; }
finally {
  if (child.exitCode === null && child.signalCode === null) {
    const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended;
  }
}
