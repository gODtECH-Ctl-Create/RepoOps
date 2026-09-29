import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createControlPlaneServer } from '../src/control-plane/server.mjs';
import { createWebhookHttpHandler, webhookSecret } from '../src/control-plane/webhook-http.mjs';
import { PostgresWebhookInboxConflictError } from '../src/control-plane/postgres/webhook-inbox-store.mjs';

const secret = 'test-only-webhook-secret';
const body = Buffer.from('{"action":"created","installation":{"id":1},"repository":{"id":2},"comment":{"body":"/claim café"}}');
function headers(bytes = body, extra = {}) {
  return { 'content-type': 'application/json', 'x-github-event': 'issue_comment',
    'x-github-delivery': '00000000-0000-4000-8000-000000000096',
    'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(bytes).digest('hex')}`, ...extra };
}
async function setup(t, options = {}) {
  const service = createControlPlaneServer({ webhookHandler: createWebhookHttpHandler({
    secret, now: () => '2026-09-29T06:00:00.000Z',
    store: { async insertIfAbsent() { return { type: 'inserted' }; } }, ...options
  }) });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  t.after(() => service.close({ timeoutMs: 500 }));
  const url = `http://127.0.0.1:${service.server.address().port}/webhooks/github`;
  return { service, url, send: (bytes = body, extra = {}) => fetch(url, { method: 'POST', body: bytes, headers: headers(bytes), ...extra }) };
}

test('secret is required before HTTP handler construction and never echoed', () => {
  for (const value of [undefined, '', '  ', {}]) assert.throws(() => webhookSecret({ REPOOPS_WEBHOOK_SECRET: value }), /not configured/);
});
test('acceptance waits for durable storage and preserves exact UTF-8 bytes', async t => {
  let release, entered;
  const gate = new Promise(r => { release = r; });
  const started = new Promise(r => { entered = r; });
  const { send } = await setup(t, { store: { async insertIfAbsent(record, bytes) {
    assert.deepEqual(bytes, body); assert.equal(record.state, 'RECEIVED');
    assert.equal(record.delivery.repositoryId, 2); entered(); await gate; return { type: 'inserted' };
  } } });
  let settled = false;
  const result = send().then(r => { settled = true; return r; });
  await started; assert.equal(settled, false); release();
  assert.equal((await result).status, 202);
});
test('authentication precedes parsing and persistence', async t => {
  let calls = 0;
  const { send } = await setup(t, { store: { async insertIfAbsent() { calls++; } } });
  const invalid = Buffer.from('{not json');
  assert.equal((await send(invalid, { headers: headers(invalid, { 'x-hub-signature-256': 'invalid' }) })).status, 401);
  assert.equal((await send(invalid)).status, 400);
  assert.equal(calls, 0);
});
test('malformed envelope, invalid UTF-8, unsupported event and missing headers fail closed', async t => {
  let calls = 0;
  const { send } = await setup(t, { store: { async insertIfAbsent() { calls++; } } });
  for (const bytes of [Buffer.from('{}'), Buffer.from([0xff]), Buffer.from('[]')]) assert.equal((await send(bytes)).status, 400);
  for (const extra of [{ 'x-github-event': 'push' }, { 'x-github-delivery': 'bad' }, { 'x-github-event': '' }]) {
    assert.equal((await send(body, { headers: headers(body, extra) })).status, 400);
  }
  assert.equal((await send(body, { headers: { 'content-type': 'application/json' } })).status, 401);
  assert.equal(calls, 0);
});
test('only successful durable acceptance results produce 2XX and errors are sanitized', async t => {
  for (const result of ['inserted', 'existing', 'unexpected', 'failure', 'conflict']) {
    const { send } = await setup(t, { store: { async insertIfAbsent() {
      if (result === 'failure') throw new Error('secret database connection string');
      if (result === 'conflict') throw new PostgresWebhookInboxConflictError();
      return { type: result };
    } } });
    const response = await send();
    assert.equal(response.status, ['inserted', 'existing'].includes(result) ? 202 : result === 'conflict' ? 409 : 503);
    assert.doesNotMatch(await response.text(), /secret|connection string/);
  }
});
test('request methods, media types, compression, declared and streamed size are bounded', async t => {
  const { url, send } = await setup(t, { maxBytes: body.length - 1 });
  assert.equal((await fetch(url)).status, 405);
  assert.equal((await send()).status, 413);
  assert.equal((await send(body, { headers: headers(body, { 'content-type': 'text/plain' }) })).status, 415);
  assert.equal((await send(body, { headers: headers(body, { 'content-encoding': 'gzip' }) })).status, 415);
  const status = await new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'POST', headers: headers() }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.write(body.subarray(0, 20)); req.end(body.subarray(20));
  });
  assert.equal(status, 413);
});
test('duplicate signature headers are rejected', async t => {
  const { url } = await setup(t);
  const status = await new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'POST', headers: headers(body, { 'x-hub-signature-256': [headers()['x-hub-signature-256'], headers()['x-hub-signature-256']] }) }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end(body);
  });
  assert.equal(status, 401);
});
test('timeout cannot turn an ambiguous late commit into an HTTP success', async t => {
  let release;
  const gate = new Promise(r => { release = r; });
  const { send } = await setup(t, { timeoutMs: 30, store: { async insertIfAbsent() { await gate; return { type: 'inserted' }; } } });
  const response = await send(); assert.equal(response.status, 503);
  release(); await response.text();
});
test('shutdown rejects new work and drains in-flight acceptance', async t => {
  let entered, release;
  const started = new Promise(r => { entered = r; });
  const gate = new Promise(r => { release = r; });
  const { service, send } = await setup(t, { store: { async insertIfAbsent() { entered(); await gate; return { type: 'inserted' }; } } });
  const response = send(); await started;
  service.beginShutdown(); assert.equal((await send()).status, 503);
  const close = service.close({ timeoutMs: 500 }); release();
  assert.equal((await response).status, 202); assert.deepEqual(await close, { forced: false });
});

test('deep authenticated JSON is handled without recursive stack exhaustion', async t => {
  const { send } = await setup(t);
  const nested = '{"action":"created","installation":{"id":1},"repository":{"id":2},"extra":' + '['.repeat(15000) + '0' + ']'.repeat(15000) + '}';
  assert.equal((await send(Buffer.from(nested))).status, 202);
});

test('incomplete body expires without reaching persistence', async t => {
  let calls = 0;
  const { url } = await setup(t, { timeoutMs: 30, store: { async insertIfAbsent() { calls++; } } });
  const status = await new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: 'POST', headers: headers() }, res => { res.resume(); resolve(res.statusCode); req.destroy(); });
    req.on('error', reject); req.write('{');
  });
  assert.equal(status, 503); assert.equal(calls, 0);
});
