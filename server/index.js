import express from 'express';
import cors from 'cors';
import db from './db.js';
import { createSandboxClient } from './sandbox.js';
import { normalizeGstin, isValidGstin, mapSandboxResponse, isEmptyCustomer } from './gstin.js';

// Load server-only secrets from server/.env if present (never bundled/exposed).
try { process.loadEnvFile(new URL('./.env', import.meta.url)); } catch { /* no .env — use real env */ }

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
    customerGstin: bill.customer_gstin,
    customerAddress: bill.cust_address,
    customerCity: bill.cust_city,
    customerDistrict: bill.cust_district,
    customerPincode: bill.cust_pincode,
    supplyType: bill.supply_type || 'goods',
    interstate,
    gst: bill.gst == null ? true : !!bill.gst,
    items: items.map((it) => ({
      name: it.name,
      description: it.description ?? null,
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
  const { items, customer, customerState = null, customerGstin = null, customerDetails = {}, supplyType = 'goods', interstate = false, gst = true } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items is required and must be non-empty' });
  }
  // A Tax Invoice must carry the customer's GSTIN.
  if (gst && !(customerGstin && String(customerGstin).trim())) {
    return res.status(400).json({ error: 'customerGstin is required for a Tax Invoice' });
  }

  const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
  const lineItems = [];
  let subtotal = 0;
  let totalGst = 0;

  for (const item of items) {
    // Two kinds of line: a product reference ({ productId, qty }) or an
    // ad-hoc service ({ name, description, amount, gstRate }, no productId).
    let name, description, hsn, rate, quantity, itemGstRate;

    if (item.productId != null) {
      const p = getProduct.get(Number(item.productId));
      if (!p) return res.status(400).json({ error: `unknown product ${item.productId}` });
      quantity = Number(item.qty);
      if (!(quantity > 0)) return res.status(400).json({ error: 'qty must be > 0' });
      name = p.name;
      description = null;
      hsn = p.hsn ?? null;
      rate = p.rate;
      itemGstRate = p.gst_rate;
    } else {
      name = (item.name || '').trim();
      if (!name) return res.status(400).json({ error: 'service name is required' });
      const amount = Number(item.amount);
      if (!(amount > 0)) return res.status(400).json({ error: 'service amount must be > 0' });
      description = item.description ? String(item.description).trim() || null : null;
      hsn = null;
      rate = amount;
      quantity = 1;
      itemGstRate = Number(item.gstRate) || 0;
    }

    // Non-GST bills (Bill of Supply) charge no tax regardless of the rate.
    const effectiveGstRate = gst ? itemGstRate : 0;
    const taxable = round2(rate * quantity);
    const gstAmount = round2((taxable * effectiveGstRate) / 100);
    const lineTotal = round2(taxable + gstAmount);

    subtotal += taxable;
    totalGst += gstAmount;
    lineItems.push({
      name,
      description,
      hsn,
      rate,
      gst_rate: effectiveGstRate,
      qty: quantity,
      taxable,
      gst_amount: gstAmount,
      total: lineTotal,
    });
  }

  subtotal = round2(subtotal);
  totalGst = round2(totalGst);
  // A non-GST bill (Bill of Supply) is never inter-state — there's no tax to split.
  const isInterstate = gst && interstate;
  // Inter-state sale → single IGST. Intra-state → split into CGST + SGST.
  const igst = isInterstate ? totalGst : 0;
  const cgst = isInterstate ? 0 : round2(totalGst / 2);
  const sgst = isInterstate ? 0 : round2(totalGst / 2);
  const total = round2(subtotal + cgst + sgst + igst);

  const now = new Date();
  const invoiceNo = 'INV-' + now.getFullYear() + '-' + String(Date.now()).slice(-6);

  // Customer GSTIN only applies to a Tax Invoice (Bill of Supply charges no GST).
  const custGstin = gst ? (customerGstin || null) : null;
  const supply = ['services', 'goods_services'].includes(supplyType) ? supplyType : 'goods';
  // Customer address details (from the GSTIN lookup, possibly edited) — Tax Invoice only.
  const cd = gst && customerDetails ? customerDetails : {};
  const trimOrNull = (v) => (v && String(v).trim() ? String(v).trim() : null);
  const custAddress = trimOrNull(cd.registeredAddress);
  const custCity = trimOrNull(cd.city);
  const custDistrict = trimOrNull(cd.district);
  const custPincode = trimOrNull(cd.pincode);

  const billInfo = db
    .prepare(
      `INSERT INTO bills (invoice_no, created_at, customer, customer_state, customer_gstin, supply_type, cust_address, cust_city, cust_district, cust_pincode, subtotal, cgst, sgst, igst, interstate, gst, total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(invoiceNo, now.toISOString(), customer ?? null, customerState ?? null, custGstin, supply, custAddress, custCity, custDistrict, custPincode, subtotal, cgst, sgst, igst, isInterstate ? 1 : 0, gst ? 1 : 0, total);

  const billId = billInfo.lastInsertRowid;
  const insertItem = db.prepare(
    `INSERT INTO bill_items (bill_id, name, description, hsn, rate, gst_rate, qty, taxable, gst_amount, total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const li of lineItems) {
    insertItem.run(billId, li.name, li.description ?? null, li.hsn, li.rate, li.gst_rate, li.qty, li.taxable, li.gst_amount, li.total);
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

/* ----------------------------- GST lookup ----------------------------- */

// Single shared Sandbox client so the access token is cached across requests.
const sandbox = createSandboxClient({
  baseUrl: process.env.SANDBOX_BASE_URL || 'https://api.sandbox.co.in',
  apiKey: process.env.SANDBOX_API_KEY || '',
  apiSecret: process.env.SANDBOX_API_SECRET || '',
});

// Coded error → [http status, user-facing message]. No provider detail leaks.
const GST_ERRORS = {
  INVALID_FORMAT: [400, 'Enter a valid 15-character GSTIN.'],
  NOT_FOUND:      [404, 'No GST registration details were found for this GSTIN.'],
  AUTH_FAILED:    [503, 'GST verification is temporarily unavailable.'],
  SUBSCRIPTION:   [503, 'GST lookup is currently unavailable. Please contact support.'],
  RATE_LIMIT:     [429, 'Too many GST lookup requests. Please try again shortly.'],
  TIMEOUT:        [504, 'The GST lookup took too long. Please try again.'],
  NETWORK:        [502, 'Unable to connect to the GST verification service.'],
  UPSTREAM:       [502, 'GST details could not be retrieved. Please try again.'],
};

// Look up live GST registration details and return ONLY the six approved fields.
app.post('/api/gst/lookup', async (req, res) => {
  const gstin = normalizeGstin(req.body?.gstin);
  if (!isValidGstin(gstin)) {
    const [status, error] = GST_ERRORS.INVALID_FORMAT;
    return res.status(status).json({ success: false, error });
  }
  try {
    const raw = await sandbox.searchGstin(gstin);
    const customer = mapSandboxResponse(raw); // exactly six fields
    if (isEmptyCustomer(customer)) {
      const [status, error] = GST_ERRORS.NOT_FOUND;
      return res.status(status).json({ success: false, error });
    }
    return res.json({ success: true, customer });
  } catch (e) {
    const code = (e && GST_ERRORS[e.code]) ? e.code : 'UPSTREAM';
    // Log the code only — never headers, tokens, secrets, or the raw response.
    console.error(`[gst/lookup] failed: ${code}`);
    const [status, error] = GST_ERRORS[code];
    return res.status(status).json({ success: false, error });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Billing API running on http://localhost:${PORT}`));
