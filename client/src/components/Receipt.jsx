const money = (n) => '₹' + Number(n).toFixed(2);

// `preview` renders the same invoice against an unsaved draft: no print/new
// actions, and the invoice number may not have been entered yet.
export default function Receipt({ receipt, settings, onNew, newLabel = '← New Bill', preview = false }) {
  const date = new Date(receipt.createdAt).toLocaleString('en-IN');
  // Bills created before this feature have no `gst` field → treat as GST invoices.
  const isGst = receipt.gst !== false;
  const interstate = receipt.interstate;
  // HSN (goods) / SAC (services) codes are optional — only show the column when
  // at least one line actually carries one.
  const showCodes = receipt.items.some((it) => it.hsn);
  // Store contact details and social links — every one of them is optional.
  const contact = [settings?.phone, settings?.email, settings?.website].filter(Boolean);
  const socials = [settings?.social1, settings?.social2, settings?.social3].filter(Boolean);

  return (
    <div>
      {!preview && (
        <div className="receipt-actions no-print">
          <button className="secondary" onClick={onNew}>{newLabel}</button>
          <button className="primary" onClick={() => window.print()}>🖨 Print / Save PDF</button>
        </div>
      )}

      <div className="receipt">
        <div className="receipt-head">
          <h2>{settings?.store_name || 'My Store'}</h2>
          {settings?.address && <p className="muted small">{settings.address}</p>}
          {settings?.gstin && <p className="muted small">GSTIN: {settings.gstin}</p>}
          {settings?.state && <p className="muted small">{settings.state}</p>}
          {contact.length > 0 && <p className="muted small">{contact.join(' · ')}</p>}
          <p className="muted">{isGst ? 'Tax Invoice' : 'Bill of Supply'}</p>
        </div>

        <div className="receipt-meta">
          <div><strong>Invoice:</strong> {receipt.invoiceNo || <span className="muted">not set yet</span>}</div>
          <div><strong>Date:</strong> {date}</div>
          {receipt.supplyType && (
            <div><strong>Supply type:</strong> {
              receipt.supplyType === 'services' ? 'Services'
                : receipt.supplyType === 'goods_services' ? 'Goods & Services'
                : 'Goods'
            }</div>
          )}
          <div><strong>Customer:</strong> {receipt.customer || 'Walk-in'}</div>
          {isGst && receipt.customerGstin && (
            <div><strong>Customer GSTIN:</strong> {receipt.customerGstin}</div>
          )}
          {isGst && receipt.customerAddress && (
            <div><strong>Address:</strong> {receipt.customerAddress}</div>
          )}
          {isGst && (receipt.customerCity || receipt.customerDistrict || receipt.customerPincode) && (
            <div className="muted small">
              {[receipt.customerCity, receipt.customerDistrict, receipt.customerPincode]
                .filter(Boolean).join(', ')}
            </div>
          )}
          {(receipt.customerPhone || receipt.customerEmail) && (
            <div className="muted small">
              {[receipt.customerPhone, receipt.customerEmail].filter(Boolean).join(' · ')}
            </div>
          )}
          {isGst && receipt.customerState && (
            <div><strong>Place of supply:</strong> {receipt.customerState}</div>
          )}
          {isGst && (
            <div><strong>Supply:</strong> {interstate ? 'Inter-state (IGST)' : 'Intra-state (CGST/SGST)'}</div>
          )}
        </div>

        <table className="receipt-table">
          <thead>
            <tr>
              <th>Item</th>
              {showCodes && <th>HSN/SAC</th>}
              <th className="num">Rate</th>
              <th className="num">Qty</th>
              <th className="num">{isGst ? 'Taxable' : 'Amount'}</th>
              {isGst && <th className="num">GST%</th>}
              {isGst && <th className="num">GST Amt</th>}
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((it, i) => (
              <tr key={i}>
                <td>
                  {it.name}
                  {it.description && <div className="muted small">{it.description}</div>}
                </td>
                {showCodes && <td>{it.hsn || '—'}</td>}
                <td className="num">{money(it.rate)}</td>
                <td className="num">{it.qty}</td>
                <td className="num">{money(it.taxable)}</td>
                {isGst && <td className="num">{it.gst_rate}%</td>}
                {isGst && <td className="num">{money(it.gst_amount)}</td>}
                <td className="num">{money(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="totals receipt-totals">
          <div><span>{isGst ? 'Taxable value' : 'Subtotal'}</span><span>{money(receipt.subtotal)}</span></div>
          {isGst && (interstate ? (
            <div><span>IGST</span><span>{money(receipt.igst)}</span></div>
          ) : (
            <>
              <div><span>CGST</span><span>{money(receipt.cgst)}</span></div>
              <div><span>SGST</span><span>{money(receipt.sgst)}</span></div>
            </>
          ))}
          <div className="grand"><span>Grand Total</span><span>{money(receipt.total)}</span></div>
        </div>

        <p className="receipt-foot muted">
          Thank you for your business!
          {socials.length > 0 && (
            <><br /><span className="small">{socials.join(' · ')}</span></>
          )}
        </p>
      </div>
    </div>
  );
}
