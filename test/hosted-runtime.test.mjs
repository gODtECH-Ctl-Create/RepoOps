import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { startHostedControlPlane } from '../src/control-plane/hosted.mjs';

async function port() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const result = server.address().port;
  await new Promise(resolve => server.close(resolve)); return result;
}
test('hosted runtime requires secret before allocating database resources', async () => {
  await assert.rejects(() => startHostedControlPlane({ env: {}, poolFactory() { assert.fail('must not allocate'); } }), /not configured/);
});
test('hosted readiness verifies inbox schema and stop closes pool once after listener', async () => {
  const pool = new EventEmitter(); let ends = 0, ready = true, runtime;
  pool.query = async sql => { assert.match(sql, /payload_bytes/); if (!ready) throw new Error('secret'); };
  pool.end = async () => { assert.equal(runtime.server.listening, false); ends++; };
  runtime = await startHostedControlPlane({ env: { REPOOPS_WEBHOOK_SECRET: 'test', REPOOPS_PORT: String(await port()) }, poolFactory: () => pool });
  const url = `http://127.0.0.1:${runtime.address.port}`;
  try {
    assert.equal((await fetch(`${url}/readyz`)).status, 200);
    ready = false;
    const response = await fetch(`${url}/readyz`);
    assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /secret/);
    assert.equal((await fetch(`${url}/healthz`)).status, 200);
    pool.emit('error', new Error('secret'));
  } finally { await Promise.all([runtime.stop(), runtime.stop()]); }
  assert.equal(ends, 1);
});
test('startup database failure closes resources and sanitizes diagnostics', async () => {
  const pool = new EventEmitter(); let ended = false;
  pool.query = async () => { throw new Error('private database credentials'); };
  pool.end = async () => { ended = true; };
  await assert.rejects(() => startHostedControlPlane({ env: { REPOOPS_WEBHOOK_SECRET: 'test' }, poolFactory: () => pool }), error => !error.message.includes('private'));
  assert.equal(ended, true);
});
