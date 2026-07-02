import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dirname, 'billing.db'));

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT    NOT NULL,
    hsn       TEXT,                       -- HSN/SAC code
    rate      REAL    NOT NULL,          -- price per unit, GST-exclusive
    gst_rate  REAL    NOT NULL DEFAULT 0 -- total GST % (CGST+SGST)
  );

  CREATE TABLE IF NOT EXISTS bills (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_no  TEXT    NOT NULL UNIQUE,
    created_at  TEXT    NOT NULL,
    customer    TEXT,
    customer_state TEXT,
    subtotal    REAL    NOT NULL,        -- taxable value (GST-exclusive)
    cgst        REAL    NOT NULL,
    sgst        REAL    NOT NULL,
    igst        REAL    NOT NULL DEFAULT 0,
    interstate  INTEGER NOT NULL DEFAULT 0,
    total       REAL    NOT NULL         -- grand total (rounded)
  );

  CREATE TABLE IF NOT EXISTS settings (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    store_name TEXT,
    address    TEXT,
    gstin      TEXT,
    state      TEXT
  );

  CREATE TABLE IF NOT EXISTS bill_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id    INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    hsn        TEXT,                        -- HSN/SAC code (snapshot at bill time)
    rate       REAL    NOT NULL,
    gst_rate   REAL    NOT NULL,
    qty        REAL    NOT NULL,
    taxable    REAL    NOT NULL,         -- rate * qty
    gst_amount REAL    NOT NULL,
    total      REAL    NOT NULL          -- taxable + gst_amount
  );
`);

// Lightweight migration: add columns to an existing bills table if missing.
const billCols = db.prepare('PRAGMA table_info(bills)').all().map((c) => c.name);
if (!billCols.includes('igst')) db.exec('ALTER TABLE bills ADD COLUMN igst REAL NOT NULL DEFAULT 0');
if (!billCols.includes('interstate')) db.exec('ALTER TABLE bills ADD COLUMN interstate INTEGER NOT NULL DEFAULT 0');
if (!billCols.includes('customer_state')) db.exec('ALTER TABLE bills ADD COLUMN customer_state TEXT');

// Migrate products: the old `sku` column becomes `hsn` (HSN/SAC code).
const productCols = db.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
if (productCols.includes('sku') && !productCols.includes('hsn')) {
  db.exec('ALTER TABLE products RENAME COLUMN sku TO hsn');
} else if (!productCols.includes('hsn')) {
  db.exec('ALTER TABLE products ADD COLUMN hsn TEXT');
}

// Migrate bill_items: add hsn so historical invoices can show the code too.
const itemCols = db.prepare('PRAGMA table_info(bill_items)').all().map((c) => c.name);
if (!itemCols.includes('hsn')) db.exec('ALTER TABLE bill_items ADD COLUMN hsn TEXT');

// Seed the single settings row.
if (!db.prepare('SELECT id FROM settings WHERE id = 1').get()) {
  db.prepare(
    'INSERT INTO settings (id, store_name, address, gstin, state) VALUES (1, ?, ?, ?, ?)'
  ).run('My Store', '', '', '');
}

// Seed a few sample products the first time so the app is usable immediately.
const count = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
if (count === 0) {
  const insert = db.prepare(
    'INSERT INTO products (name, hsn, rate, gst_rate) VALUES (?, ?, ?, ?)'
  );
  insert.run('Milk 1L', '0401', 60, 5);
  insert.run('Basmati Rice 1kg', '1006', 120, 5);
  insert.run('Shampoo 200ml', '3305', 180, 18);
  insert.run('LED Bulb 9W', '8539', 90, 12);
  insert.run('Wireless Mouse', '8471', 650, 18);
}

export default db;
