import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { STATES } from '../states.js';
import Receipt from './Receipt.jsx';

export default function Billing({ settings }) {
  const [products, setProducts] = useState([]);
  const [cart, setCart] = useState([]); // [{ productId, qty }]
  const [selected, setSelected] = useState('');
  const [qty, setQty] = useState(1);
  const [customer, setCustomer] = useState('');
  const [customerState, setCustomerState] = useState('');
  const [gstInvoice, setGstInvoice] = useState(true);
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');

  const homeState = settings?.state || '';
  // Inter-state (IGST) is auto-derived: customer state set AND different from home.
  // Never applies to a non-GST bill (Bill of Supply) — no tax to charge.
  const interstate = gstInvoice && !!customerState && !!homeState && customerState !== homeState;

  useEffect(() => {
    api.listProducts().then((p) => {
      setProducts(p);
      if (p.length) setSelected(String(p[0].id));
    }).catch((e) => setError(e.message));
  }, []);

  const byId = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p])),
    [products]
  );

  const addToCart = () => {
    if (!selected) return;
    const id = Number(selected);
    const q = Number(qty);
    if (!(q > 0)) return;
    setCart((c) => {
      const existing = c.find((i) => i.productId === id);
      if (existing) {
        return c.map((i) => (i.productId === id ? { ...i, qty: i.qty + q } : i));
      }
      return [...c, { productId: id, qty: q }];
    });
    setQty(1);
  };

  const updateQty = (id, q) =>
    setCart((c) => c.map((i) => (i.productId === id ? { ...i, qty: Number(q) } : i)));
  const removeItem = (id) => setCart((c) => c.filter((i) => i.productId !== id));

  // Live preview totals (mirrors the server GST math).
  const totals = useMemo(() => {
    let subtotal = 0, gst = 0;
    for (const item of cart) {
      const p = byId[item.productId];
      if (!p) continue;
      const taxable = p.rate * item.qty;
      subtotal += taxable;
      if (gstInvoice) gst += (taxable * p.gst_rate) / 100;
    }
    const igst = interstate ? gst : 0;
    const cgst = interstate ? 0 : gst / 2;
    return { subtotal, cgst, sgst: cgst, igst, total: subtotal + gst };
  }, [cart, byId, interstate, gstInvoice]);

  const generate = async () => {
    setError('');
    try {
      const r = await api.createBill({
        items: cart.map((i) => ({ productId: i.productId, qty: i.qty })),
        customer: customer.trim() || null,
        customerState: customerState || null,
        interstate,
        gst: gstInvoice,
      });
      setReceipt(r);
    } catch (e) {
      setError(e.message);
    }
  };

  const newBill = () => {
    setReceipt(null);
    setCart([]);
    setCustomer('');
    setCustomerState('');
    setGstInvoice(true);
  };

  if (receipt) return <Receipt receipt={receipt} settings={settings} onNew={newBill} />;

  return (
    <div className="grid">
      <section className="card no-print">
        <h2>Add items</h2>
        {error && <p className="error">{error}</p>}
        <label>Invoice type
          <select value={gstInvoice ? 'gst' : 'nongst'}
            onChange={(e) => setGstInvoice(e.target.value === 'gst')}>
            <option value="gst">Tax Invoice (with GST)</option>
            <option value="nongst">Bill of Supply (non-GST)</option>
          </select>
        </label>
        <label>Customer (optional)
          <input value={customer} onChange={(e) => setCustomer(e.target.value)}
            placeholder="Walk-in" />
        </label>
        {gstInvoice ? (
          <>
            <label>Customer state (place of supply)
              <select value={customerState} onChange={(e) => setCustomerState(e.target.value)}>
                <option value="">— Select —</option>
                {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            {!homeState && (
              <p className="muted small">Set your home state in Settings to enable auto IGST/CGST detection.</p>
            )}
            {homeState && customerState && (
              <p className={interstate ? 'badge interstate' : 'badge intrastate'}>
                {interstate
                  ? `Inter-state supply → IGST (${customerState} ≠ ${homeState})`
                  : `Intra-state supply → CGST + SGST (${customerState})`}
              </p>
            )}
          </>
        ) : (
          <p className="muted small">No GST will be charged on this bill (Bill of Supply).</p>
        )}
        <div className="add-row">
          <label className="grow">Product
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — ₹{p.rate.toFixed(2)} ({p.gst_rate}% GST)
                </option>
              ))}
            </select>
          </label>
          <label className="qty">Qty
            <input type="number" min="1" step="1" value={qty}
              onChange={(e) => setQty(e.target.value)} />
          </label>
          <button onClick={addToCart} disabled={!products.length}>Add</button>
        </div>
        {!products.length && (
          <p className="muted">No products found. Add some in the Products tab first.</p>
        )}
      </section>

      <section className="card">
        <h2>Current bill</h2>
        <table>
          <thead>
            <tr>
              <th>Item</th><th className="num">Rate</th><th className="num">Qty</th>
              {gstInvoice && <th className="num">GST</th>}<th className="num">Amount</th><th></th>
            </tr>
          </thead>
          <tbody>
            {cart.map((item) => {
              const p = byId[item.productId];
              if (!p) return null;
              const taxable = p.rate * item.qty;
              const lineTotal = gstInvoice ? taxable * (1 + p.gst_rate / 100) : taxable;
              return (
                <tr key={item.productId}>
                  <td>{p.name}</td>
                  <td className="num">₹{p.rate.toFixed(2)}</td>
                  <td className="num">
                    <input className="qty-inline" type="number" min="1" value={item.qty}
                      onChange={(e) => updateQty(item.productId, e.target.value)} />
                  </td>
                  {gstInvoice && <td className="num">{p.gst_rate}%</td>}
                  <td className="num">₹{lineTotal.toFixed(2)}</td>
                  <td><button className="link danger no-print"
                    onClick={() => removeItem(item.productId)}>✕</button></td>
                </tr>
              );
            })}
            {cart.length === 0 && (
              <tr><td colSpan={gstInvoice ? 6 : 5} className="muted">No items added.</td></tr>
            )}
          </tbody>
        </table>

        <div className="totals">
          <div><span>{gstInvoice ? 'Taxable value' : 'Subtotal'}</span><span>₹{totals.subtotal.toFixed(2)}</span></div>
          {gstInvoice && (interstate ? (
            <div><span>IGST</span><span>₹{totals.igst.toFixed(2)}</span></div>
          ) : (
            <>
              <div><span>CGST</span><span>₹{totals.cgst.toFixed(2)}</span></div>
              <div><span>SGST</span><span>₹{totals.sgst.toFixed(2)}</span></div>
            </>
          ))}
          <div className="grand"><span>Total</span><span>₹{totals.total.toFixed(2)}</span></div>
        </div>

        <button className="primary block no-print" disabled={!cart.length}
          onClick={generate}>
          Generate Receipt
        </button>
      </section>
    </div>
  );
}
