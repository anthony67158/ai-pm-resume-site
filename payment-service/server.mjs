import { mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OrderStore } from './store.mjs';
import { makeProviders } from './providers.mjs';
import { createApp } from './app.mjs';

const env = process.env;
const origin = new URL(env.PUBLIC_ORIGIN || 'http://127.0.0.1:8787');
if (origin.origin !== (env.PUBLIC_ORIGIN || origin.origin)) throw new Error('PUBLIC_ORIGIN must be an origin without a path');
const secure = origin.protocol === 'https:';
if (!secure && !['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error('Public checkout requires HTTPS');
const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const downloadFile = env.DOWNLOAD_FILE ? realpathSync(env.DOWNLOAD_FILE) : '';
if (downloadFile && !path.relative(siteRoot, downloadFile).startsWith(`..${path.sep}`)) throw new Error('Keep DOWNLOAD_FILE outside the public repository');
const dbFile = path.resolve(env.DATABASE_FILE || 'data/orders.sqlite');
mkdirSync(path.dirname(dbFile), { recursive: true, mode: 0o700 });
const store = new OrderStore(dbFile);
const app = createApp({ store, providers: makeProviders(env, origin.origin), origin: origin.origin,
  sessionSecret: env.SESSION_SECRET, downloadFile, siteRoot, secure });
const server = app.listen(Number(env.PORT || 8787), env.HOST || '127.0.0.1', () => console.log(`Checkout listening on ${origin.origin}`));
const shutdown = () => server.close(() => { store.closeDB(); process.exit(0); });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
