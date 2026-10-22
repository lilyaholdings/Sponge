import test from 'node:test';
import assert from 'node:assert/strict';
import { runtimeError } from '../scripts/runtime.js';
test('launcher rejects Node versions that lack the required proxy flag', () => {
  for (const version of ['v18.20.0','v22.15.0','v24.0.0','v24.4.1']) assert.match(runtimeError(version), /requires Node.js 24.5/);
  for (const version of ['v24.5.0','v24.19.0','v25.0.0']) assert.equal(runtimeError(version), null);
});
