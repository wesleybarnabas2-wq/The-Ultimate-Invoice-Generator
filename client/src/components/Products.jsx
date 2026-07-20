import { useEffect, useState } from 'react';
import { api } from '../api.js';

const GST_SLABS = [0, 5, 12, 18, 28];
const empty = { name: '', kind: 'goods', hsn: '', rate: '', gstRate: 5 };

export default function Products() {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(empty);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState('');

  const load = () => api.listProducts().then(setProducts).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      const payload = {
        name: form.name.trim(),
        kind: form.kind,
        hsn: form.hsn.trim(),
        rate: Number(form.rate),
        gstRate: Number(form.gstRate),
      };
      if (editingId) await api.updateProduct(editingId, payload);
      else await api.addProduct(payload);
      setForm(empty);
      setEditingId(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const edit = (p) => {
    setEditingId(p.id);
    setForm({
      name: p.name, kind: p.kind || 'goods', hsn: p.hsn || '',
      rate: p.rate, gstRate: p.gst_rate,
    });
  };

  const isService = form.kind === 'service';

  const remove = async (id) => {
    if (!confirm('Delete this catalog item?')) return;
    await api.deleteProduct(id);
    if (editingId === id) { setEditingId(null); setForm(empty); }
    load();
  };

  return (
    <div className="grid">
      <section className="card">
        <h2>{editingId ? 'Edit item' : 'Add goods or a service'}</h2>
        {error && <p className="error">{error}</p>}
        <form onSubmit={submit}>
          <label>Type
            <select value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="goods">Goods</option>
              <option value="service">Service</option>
            </select>
          </label>
          <label>Name
            <input value={form.name} required
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>{isService ? 'SAC code (optional)' : 'HSN code (optional)'}
            <input value={form.hsn}
              placeholder={isService ? 'e.g. 998313' : 'e.g. 0401'}
              onChange={(e) => setForm({ ...form, hsn: e.target.value })} />
          </label>
          <label>{isService ? 'Rate (₹, GST-exclusive)' : 'Rate (₹, per unit, GST-exclusive)'}
            <input type="number" min="0" step="0.01" value={form.rate} required
              onChange={(e) => setForm({ ...form, rate: e.target.value })} />
          </label>
          <label>GST %
            <select value={form.gstRate}
              onChange={(e) => setForm({ ...form, gstRate: e.target.value })}>
              {GST_SLABS.map((g) => <option key={g} value={g}>{g}%</option>)}
            </select>
          </label>
          <div className="row">
            <button type="submit">{editingId ? 'Save' : 'Add'}</button>
            {editingId && (
              <button type="button" className="secondary"
                onClick={() => { setEditingId(null); setForm(empty); }}>
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Catalog ({products.length})</h2>
        <table>
          <thead>
            <tr><th>Name</th><th>Type</th><th>HSN/SAC</th><th className="num">Rate</th><th className="num">GST</th><th></th></tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="muted">{p.kind === 'service' ? 'Service' : 'Goods'}</td>
                <td>{p.hsn || '—'}</td>
                <td className="num">₹{p.rate.toFixed(2)}</td>
                <td className="num">{p.gst_rate}%</td>
                <td className="actions">
                  <button className="link" onClick={() => edit(p)}>Edit</button>
                  <button className="link danger" onClick={() => remove(p.id)}>Delete</button>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr><td colSpan="6" className="muted">Nothing catalogued yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
