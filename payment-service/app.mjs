import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { accessSync, constants, statSync } from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { PRICE } from './store.mjs';

export function createApp({ store, providers, origin, sessionSecret, downloadFile, siteRoot, secure = true }) {
  if (Buffer.byteLength(sessionSecret || '') < 32) throw new Error('SESSION_SECRET must have at least 32 bytes');
  const app = express();
  app.disable('x-powered-by');
  const mac = value => createHmac('sha256', sessionSecret).update(value).digest('hex');
  const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  const fileReady = () => {
    try { accessSync(downloadFile, constants.R_OK); return statSync(downloadFile).isFile(); } catch { return false; }
  };
  const fail = (res, status, error) => res.status(status).json({ error });
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" });
    if (secure) res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
  });
  // Notifications precede JSON parsing: signatures must cover original bytes.
  app.post('/api/notify/:method', express.raw({ type: () => true, limit: '64kb' }), (req, res) => {
    try {
      const provider = providers[req.params.method];
      if (!provider) return fail(res, 503, '通道未开通');
      const receipt = provider.notify(req.body, req.headers);
      store.settle(receipt);
      if (req.params.method === 'alipay') return res.type('text').send('success');
      return res.status(204).end();
    } catch {
      // Never log payment bodies, SDK errors, buyer IDs or secrets.
      return fail(res, 400, '回执未通过核验');
    }
  });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.get('sec-fetch-site') === 'cross-site') return fail(res, 403, '请返回原支付页面');
    if (!['GET', 'HEAD'].includes(req.method) && req.get('origin') !== origin) return fail(res, 403, '请求来源不符');
    next();
  });
  app.use('/api', rateLimit({ windowMs: 60000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { error: '请求过于频繁，请稍后重试' } }));
  app.use('/api', express.json({ limit: '2kb' }));
  app.use('/api', (req, res, next) => {
    const raw = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('checkout='))?.slice(9) || '';
    const parts = raw.split('.');
    let value = parts.slice(0, 2).join('.');
    if (parts.length !== 3 || !/^[a-f0-9]{64}$/.test(parts[0]) || !/^\d{13}$/.test(parts[1]) ||
      Number(parts[1]) < Date.now() || !same(mac(value), parts[2])) {
      value = `${randomBytes(32).toString('hex')}.${Date.now() + 30 * 86400000}`;
      res.cookie('checkout', `${value}.${mac(value)}`, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 30 * 86400000 });
    }
    req.owner = createHash('sha256').update(value).digest('hex');
    next();
  });
  const queryLocks = new Map();
  const reconcile = async order => {
    if (order.status !== 'pending' || !providers[order.method]) return order;
    if (!queryLocks.has(order.id)) {
      const work = (async () => {
        try {
          const result = await providers[order.method].query(order);
          if (result.receipt) {
            if (result.receipt.id !== order.id || result.receipt.method !== order.method) throw new Error('Mismatched query');
            store.settle(result.receipt);
          } else if (result.closed) store.close(order.id);
        } catch { /* Unverified/error responses never grant access. Retry later. */ }
      })();
      queryLocks.set(order.id, work);
      work.finally(() => setTimeout(() => queryLocks.delete(order.id), 10000).unref());
    }
    await queryLocks.get(order.id);
    return store.get(order.id);
  };
  const publicOrder = async order => ({
    id: order.id, method: order.method, amount: order.amount, status: order.status,
    qr: order.status === 'pending' && order.qr ? await QRCode.toDataURL(order.qr, { width: 320, margin: 4, errorCorrectionLevel: 'M' }) : null,
    download: order.status === 'paid' ? `/api/orders/${order.id}/download` : null
  });
  app.get('/api/checkout', async (req, res) => {
    const current = store.current(req.owner);
    res.json({ amount: PRICE, methods: fileReady() ? Object.keys(providers) : [],
      order: current ? await publicOrder(await reconcile(current)) : null });
  });
  app.post('/api/orders', rateLimit({ windowMs: 3600000, limit: 30, legacyHeaders: false,
    message: { error: '下单次数过多，请稍后重试' } }), async (req, res) => {
    const method = req.body?.method;
    if (!Object.hasOwn(providers, method) || !fileReady()) return fail(res, 503, '支付通道尚未开通，请暂勿转账');
    // A browser keeps one active order across tabs and payment-method switches.
    const current = store.current(req.owner);
    if (current) return res.json(await publicOrder(await reconcile(current)));
    const order = store.create(req.owner, method);
    try {
      store.setQR(order.id, await providers[method].create(order));
      return res.status(201).json(await publicOrder(store.get(order.id)));
    } catch {
      // Network timeouts are ambiguous. Keep the order for query/callback recovery,
      // never create another order that could cause a second charge.
      return fail(res, 502, `订单 ${order.id} 正在核实，请刷新恢复；请勿重复转账`);
    }
  });
  const owned = (req, res) => {
    const order = store.get(req.params.id);
    if (!order || order.owner !== req.owner) { fail(res, 404, '订单不存在'); return null; }
    return order;
  };
  app.get('/api/orders/:id', async (req, res) => {
    const order = owned(req, res);
    if (order) res.json(await publicOrder(await reconcile(order)));
  });
  app.get('/api/orders/:id/download', (req, res) => {
    const order = owned(req, res);
    if (!order) return;
    if (order.status !== 'paid' || order.amount !== PRICE || !order.transaction_id) return fail(res, 403, '订单尚未确认付款');
    if (Date.now() < order.paid_at + 3000) return fail(res, 425, '支付已确认，请等待 3 秒');
    if (!fileReady()) return fail(res, 503, '安装包暂不可用，请保留订单并稍后重试');
    res.download(downloadFile, 'ai-pm-resume.zip', error => {
      if (error && !res.headersSent) fail(res, 503, '下载暂不可用，请重试');
    });
  });
  app.use('/api', (req, res) => fail(res, 404, '接口不存在'));
  // Explicit public file list; never expose service code, DB, .env or private ZIP.
  app.get('/checkout-config.js', (req, res) => res.type('js').set('Cache-Control', 'no-store')
    .send(`window.AIPM_CHECKOUT_ORIGIN = ${JSON.stringify(origin)};`));
  for (const file of ['index.html', 'styles.css', 'tokens.css', 'app.js', 'checkout.js', 'favicon.svg']) {
    app.get(file === 'index.html' ? ['/', '/index.html'] : `/${file}`, (req, res) => res.sendFile(path.join(siteRoot, file)));
  }
  app.use('/assets', (req, res, next) => {
    if (!/\.(?:png|jpg|jpeg|webp|svg|woff2?)$/i.test(req.path)) return res.sendStatus(404);
    next();
  }, express.static(path.join(siteRoot, 'assets'), { dotfiles: 'deny', index: false }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    fail(res, error.status === 400 ? 400 : 500, '请求未完成，请稍后重试');
  });
  return app;
}
