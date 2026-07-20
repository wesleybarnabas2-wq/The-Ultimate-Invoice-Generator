import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import Receipt from './Receipt.jsx';

const GST_SLABS = [0, 5, 12, 18, 28];
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random());

export default function Billing({ settings }) {
  const [products, setProducts] = useState([]);
  // Cart holds two kinds of line: products and ad-hoc services.
  //  product → { key, kind:'product', productId, qty }
  //  service → { key, kind:'service', name, description, amount, gstRate }
  const [cart, setCart] = useState([]);
  // Prefilled with the next number in the series, but freely editable — the one
  // thing it may not be is empty.
  const [invoiceNo, setInvoiceNo] = useState('');
  const [selected, setSelected] = useState('');
  const [qty, setQty] = useState(1);
  // Service entry fields.
  const [svcName, setSvcName] = useState('');
  const [svcDesc, setSvcDesc] = useState('');
  const [svcSac, setSvcSac] = useState(''); // SAC code — the services counterpart of HSN
  const [svcAmount, setSvcAmount] = useState('');
  const [svcGst, setSvcGst] = useState(18);
  const [customer, setCustomer] = useState('');
  const [customerGstin, setCustomerGstin] = useState('');
  // Customer details autofilled from the GSTIN lookup (all editable afterwards).
  const [custAddress, setCustAddress] = useState('');
  const [custCity, setCustCity] = useState('');
  const [custDistrict, setCustDistrict] = useState('');
  const [custStateName, setCustStateName] = useState('');
  const [custPincode, setCustPincode] = useState('');
  // Contact details aren't part of the GST record, so they stay editable.
  const [custPhone, setCustPhone] = useState('');
  const [custEmail, setCustEmail] = useState('');
  // Details that came back from the GST database are authoritative — they lock
  // once fetched, and only the GSTIN itself stays editable.
  const [custLocked, setCustLocked] = useState(false);
  const [gstLoading, setGstLoading] = useState(false);
  const [gstStatus, setGstStatus] = useState('');
  const [gstError, setGstError] = useState('');
  const [supplyType, setSupplyType] = useState('goods'); // 'goods' | 'services' | 'goods_services'
  const [gstInvoice, setGstInvoice] = useState(true);
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState('');

  const showServices = supplyType !== 'goods';

  // Only a GST-registered dealer may issue a Tax Invoice. `settings` arrives
  // async, so treat "not loaded yet" as unregistered and let the effect below
  // open things up once we actually know.
  const dealerRegistered = settings?.dealer_type === 'registered';

  const homeState = settings?.state || '';
  // Place of supply is the customer's State (autofilled from GSTIN, editable).
  // Inter-state (IGST) is auto-derived: that state is set AND differs from home.
  // Never applies to a non-GST bill (Bill of Supply) — no tax to charge.
  const custState = custStateName.trim();
  const interstate = gstInvoice && !!custState && !!homeState &&
    custState.toLowerCase() !== homeState.toLowerCase();

  // Force an unregistered dealer onto Bill of Supply, and clear any GST-only
  // customer fields that were filled in before the profile changed.
  useEffect(() => {
    if (settings && !dealerRegistered) {
      setGstInvoice(false);
      setCustomerGstin('');
    }
  }, [settings, dealerRegistered]);

  // Suggest the next number in the series. A failure here is not worth an error
  // banner — the field is simply left blank for the user to fill in.
  const suggestInvoiceNo = () =>
    api.nextInvoiceNo()
      .then(({ invoiceNo: next }) => setInvoiceNo(next || ''))
      .catch(() => {});

  useEffect(() => { suggestInvoiceNo(); }, []);

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

  // Only offer catalog entries that match the supply type being billed.
  const catalog = useMemo(() => products.filter((p) => {
    const kind = p.kind || 'goods';
    if (supplyType === 'goods') return kind === 'goods';
    if (supplyType === 'services') return kind === 'service';
    return true;
  }), [products, supplyType]);

  // Keep the picker on a valid entry when the catalog narrows.
  useEffect(() => {
    if (!catalog.some((p) => String(p.id) === String(selected))) {
      setSelected(catalog.length ? String(catalog[0].id) : '');
    }
  }, [catalog, selected]);

  // Resolve a cart line into displayable/computable values (rate, qty, gst%, taxable).
  const lineOf = (item) => {
    if (item.kind === 'service') {
      const rate = Number(item.amount) || 0;
      return {
        name: item.name,
        description: item.description || '',
        hsn: item.sac || '',
        rate,
        qty: 1,
        gstRate: gstInvoice ? Number(item.gstRate) || 0 : 0,
        taxable: rate,
      };
    }
    const p = byId[item.productId];
    if (!p) return null;
    return {
      name: p.name,
      description: '',
      hsn: p.hsn || '',
      rate: p.rate,
      qty: item.qty,
      gstRate: gstInvoice ? p.gst_rate : 0,
      taxable: p.rate * item.qty,
    };
  };

  const addToCart = () => {
    if (!selected) return;
    const id = Number(selected);
    const q = Number(qty);
    if (!(q > 0)) return;
    setCart((c) => {
      const existing = c.find((i) => i.kind === 'product' && i.productId === id);
      if (existing) {
        return c.map((i) =>
          i.kind === 'product' && i.productId === id ? { ...i, qty: i.qty + q } : i);
      }
      return [...c, { key: uid(), kind: 'product', productId: id, qty: q }];
    });
    setQty(1);
  };

  const addService = () => {
    const name = svcName.trim();
    const amount = Number(svcAmount);
    if (!name) { setError('Service name is required.'); return; }
    if (!(amount > 0)) { setError('Service amount must be greater than 0.'); return; }
    setError('');
    setCart((c) => [...c, {
      key: uid(), kind: 'service', name,
      description: svcDesc.trim(), sac: svcSac.trim(), amount,
      gstRate: Number(svcGst) || 0,
    }]);
    setSvcName(''); setSvcDesc(''); setSvcSac(''); setSvcAmount(''); setSvcGst(18);
  };

  const updateQty = (key, q) =>
    setCart((c) => c.map((i) => (i.key === key ? { ...i, qty: Number(q) } : i)));
  const removeItem = (key) => setCart((c) => c.filter((i) => i.key !== key));

  // Whether a cart line is goods or a service. Ad-hoc lines say so directly;
  // a catalog line inherits it from the catalog entry, so a catalogued service
  // counts as a service even though it is a 'product' line.
  const kindOfLine = (i) =>
    i.kind === 'service' ? 'service' : (byId[i.productId]?.kind || 'goods');

  // Switching supply type drops lines that no longer belong (goods-only clears
  // services and vice-versa); 'goods_services' keeps everything.
  const changeSupplyType = (value) => {
    setSupplyType(value);
    if (value === 'goods') setCart((c) => c.filter((i) => kindOfLine(i) === 'goods'));
    else if (value === 'services') setCart((c) => c.filter((i) => kindOfLine(i) === 'service'));
  };

  // Live preview totals (mirrors the server GST math).
  const totals = useMemo(() => {
    let subtotal = 0, gst = 0;
    for (const item of cart) {
      const l = lineOf(item);
      if (!l) continue;
      subtotal += l.taxable;
      gst += (l.taxable * l.gstRate) / 100;
    }
    const igst = interstate ? gst : 0;
    const cgst = interstate ? 0 : gst / 2;
    return { subtotal, cgst, sgst: cgst, igst, total: subtotal + gst };
  }, [cart, byId, interstate, gstInvoice]);

  const gstinValid = GSTIN_REGEX.test(customerGstin);

  // Fetch live GST registration details and autofill the customer fields.
  const verifyGstin = async () => {
    if (gstLoading || !gstinValid) return; // block duplicate / invalid requests
    setGstLoading(true);
    setGstError('');
    setGstStatus('');
    try {
      const { customer: c } = await api.lookupGstin(customerGstin);
      // Autofill only the six approved fields — nothing else is touched.
      if (c.tradeName) setCustomer(c.tradeName);
      setCustAddress(c.registeredAddress || '');
      setCustCity(c.city || '');
      setCustDistrict(c.district || '');
      setCustStateName(c.state || '');
      setCustPincode(c.pincode || '');
      setCustLocked(true);
      setGstStatus('GST details fetched.');
    } catch (e) {
      setGstError(e.message || 'GST details could not be retrieved. Please try again.');
    } finally {
      setGstLoading(false);
    }
  };

  const generate = async () => {
    setError('');
    if (!invoiceNo.trim()) {
      setError('Invoice number is required.');
      return;
    }
    if (gstInvoice && !customerGstin.trim()) {
      setError('Customer GSTIN is required for a Tax Invoice.');
      return;
    }
    try {
      const r = await api.createBill({
        invoiceNo: invoiceNo.trim(),
        items: cart.map((i) =>
          i.kind === 'service'
            ? { name: i.name, description: i.description || null, hsn: i.sac || null, amount: Number(i.amount), gstRate: Number(i.gstRate) || 0 }
            : { productId: i.productId, qty: i.qty }),
        customer: customer.trim() || null,
        customerState: gstInvoice ? (custState || null) : null,
        customerGstin: gstInvoice ? (customerGstin.trim() || null) : null,
        customerDetails: {
          // Address fields come from the GST record — Tax Invoice only.
          ...(gstInvoice ? {
            registeredAddress: custAddress.trim(),
            city: custCity.trim(),
            district: custDistrict.trim(),
            state: custStateName.trim(),
            pincode: custPincode.trim(),
          } : {}),
          // Contact details are typed in, so they apply to either bill type.
          phone: custPhone.trim(),
          email: custEmail.trim(),
        },
        supplyType,
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
    suggestInvoiceNo(); // the bill just saved advances the series
    setCustomer('');
    setCustomerGstin('');
    setCustAddress(''); setCustCity(''); setCustDistrict(''); setCustStateName(''); setCustPincode('');
    setCustPhone(''); setCustEmail('');
    setCustLocked(false);
    setGstStatus(''); setGstError('');
    setSupplyType('goods');
    setGstInvoice(dealerRegistered); // an unregistered dealer stays on Bill of Supply
    setSvcName(''); setSvcDesc(''); setSvcSac(''); setSvcAmount(''); setSvcGst(18);
  };

  if (receipt) return <Receipt receipt={receipt} settings={settings} onNew={newBill} />;

  const colSpan = gstInvoice ? 6 : 5;

  // The live preview renders the real Receipt component against the in-progress
  // bill, shaped exactly like a saved one so both go through the same markup.
  const draft = {
    invoiceNo: invoiceNo.trim() || null, // blank → preview shows a placeholder
    createdAt: new Date().toISOString(),
    customer: customer.trim() || null,
    customerGstin: gstInvoice ? customerGstin.trim() : null,
    customerState: gstInvoice ? custState : null,
    customerAddress: gstInvoice ? custAddress : null,
    customerCity: gstInvoice ? custCity : null,
    customerDistrict: gstInvoice ? custDistrict : null,
    customerPincode: gstInvoice ? custPincode : null,
    customerPhone: custPhone.trim() || null,
    customerEmail: custEmail.trim() || null,
    supplyType,
    gst: gstInvoice,
    interstate,
    items: cart.map(lineOf).filter(Boolean).map((l) => {
      const gstAmount = (l.taxable * l.gstRate) / 100;
      return {
        name: l.name, description: l.description, hsn: l.hsn,
        rate: l.rate, qty: l.qty, gst_rate: l.gstRate,
        taxable: l.taxable, gst_amount: gstAmount, total: l.taxable + gstAmount,
      };
    }),
    subtotal: totals.subtotal, cgst: totals.cgst, sgst: totals.sgst,
    igst: totals.igst, total: totals.total,
  };

  return (
    <div className="grid grid-3">
      {/* 1 — who the invoice is made out to */}
      <section className="card no-print">
        <h2>Recipient details</h2>
        {error && <p className="error">{error}</p>}
        {settings && (dealerRegistered ? (
          <label>Invoice type
            <select value={gstInvoice ? 'gst' : 'nongst'}
              onChange={(e) => {
                const isGst = e.target.value === 'gst';
                setGstInvoice(isGst);
                if (isGst) setCustomer(''); // Tax Invoice has no customer-name field
              }}>
              <option value="gst">Tax Invoice (with GST)</option>
              <option value="nongst">Bill of Supply (non-GST)</option>
            </select>
          </label>
        ) : (
          <p className="muted small">
            Invoice type: <strong>Bill of Supply (non-GST)</strong> — your profile
            is set to Unregistered, so no GST can be charged. Switch to
            “Registered dealer” in My Profile to issue Tax Invoices.
          </p>
        ))}
        {!gstInvoice && (
          <label>Customer (optional)
            <input value={customer} onChange={(e) => setCustomer(e.target.value)}
              placeholder="Walk-in" />
          </label>
        )}
        {gstInvoice ? (
          <>
            <div className="add-row">
              <label className="grow">Customer GSTIN (required)
                <input value={customerGstin} required
                  onChange={(e) => {
                    // Uppercase, strip anything non-alphanumeric, cap at 15.
                    setCustomerGstin(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15));
                    setGstStatus(''); setGstError('');
                    // The fetched details belong to the old GSTIN — drop them.
                    if (custLocked) {
                      setCustLocked(false);
                      setCustomer(''); setCustAddress(''); setCustCity('');
                      setCustDistrict(''); setCustStateName(''); setCustPincode('');
                    }
                  }}
                  placeholder="e.g. 29ABCDE1234F1Z5" maxLength={15} />
              </label>
              <button type="button" onClick={verifyGstin} disabled={!gstinValid || gstLoading}>
                {gstLoading ? 'Verifying…' : 'Verify GSTIN'}
              </button>
            </div>
            {gstStatus && <p className="success small">{gstStatus}</p>}
            {gstError && <p className="error">{gstError}</p>}
            {custLocked && (
              <p className="muted small">
                Fetched from the GST database — edit the GSTIN above to change them.
              </p>
            )}
            <label>Trade name
              <input value={customer} readOnly={custLocked}
                onChange={(e) => setCustomer(e.target.value)}
                placeholder="Verify the GSTIN to fill this in" />
            </label>
            <label>Registered address
              <textarea rows="2" value={custAddress} readOnly={custLocked}
                onChange={(e) => setCustAddress(e.target.value)}
                placeholder="Verify the GSTIN to fill this in" />
            </label>
            <div className="add-row">
              <label className="grow">City / locality
                <input value={custCity} readOnly={custLocked}
                  onChange={(e) => setCustCity(e.target.value)} />
              </label>
              <label className="grow">District
                <input value={custDistrict} readOnly={custLocked}
                  onChange={(e) => setCustDistrict(e.target.value)} />
              </label>
            </div>
            <div className="add-row">
              <label className="grow">State
                <input value={custStateName} readOnly={custLocked}
                  onChange={(e) => setCustStateName(e.target.value)} />
              </label>
              <label className="qty">PIN code
                <input value={custPincode} readOnly={custLocked}
                  onChange={(e) => setCustPincode(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))} />
              </label>
            </div>
            {!homeState && (
              <p className="muted small">Set your home state in Settings to enable auto IGST/CGST detection.</p>
            )}
            {homeState && custState && (
              <p className={interstate ? 'badge interstate' : 'badge intrastate'}>
                {interstate
                  ? `Inter-state supply → IGST (${custState} ≠ ${homeState})`
                  : `Intra-state supply → CGST + SGST (${custState})`}
              </p>
            )}
          </>
        ) : (
          <p className="muted small">No GST will be charged on this bill (Bill of Supply).</p>
        )}

        <div className="add-row">
          <label className="grow">Phone (optional)
            <input type="tel" value={custPhone} maxLength={20}
              onChange={(e) => setCustPhone(e.target.value)}
              placeholder="e.g. +91 98765 43210" />
          </label>
          <label className="grow">Email (optional)
            <input type="email" value={custEmail} maxLength={120}
              onChange={(e) => setCustEmail(e.target.value)}
              placeholder="e.g. name@example.com" />
          </label>
        </div>
      </section>

      {/* 2 — what is being supplied */}
      <section className="card no-print">
        <h2>Invoice Particulars</h2>
        <label>Invoice number (required)
          <input value={invoiceNo} required maxLength={32}
            onChange={(e) => setInvoiceNo(e.target.value)}
            placeholder="e.g. GB/2026-27/001" />
          {!invoiceNo.trim() && (
            <span className="error small">An invoice number is required.</span>
          )}
        </label>
        <label>Supply type
          <select value={supplyType} onChange={(e) => changeSupplyType(e.target.value)}>
            <option value="goods">Goods</option>
            <option value="services">Services</option>
            <option value="goods_services">Goods &amp; Services</option>
          </select>
        </label>

        <div className="add-row">
          <label className="grow">From catalog
            <select value={selected} onChange={(e) => setSelected(e.target.value)}>
              {catalog.map((p) => (
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
          <button onClick={addToCart} disabled={!catalog.length}>Add</button>
        </div>
        {!catalog.length && (
          <p className="muted small">
            Nothing catalogued for this supply type — add it in the Catalog tab.
          </p>
        )}

        {showServices && (
          <div className="service-entry">
            {supplyType === 'goods_services' && <h3 className="section-sub">Add a service</h3>}
            <label>Service name
              <input value={svcName} onChange={(e) => setSvcName(e.target.value)}
                placeholder="e.g. Consulting" />
            </label>
            <label>Service description (optional)
              <textarea rows="2" value={svcDesc}
                onChange={(e) => setSvcDesc(e.target.value)}
                placeholder="Details of the service rendered" />
            </label>
            <label>SAC code (optional)
              <input value={svcSac} onChange={(e) => setSvcSac(e.target.value)}
                placeholder="e.g. 998313" />
            </label>
            <div className="add-row">
              <label className="grow">Amount (₹)
                <input type="number" min="0" step="0.01" value={svcAmount}
                  onChange={(e) => setSvcAmount(e.target.value)} placeholder="0.00" />
              </label>
              {gstInvoice && (
                <label className="qty">GST %
                  <select value={svcGst} onChange={(e) => setSvcGst(Number(e.target.value))}>
                    {GST_SLABS.map((g) => <option key={g} value={g}>{g}%</option>)}
                  </select>
                </label>
              )}
              <button onClick={addService}>Add service</button>
            </div>
          </div>
        )}

        <h3 className="section-sub">Current bill</h3>
        <table>
          <thead>
            <tr>
              <th>Item</th><th className="num">Rate</th><th className="num">Qty</th>
              {gstInvoice && <th className="num">GST</th>}<th className="num">Amount</th><th></th>
            </tr>
          </thead>
          <tbody>
            {cart.map((item) => {
              const l = lineOf(item);
              if (!l) return null;
              const lineTotal = l.taxable * (1 + l.gstRate / 100);
              return (
                <tr key={item.key}>
                  <td>
                    {l.name}
                    {l.description && <div className="muted small">{l.description}</div>}
                  </td>
                  <td className="num">₹{l.rate.toFixed(2)}</td>
                  <td className="num">
                    {item.kind === 'product' ? (
                      <input className="qty-inline" type="number" min="1" value={item.qty}
                        onChange={(e) => updateQty(item.key, e.target.value)} />
                    ) : l.qty}
                  </td>
                  {gstInvoice && <td className="num">{l.gstRate}%</td>}
                  <td className="num">₹{lineTotal.toFixed(2)}</td>
                  <td><button className="link danger no-print"
                    onClick={() => removeItem(item.key)}>✕</button></td>
                </tr>
              );
            })}
            {cart.length === 0 && (
              <tr><td colSpan={colSpan} className="muted">No items added.</td></tr>
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

        <button className="primary block no-print"
          disabled={!cart.length || !invoiceNo.trim() || (gstInvoice && !customerGstin.trim())}
          onClick={generate}>
          Generate Receipt
        </button>
      </section>

      {/* 3 — live preview of the invoice that will be produced */}
      <section className="card preview-pane no-print">
        <h2>Invoice preview</h2>
        {cart.length === 0 ? (
          <p className="muted small">Add an item to see the invoice take shape.</p>
        ) : (
          <Receipt receipt={draft} settings={settings} preview />
        )}
      </section>
    </div>
  );
}
