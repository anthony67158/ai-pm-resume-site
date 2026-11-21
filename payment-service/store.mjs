import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';

export const PRICE = 990;
export class OrderStore {
  constructor(file) {
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, method TEXT NOT NULL,
        amount INTEGER NOT NULL DEFAULT 990 CHECK(amount=990),
        status TEXT NOT NULL DEFAULT 'pending', qr TEXT, transaction_id TEXT,
        created INTEGER NOT NULL, paid_at INTEGER,
        UNIQUE(method, transaction_id));
      CREATE INDEX IF NOT EXISTS orders_owner ON orders(owner, created);`);
  }
  get(id) { return this.db.prepare('SELECT * FROM orders WHERE id=?').get(id); }
  current(owner) {
    return this.db.prepare("SELECT * FROM orders WHERE owner=? AND status IN ('pending','paid') ORDER BY created DESC LIMIT 1").get(owner);
  }
  create(owner, method) {
    const id = `R${randomBytes(15).toString('hex')}`;
    this.db.prepare('INSERT INTO orders(id,owner,method,created) VALUES(?,?,?,?)').run(id, owner, method, Date.now());
    return this.get(id);
  }
  setQR(id, qr) { this.db.prepare('UPDATE orders SET qr=? WHERE id=?').run(qr, id); }
  close(id) { this.db.prepare("UPDATE orders SET status='closed' WHERE id=? AND status='pending'").run(id); }
  settle(receipt) {
    const { id, method, amount, currency, transaction } = receipt;
    if (amount !== PRICE || currency !== 'CNY' || !transaction || typeof transaction !== 'string') {
      throw new Error('Invalid receipt');
    }
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const order = this.get(id);
      if (!order || order.method !== method || order.amount !== amount) throw new Error('Order mismatch');
      if (order.status === 'paid') {
        if (order.transaction_id !== transaction) throw new Error('Transaction mismatch');
      } else {
        if (order.status !== 'pending') throw new Error('Order closed');
        this.db.prepare("UPDATE orders SET status='paid', transaction_id=?, paid_at=? WHERE id=?")
          .run(transaction, Date.now(), id);
      }
      this.db.exec('COMMIT');
      return this.get(id);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  closeDB() { this.db.close(); }
}
