import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Receipt from './Receipt.jsx';

export default function History({ settings }) {
  const [bills, setBills] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');

  const load = () => api.listBills().then(setBills).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const open = async (id) => {
    try {
      setSelected(await api.getBill(id));
    } catch (e) {
      setError(e.message);
    }
  };

  if (selected) {
    return <Receipt receipt={selected} settings={settings} onNew={() => setSelected(null)} newLabel="← Back to history" />;
  }

  return (
    <section className="card">
      <h2>Saved bills ({bills.length})</h2>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Invoice</th><th>Date</th><th>Customer</th>
            <th className="num">Tax</th><th className="num">Total</th><th></th>
          </tr>
        </thead>
        <tbody>
          {bills.map((b) => (
            <tr key={b.id}>
              <td>{b.invoice_no}</td>
              <td>{new Date(b.created_at).toLocaleString('en-IN')}</td>
              <td>{b.customer || 'Walk-in'}</td>
              <td className="num">{b.interstate ? 'IGST' : 'CGST/SGST'}</td>
              <td className="num">₹{b.total.toFixed(2)}</td>
              <td><button className="link" onClick={() => open(b.id)}>View</button></td>
            </tr>
          ))}
          {bills.length === 0 && (
            <tr><td colSpan="6" className="muted">No bills yet.</td></tr>
          )}
        </tbody>
      </table>
    </section>
  );
}
