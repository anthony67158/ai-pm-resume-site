import { readFileSync } from 'node:fs';
import { randomBytes, sign, verify, createDecipheriv } from 'node:crypto';
import { AlipaySdk } from 'alipay-sdk';
import { PRICE } from './store.mjs';

const required = (env, names) => names.every(name => Boolean(env[name]));
const key = file => readFileSync(file, 'utf8');
const assert = condition => { if (!condition) throw new Error('Payment verification failed'); };

export function verifyWechat(raw, headers, config, now = Date.now()) {
  const timestamp = headers['wechatpay-timestamp'];
  const nonce = headers['wechatpay-nonce'];
  const signature = headers['wechatpay-signature'];
  assert(/^\d+$/.test(timestamp || '') && Math.abs(now / 1000 - Number(timestamp)) <= 300);
  assert(nonce && signature && headers['wechatpay-serial'] === config.platformId);
  assert(verify('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${raw}\n`),
    config.platformKey, Buffer.from(signature, 'base64')));
}

export function decryptWechat(resource, apiKey) {
  assert(resource?.algorithm === 'AEAD_AES_256_GCM' && Buffer.byteLength(apiKey) === 32);
  const encrypted = Buffer.from(resource.ciphertext, 'base64');
  assert(encrypted.length > 16);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(apiKey), Buffer.from(resource.nonce));
  decipher.setAuthTag(encrypted.subarray(-16));
  decipher.setAAD(Buffer.from(resource.associated_data || ''));
  return JSON.parse(Buffer.concat([decipher.update(encrypted.subarray(0, -16)), decipher.final()]).toString());
}

export function wechatReceipt(data, config) {
  assert(data.appid === config.appid && data.mchid === config.mchid);
  assert(data.trade_state === 'SUCCESS' && data.amount?.total === PRICE && data.amount?.currency === 'CNY');
  // Reject discounts so the payer must actually pay the full ¥9.90.
  assert(data.amount.payer_total === PRICE && data.amount.payer_currency === 'CNY');
  return { id: data.out_trade_no, method: 'wechat', amount: PRICE, currency: 'CNY', transaction: data.transaction_id };
}

