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
    -- 'goods' carries an HSN code, 'service' carries a SAC code.
    kind      TEXT    NOT NULL DEFAULT 'goods',
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
    customer_gstin TEXT,
    supply_type TEXT NOT NULL DEFAULT 'goods', -- 'goods' | 'services'
    cust_address  TEXT,   -- registered address (from GSTIN lookup, editable)
    cust_city     TEXT,
    cust_district TEXT,
    cust_pincode  TEXT,
    cust_phone    TEXT,   -- contact details: typed in, not from the GST record
    cust_email    TEXT,
    subtotal    REAL    NOT NULL,        -- taxable value (GST-exclusive)
    cgst        REAL    NOT NULL,
    sgst        REAL    NOT NULL,
    igst        REAL    NOT NULL DEFAULT 0,
    interstate  INTEGER NOT NULL DEFAULT 0,
    gst         INTEGER NOT NULL DEFAULT 1, -- 1 = Tax Invoice, 0 = Bill of Supply (non-GST)
    total       REAL    NOT NULL         -- grand total (rounded)
  );

  CREATE TABLE IF NOT EXISTS settings (
    id          INTEGER PRIMARY KEY CHECK (id = 1),
    store_name  TEXT,
    address     TEXT,
    gstin       TEXT,
    state       TEXT,
    -- 'registered' = GST-registered dealer (has a GSTIN, may issue Tax Invoices).
    -- 'unregistered' = not GST-registered: no GSTIN, Bill of Supply only.
    dealer_type TEXT NOT NULL DEFAULT 'unregistered',
    -- Contact details: typed in, not sourced from the GST record.
    phone       TEXT,
    email       TEXT,
    website     TEXT,
    social1     TEXT,
    social2     TEXT,
    social3     TEXT
  );

  CREATE TABLE IF NOT EXISTS bill_items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id    INTEGER NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    description TEXT,                        -- optional line note (used for services)
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
if (!billCols.includes('customer_gstin')) db.exec('ALTER TABLE bills ADD COLUMN customer_gstin TEXT');
if (!billCols.includes('supply_type')) db.exec("ALTER TABLE bills ADD COLUMN supply_type TEXT NOT NULL DEFAULT 'goods'");
if (!billCols.includes('cust_address')) db.exec('ALTER TABLE bills ADD COLUMN cust_address TEXT');
if (!billCols.includes('cust_city')) db.exec('ALTER TABLE bills ADD COLUMN cust_city TEXT');
if (!billCols.includes('cust_district')) db.exec('ALTER TABLE bills ADD COLUMN cust_district TEXT');
if (!billCols.includes('cust_pincode')) db.exec('ALTER TABLE bills ADD COLUMN cust_pincode TEXT');
if (!billCols.includes('gst')) db.exec('ALTER TABLE bills ADD COLUMN gst INTEGER NOT NULL DEFAULT 1');
if (!billCols.includes('cust_phone')) db.exec('ALTER TABLE bills ADD COLUMN cust_phone TEXT');
if (!billCols.includes('cust_email')) db.exec('ALTER TABLE bills ADD COLUMN cust_email TEXT');

// Migrate products: the old `sku` column becomes `hsn` (HSN/SAC code).
const productCols = db.prepare('PRAGMA table_info(products)').all().map((c) => c.name);
if (productCols.includes('sku') && !productCols.includes('hsn')) {
  db.exec('ALTER TABLE products RENAME COLUMN sku TO hsn');
} else if (!productCols.includes('hsn')) {
  db.exec('ALTER TABLE products ADD COLUMN hsn TEXT');
}
// Everything catalogued before services existed is goods.
if (!productCols.includes('kind')) {
  db.exec("ALTER TABLE products ADD COLUMN kind TEXT NOT NULL DEFAULT 'goods'");
}

// Migrate bill_items: add hsn so historical invoices can show the code too.
const itemCols = db.prepare('PRAGMA table_info(bill_items)').all().map((c) => c.name);
if (!itemCols.includes('hsn')) db.exec('ALTER TABLE bill_items ADD COLUMN hsn TEXT');
if (!itemCols.includes('description')) db.exec('ALTER TABLE bill_items ADD COLUMN description TEXT');

// Migrate settings: add the dealer type. An existing profile that already has a
// GSTIN was clearly a registered dealer, so infer that rather than defaulting it
// to 'unregistered' and silently downgrading a live store to Bill of Supply.
const settingsCols = db.prepare('PRAGMA table_info(settings)').all().map((c) => c.name);
if (!settingsCols.includes('dealer_type')) {
  db.exec("ALTER TABLE settings ADD COLUMN dealer_type TEXT NOT NULL DEFAULT 'unregistered'");
  db.exec("UPDATE settings SET dealer_type = 'registered' WHERE TRIM(COALESCE(gstin, '')) <> ''");
}
for (const col of ['phone', 'email', 'website', 'social1', 'social2', 'social3']) {
  if (!settingsCols.includes(col)) db.exec(`ALTER TABLE settings ADD COLUMN ${col} TEXT`);
}

// Seed the single settings row.
if (!db.prepare('SELECT id FROM settings WHERE id = 1').get()) {
  db.prepare(
    'INSERT INTO settings (id, store_name, address, gstin, state, dealer_type) VALUES (1, ?, ?, ?, ?, ?)'
  ).run('My Store', '', '', '', 'unregistered');
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
