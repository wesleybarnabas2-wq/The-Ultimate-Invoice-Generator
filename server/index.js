import express from 'express';
import cors from 'cors';
import db from './db.js';

const app = express();
app.use(cors());
app.use(express.json());

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Normalize a stored bill (+ its items) into the same camelCase shape the
// POST /api/bills endpoint returns, so the receipt view is identical for
// freshly-created and historical bills.
function serializeBill(bill) {
  const items = db.prepare('SELECT * FROM bill_items WHERE bill_id = ?').all(bill.id);
  const interstate = !!bill.interstate;
  return {
    id: bill.id,
    invoiceNo: bill.invoice_no,
    createdAt: bill.created_at,
    customer: bill.customer,
    customerState: bill.customer_state,
    interstate,
    items: items.map((it) => ({
      name: it.name,
      hsn: it.hsn,
      rate: it.rate,
      gst_rate: it.gst_rate,
      qty: it.qty,
      taxable: it.taxable,
      gst_amount: it.gst_amount,
      total: it.total,
    })),
    subtotal: bill.subtotal,
    cgst: bill.cgst,
    sgst: bill.sgst,
    igst: bill.igst,
    totalGst: round2(bill.cgst + bill.sgst + bill.igst),
    total: bill.total,
  };
}

/* ------------------------------ Settings ------------------------------ */

app.get('/api/settings', (req, res) => {
  res.json(db.prepare('SELECT * FROM settings WHERE id = 1').get());
});

app.put('/api/settings', (req, res) => {
  const { store_name, address, gstin, state } = req.body;
  db.prepare(
    'UPDATE settings SET store_name=?, address=?, gstin=?, state=? WHERE id=1'
  ).run(store_name ?? '', address ?? '', gstin ?? '', state ?? '');
  res.json(db.prepare('SELECT * FROM settings WHERE id = 1').get());
});

/* ------------------------------ Products ------------------------------ */

app.get('/api/products', (req, res) => {
  const rows = db.prepare('SELECT * FROM products ORDER BY name').all();
  res.json(rows);
});

app.post('/api/products', (req, res) => {
  const { name, hsn, rate, gstRate } = req.body;
  if (!name || rate == null) {
    return res.status(400).json({ error: 'name and rate are required' });
  }
  const info = db
    .prepare('INSERT INTO products (name, hsn, rate, gst_rate) VALUES (?, ?, ?, ?)')
    .run(name, hsn ?? null, Number(rate), Number(gstRate) || 0);
  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(row);
});

app.put('/api/products/:id', (req, res) => {
  const { name, hsn, rate, gstRate } = req.body;
  const info = db
    .prepare('UPDATE products SET name=?, hsn=?, rate=?, gst_rate=? WHERE id=?')
    .run(name, hsn ?? null, Number(rate), Number(gstRate) || 0, Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id)));
});

app.delete('/api/products/:id', (req, res) => {
  const info = db.prepare('DELETE FROM products WHERE id = ?').run(Number(req.params.id));
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

/* -------------------------------- Bills ------------------------------- */

// Build a receipt from a list of { productId, qty }.
app.post('/api/bills', (req, res) => {
  const { items, customer, customerState = null, interstate = false } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items is required and must be non-empty' });
  }

  const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
  const lineItems = [];
  let subtotal = 0;
  let totalGst = 0;

  for (const { productId, qty } of items) {
    const p = getProduct.get(Number(productId));
    if (!p) return res.status(400).json({ error: `unknown product ${productId}` });
    const quantity = Number(qty);
    if (!(quantity > 0)) return res.status(400).json({ error: 'qty must be > 0' });

    const taxable = round2(p.rate * quantity);
    const gstAmount = round2((taxable * p.gst_rate) / 100);
    const lineTotal = round2(taxable + gstAmount);

    subtotal += taxable;
    totalGst += gstAmount;
    lineItems.push({
      name: p.name,
      hsn: p.hsn ?? null,
      rate: p.rate,
      gst_rate: p.gst_rate,
      qty: quantity,
      taxable,
      gst_amount: gstAmount,
      total: lineTotal,
    });
  }

  subtotal = round2(subtotal);
  totalGst = round2(totalGst);
  // Inter-state sale → single IGST. Intra-state → split into CGST + SGST.
  const igst = interstate ? totalGst : 0;
  const cgst = interstate ? 0 : round2(totalGst / 2);
  const sgst = interstate ? 0 : round2(totalGst / 2);
  const total = round2(subtotal + cgst + sgst + igst);

  const now = new Date();
  const invoiceNo = 'INV-' + now.getFullYear() + '-' + String(Date.now()).slice(-6);

  const billInfo = db
    .prepare(
      `INSERT INTO bills (invoice_no, created_at, customer, customer_state, subtotal, cgst, sgst, igst, interstate, total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(invoiceNo, now.toISOString(), customer ?? null, customerState ?? null, subtotal, cgst, sgst, igst, interstate ? 1 : 0, total);

  const billId = billInfo.lastInsertRowid;
  const insertItem = db.prepare(
    `INSERT INTO bill_items (bill_id, name, hsn, rate, gst_rate, qty, taxable, gst_amount, total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const li of lineItems) {
    insertItem.run(billId, li.name, li.hsn, li.rate, li.gst_rate, li.qty, li.taxable, li.gst_amount, li.total);
  }

  res.status(201).json(serializeBill(db.prepare('SELECT * FROM bills WHERE id = ?').get(billId)));
});

app.get('/api/bills', (req, res) => {
  const rows = db.prepare('SELECT * FROM bills ORDER BY id DESC').all();
  res.json(rows);
});

app.get('/api/bills/:id', (req, res) => {
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(Number(req.params.id));
  if (!bill) return res.status(404).json({ error: 'not found' });
  res.json(serializeBill(bill));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Billing API running on http://localhost:${PORT}`));