export function alipayReceipt(data, config, notification = true) {
  if (notification) assert(data.app_id === config.appid && data.seller_id === config.seller);
  else {
    if (data.app_id !== undefined) assert(data.app_id === config.appid);
    if (data.seller_id !== undefined) assert(data.seller_id === config.seller);
  }
  assert(['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(data.trade_status));
  assert(/^9\.9(?:0)?$/.test(String(data.total_amount)));
  assert(/^9\.9(?:0)?$/.test(String(data.buyer_pay_amount)));
  return { id: data.out_trade_no, method: 'alipay', amount: PRICE, currency: 'CNY', transaction: data.trade_no };
}

export function makeProviders(env, origin) {
  const providers = {};
  if (required(env, ['WECHAT_APP_ID', 'WECHAT_MCH_ID', 'WECHAT_PRIVATE_KEY_FILE',
    'WECHAT_SERIAL', 'WECHAT_API_V3_KEY', 'WECHAT_PLATFORM_KEY_FILE', 'WECHAT_PLATFORM_KEY_ID'])) {
    const c = { appid: env.WECHAT_APP_ID, mchid: env.WECHAT_MCH_ID, privateKey: key(env.WECHAT_PRIVATE_KEY_FILE),
      serial: env.WECHAT_SERIAL, apiKey: env.WECHAT_API_V3_KEY,
      platformKey: key(env.WECHAT_PLATFORM_KEY_FILE), platformId: env.WECHAT_PLATFORM_KEY_ID };
    assert(Buffer.byteLength(c.apiKey) === 32);
    const request = async (method, path, body) => {
      const raw = body ? JSON.stringify(body) : '';
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const nonce = randomBytes(16).toString('hex');
      const signature = sign('RSA-SHA256', Buffer.from(`${method}\n${path}\n${timestamp}\n${nonce}\n${raw}\n`), c.privateKey).toString('base64');
      const response = await fetch(`https://api.mch.weixin.qq.com${path}`, {
        method, body: body ? raw : undefined, signal: AbortSignal.timeout(12000), redirect: 'error',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json',
          Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${c.mchid}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${c.serial}",signature="${signature}"` }
      });
      const text = await response.text();
      verifyWechat(text, Object.fromEntries(response.headers), c);
      assert(response.ok);
      return JSON.parse(text);
    };
    providers.wechat = {
      async create(order) {
        const data = await request('POST', '/v3/pay/transactions/native', {
          appid: c.appid, mchid: c.mchid, description: 'AI 产品经理简历 Skill',
          out_trade_no: order.id, notify_url: `${origin}/api/notify/wechat`,
          time_expire: new Date(order.created + 30 * 60 * 1000).toISOString(),
          amount: { total: PRICE, currency: 'CNY' }
        });
        assert(typeof data.code_url === 'string' && data.code_url.startsWith('weixin://wxpay/'));
        return data.code_url;
      },
      async query(order) {
        const data = await request('GET', `/v3/pay/transactions/out-trade-no/${order.id}?mchid=${encodeURIComponent(c.mchid)}`);
        assert(data.out_trade_no === order.id && data.appid === c.appid && data.mchid === c.mchid);
        if (data.trade_state === 'SUCCESS') return { receipt: wechatReceipt(data, c) };
        return { closed: ['CLOSED', 'REVOKED', 'PAYERROR'].includes(data.trade_state) };
      },
      notify(raw, headers) {
        verifyWechat(raw.toString('utf8'), headers, c);
        const event = JSON.parse(raw.toString('utf8'));
        assert(event.event_type === 'TRANSACTION.SUCCESS');
        return wechatReceipt(decryptWechat(event.resource, c.apiKey), c);
      }
    };
  }
  if (required(env, ['ALIPAY_APP_ID', 'ALIPAY_SELLER_ID', 'ALIPAY_PRIVATE_KEY_FILE', 'ALIPAY_PUBLIC_KEY_FILE'])) {
    const c = { appid: env.ALIPAY_APP_ID, seller: env.ALIPAY_SELLER_ID };
    const sdk = new AlipaySdk({ appId: c.appid, privateKey: key(env.ALIPAY_PRIVATE_KEY_FILE),
      alipayPublicKey: key(env.ALIPAY_PUBLIC_KEY_FILE), keyType: 'PKCS8', timeout: 12000 });
    const request = async (path, body) => {
      const result = await sdk.curl('POST', path, { body });
      assert(result.responseHttpStatus === 200);
      return result.data;
    };
    providers.alipay = {
      async create(order) {
        const data = await request('/v3/alipay/trade/precreate', {
          out_trade_no: order.id, total_amount: '9.90', subject: 'AI 产品经理简历 Skill',
          seller_id: c.seller, timeout_express: '30m', notify_url: `${origin}/api/notify/alipay`
        });
        assert(data.out_trade_no === order.id && typeof data.qr_code === 'string' && data.qr_code.startsWith('https://qr.alipay.com/'));
        return data.qr_code;
      },
      async query(order) {
        // The SDK verifies the response with Alipay's public key. The request is
        // authenticated as this app; the unpredictable order belongs to our DB.
        const data = await request('/v3/alipay/trade/query', { out_trade_no: order.id });
        assert(data.out_trade_no === order.id);
        if (['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(data.trade_status)) return { receipt: alipayReceipt(data, c, false) };
        return { closed: data.trade_status === 'TRADE_CLOSED' };
      },
      notify(raw) {
        const params = new URLSearchParams(raw.toString('utf8'));
        assert(new Set(params.keys()).size === [...params.keys()].length);
        const data = Object.fromEntries(params);
        assert(data.sign_type === 'RSA2' && sdk.checkNotifySignV2(data));
        return alipayReceipt(data, c);
      }
    };
  }
  return providers;
}
