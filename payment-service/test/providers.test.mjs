import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createCipheriv } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { verifyWechat, decryptWechat, wechatReceipt, alipayReceipt, makeProviders } from '../providers.mjs';

test('WeChat signatures bind raw bytes, key identity and freshness', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const timestamp = `${Math.floor(Date.now() / 1000)}`;
  const raw = '{"event_type":"TRANSACTION.SUCCESS"}';
  const headers = { 'wechatpay-timestamp': timestamp, 'wechatpay-nonce': 'nonce', 'wechatpay-serial': 'key-1',
    'wechatpay-signature': sign('RSA-SHA256', Buffer.from(`${timestamp}\nnonce\n${raw}\n`), privateKey).toString('base64') };
  const config = { platformKey: publicKey, platformId: 'key-1' };
  verifyWechat(raw, headers, config);
  assert.throws(() => verifyWechat(`${raw} `, headers, config));
  assert.throws(() => verifyWechat(raw, { ...headers, 'wechatpay-serial': 'wrong' }, config));
  assert.throws(() => verifyWechat(raw, headers, config, Date.now() + 400000));
  assert.throws(() => verifyWechat(raw, { ...headers, 'wechatpay-signature': 'fake' }, config));
});

test('WeChat authenticated decryption rejects tampering', () => {
  const apiKey = '12345678901234567890123456789012';
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(apiKey), Buffer.from('123456789012'));
  cipher.setAAD(Buffer.from('transaction'));
  const ciphertext = Buffer.concat([cipher.update('{"amount":990}'), cipher.final(), cipher.getAuthTag()]).toString('base64');
  const resource = { algorithm: 'AEAD_AES_256_GCM', nonce: '123456789012', associated_data: 'transaction', ciphertext };
  assert.deepEqual(decryptWechat(resource, apiKey), { amount: 990 });
  assert.throws(() => decryptWechat({ ...resource, associated_data: 'other' }, apiKey));
});

test('Provider receipts require matching merchant and full buyer payment', () => {
  const c = { appid: 'app', mchid: 'merchant', seller: 'seller' };
  const wx = { appid: 'app', mchid: 'merchant', trade_state: 'SUCCESS', out_trade_no: 'order',
    transaction_id: 'tx', amount: { total: 990, currency: 'CNY', payer_total: 990, payer_currency: 'CNY' } };
  assert.equal(wechatReceipt(wx, c).amount, 990);
  for (const patch of [{ mchid: 'other' }, { appid: 'other' }, { trade_state: 'NOTPAY' },
    { amount: { ...wx.amount, total: 989 } }, { amount: { ...wx.amount, currency: 'USD' } },
    { amount: { ...wx.amount, payer_total: 980 } }]) assert.throws(() => wechatReceipt({ ...wx, ...patch }, c));
  const ali = { app_id: 'app', seller_id: 'seller', trade_status: 'TRADE_SUCCESS',
    total_amount: '9.90', buyer_pay_amount: '9.90', out_trade_no: 'order', trade_no: 'tx' };
  assert.equal(alipayReceipt(ali, c).amount, 990);
  for (const patch of [{ seller_id: 'other' }, { app_id: 'other' }, { total_amount: '9.91' },
    { buyer_pay_amount: '9.00' }, { trade_status: 'WAIT_BUYER_PAY' }]) assert.throws(() => alipayReceipt({ ...ali, ...patch }, c));
  assert.deepEqual(makeProviders({}, 'http://localhost'), {});
});

test('Alipay official SDK verifies signed callbacks and rejects changed/duplicate fields', t => {
  const dir = mkdtempSync(`${tmpdir()}/alipay-keys-`);
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  });
  writeFileSync(`${dir}/private.pem`, privateKey);
  writeFileSync(`${dir}/public.pem`, publicKey);
  const provider = makeProviders({ ALIPAY_APP_ID: 'app', ALIPAY_SELLER_ID: 'seller',
    ALIPAY_PRIVATE_KEY_FILE: `${dir}/private.pem`, ALIPAY_PUBLIC_KEY_FILE: `${dir}/public.pem` }, 'https://test.invalid').alipay;
  const fields = { app_id: 'app', seller_id: 'seller', trade_status: 'TRADE_SUCCESS',
    total_amount: '9.90', buyer_pay_amount: '9.90', out_trade_no: 'order', trade_no: 'transaction',
    subject: 'Skill + 模板' };
  const content = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('&');
  const signature = sign('RSA-SHA256', Buffer.from(content), privateKey).toString('base64');
  const body = new URLSearchParams({ ...fields, sign_type: 'RSA2', sign: signature }).toString();
  assert.equal(provider.notify(Buffer.from(body)).transaction, 'transaction');
  assert.throws(() => provider.notify(Buffer.from(body.replace('9.90', '9.80'))));
  assert.throws(() => provider.notify(Buffer.from(`${body}&total_amount=9.90`)));
  assert.throws(() => provider.notify(Buffer.from(body.replace('RSA2', 'RSA'))));
});
