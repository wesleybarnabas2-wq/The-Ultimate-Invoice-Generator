const money = (n) => '₹' + Number(n).toFixed(2);

export default function Receipt({ receipt, settings, onNew, newLabel = '← New Bill' }) {
  const date = new Date(receipt.createdAt).toLocaleString('en-IN');
  const interstate = receipt.interstate;

  return (
    <div>
      <div className="receipt-actions no-print">
        <button className="secondary" onClick={onNew}>{newLabel}</button>
        <button className="primary" onClick={() => window.print()}>🖨 Print / Save PDF</button>
      </div>

      <div className="receipt">
        <div className="receipt-head">
          <h2>{settings?.store_name || 'My Store'}</h2>
          {settings?.address && <p className="muted small">{settings.address}</p>}
          {settings?.gstin && <p className="muted small">GSTIN: {settings.gstin}</p>}
          {settings?.state && <p className="muted small">{settings.state}</p>}
          <p className="muted">Tax Invoice</p>
        </div>

        <div className="receipt-meta">
          <div><strong>Invoice:</strong> {receipt.invoiceNo}</div>
          <div><strong>Date:</strong> {date}</div>
          <div><strong>Customer:</strong> {receipt.customer || 'Walk-in'}</div>
          {receipt.customerState && (
            <div><strong>Place of supply:</strong> {receipt.customerState}</div>
          )}
          <div><strong>Supply:</strong> {interstate ? 'Inter-state (IGST)' : 'Intra-state (CGST/SGST)'}</div>
        </div>

        <table className="receipt-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="num">Rate</th>
              <th className="num">Qty</th>
              <th className="num">Taxable</th>
              <th className="num">GST%</th>
              <th className="num">GST Amt</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {receipt.items.map((it, i) => (
              <tr key={i}>
                <td>{it.name}</td>
                <td className="num">{money(it.rate)}</td>
                <td className="num">{it.qty}</td>
                <td className="num">{money(it.taxable)}</td>
                <td className="num">{it.gst_rate}%</td>
                <td className="num">{money(it.gst_amount)}</td>
                <td className="num">{money(it.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="totals receipt-totals">
          <div><span>Taxable value</span><span>{money(receipt.subtotal)}</span></div>
          {interstate ? (
            <div><span>IGST</span><span>{money(receipt.igst)}</span></div>
          ) : (
            <>
              <div><span>CGST</span><span>{money(receipt.cgst)}</span></div>
              <div><span>SGST</span><span>{money(receipt.sgst)}</span></div>
            </>
          )}
          <div className="grand"><span>Grand Total</span><span>{money(receipt.total)}</span></div>
        </div>

        <p className="receipt-foot muted">Thank you for your business!</p>
      </div>
    </div>
  );
}
