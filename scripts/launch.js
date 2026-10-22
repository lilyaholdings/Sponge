import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runtimeError } from './runtime.js';

const error = runtimeError(process.version);
if (error) {
  console.error(error);
  process.exit(1);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be an integer between 1 and 65535.');
  process.exit(1);
}
const child = spawn(process.execPath, ['--use-env-proxy', 'server.js'], {
  cwd: root,
  env: { ...process.env, HOST: process.env.HOST || '127.0.0.1', PORT: String(port) },
  stdio: ['inherit', 'pipe', 'inherit']
});
let opened = false;
child.stdout.on('data', chunk => {
  process.stdout.write(chunk);
  if (opened || !chunk.toString().includes(`Chemical X listening on port ${port}`)) return;
  opened = true;
  console.log('Keep this terminal open while using Chemical X. Press Ctrl+C to stop it.');
  if (process.argv.includes('--no-browser')) return;
  const address = `http://127.0.0.1:${port}`;
  const [command, args] = process.platform === 'darwin' ? ['open', [address]]
    : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', address]]
      : ['xdg-open', [address]];
  const browser = spawn(command, args, { stdio: 'ignore' });
  browser.on('error', () => console.error(`Automatic browser opening is unavailable. On this computer, open ${address}.`));
  browser.on('exit', code => { if (code) console.error(`Browser opening failed. On this computer, open ${address}.`); });
});
child.on('error', error => { console.error(`Could not launch Chemical X: ${error.message}`); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1); });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
