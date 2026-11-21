import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../app.mjs';
import { OrderStore } from '../store.mjs';

test('HTTP ownership, receipt validation, callback idempotency and protected download', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'checkout-test-'));
  const file = path.join(dir, 'private.zip');
  writeFileSync(file, Buffer.from('PK-test-fixture'));
  const store = new OrderStore(':memory:');
  let queryResult = {};
  const provider = {
    create: async () => 'weixin://wxpay/test-fixture',
    query: async order => typeof queryResult === 'function' ? queryResult(order) : queryResult,
    notify(raw, headers) {
      if (headers['x-test-signature'] !== 'verified-test-fixture') throw new Error('invalid');
      return JSON.parse(raw);
    }
  };
  const origin = 'http://localhost';
  const app = createApp({ store, providers: { wechat: provider }, origin, sessionSecret: 'x'.repeat(32),
    downloadFile: file, siteRoot: dir, secure: false });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); store.closeDB(); rmSync(dir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, init) => fetch(`${base}${url}`, init);
  const init = await request('/api/checkout');
  const cookie = init.headers.get('set-cookie').split(';')[0];
  const headers = { cookie, origin, 'Content-Type': 'application/json' };
  const create = await request('/api/orders', { method: 'POST', headers, body: '{"method":"wechat","amount":1,"paid":true}' });
  assert.equal(create.status, 201);
  const order = await create.json();
  assert.equal(order.amount, 990);
  assert.equal(order.status, 'pending');
  assert.equal((await request(`/api/orders/${order.id}/download`, { headers })).status, 403);
  assert.equal((await request(`/api/orders/${order.id}`, { headers: { cookie: 'checkout=forged' } })).status, 404);
  assert.equal((await request('/api/orders', { method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: '{"method":"wechat"}' })).status, 403);
  const again = await request('/api/orders', { method: 'POST', headers, body: '{"method":"wechat"}' });
  assert.equal((await again.json()).id, order.id);
  const receipt = { id: order.id, method: 'wechat', amount: 990, currency: 'CNY', transaction: 'tx-fixture' };
  const notify = (body, verified = true) => request('/api/notify/wechat', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(verified ? { 'x-test-signature': 'verified-test-fixture' } : {}) }, body: JSON.stringify(body) });
  assert.equal((await notify(receipt, false)).status, 400);
  assert.equal((await notify({ ...receipt, amount: 989 })).status, 400);
  assert.equal((await notify(receipt)).status, 204);
  assert.equal((await notify(receipt)).status, 204);
  assert.equal((await request(`/api/orders/${order.id}/download`, { headers })).status, 425);
  store.db.prepare('UPDATE orders SET paid_at=? WHERE id=?').run(Date.now() - 4000, order.id);
  assert.equal((await request(`/api/orders/${order.id}/download`)).status, 404);
  const download = await request(`/api/orders/${order.id}/download`, { headers });
  assert.equal(download.status, 200);
  assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.equal(await download.text(), 'PK-test-fixture');
  for (const resource of ['/payment-service/.env', '/payment-service/data/orders.sqlite', '/private.zip']) {
    assert.equal((await request(resource)).status, 404);
  }
  // A signed query for another order cannot settle the requested order.
  const sessionB = await request('/api/checkout');
  const cookieB = sessionB.headers.get('set-cookie').split(';')[0];
  const headersB = { ...headers, cookie: cookieB };
  const orderB = await (await request('/api/orders', { method: 'POST', headers: headersB, body: '{"method":"wechat"}' })).json();
  queryResult = { receipt };
  assert.equal((await (await request(`/api/orders/${orderB.id}`, { headers: headersB })).json()).status, 'pending');
  const sessionC = await request('/api/checkout');
  const headersC = { ...headers, cookie: sessionC.headers.get('set-cookie').split(';')[0] };
  const orderC = await (await request('/api/orders', { method: 'POST', headers: headersC, body: '{"method":"wechat"}' })).json();
  queryResult = queried => ({ receipt: { ...receipt, id: queried.id, transaction: 'query-recovery-tx' } });
  assert.equal((await (await request(`/api/orders/${orderC.id}`, { headers: headersC })).json()).status, 'paid');
});

test('No configured provider or private file means checkout stays unavailable', async t => {
  const store = new OrderStore(':memory:');
  const app = createApp({ store, providers: {}, origin: 'http://localhost', sessionSecret: 'x'.repeat(32),
    downloadFile: '/does-not-exist.zip', siteRoot: '/tmp', secure: false });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); store.closeDB(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual((await (await fetch(`${base}/api/checkout`)).json()).methods, []);
  assert.equal((await fetch(`${base}/api/orders`, { method: 'POST',
    headers: { origin: 'http://localhost', 'Content-Type': 'application/json' }, body: '{"method":"wechat"}' })).status, 503);
});
