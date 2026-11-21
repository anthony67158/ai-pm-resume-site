import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderStore } from '../store.mjs';

test('Only matching 990 CNY receipts settle; duplicate transactions cannot unlock another order', () => {
  const store = new OrderStore(':memory:');
  const order = store.create('browser-a', 'wechat');
  const receipt = { id: order.id, method: 'wechat', amount: 990, currency: 'CNY', transaction: 'tx-1' };
  for (const patch of [{ amount: 989 }, { amount: 991 }, { currency: 'USD' }, { method: 'alipay' }, { id: 'unknown' }, { transaction: '' }]) {
    assert.throws(() => store.settle({ ...receipt, ...patch }));
    assert.equal(store.get(order.id).status, 'pending');
  }
  assert.equal(store.settle(receipt).status, 'paid');
  assert.equal(store.settle(receipt).status, 'paid');
  const other = store.create('browser-b', 'wechat');
  assert.throws(() => store.settle({ ...receipt, id: other.id }));
  assert.equal(store.get(other.id).status, 'pending');
  assert.equal(store.current('browser-a').id, order.id);
  store.closeDB();
});
