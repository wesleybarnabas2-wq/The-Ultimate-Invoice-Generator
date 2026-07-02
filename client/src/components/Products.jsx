import { useEffect, useState } from 'react';
import { api } from '../api.js';

const GST_SLABS = [0, 5, 12, 18, 28];
const empty = { name: '', sku: '', rate: '', gstRate: 5 };

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
        sku: form.sku.trim(),
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
    setForm({ name: p.name, sku: p.sku || '', rate: p.rate, gstRate: p.gst_rate });
  };

  const remove = async (id) => {
    if (!confirm('Delete this product?')) return;
    await api.deleteProduct(id);
    if (editingId === id) { setEditingId(null); setForm(empty); }
    load();
  };

  return (
    <div className="grid">
      <section className="card">
        <h2>{editingId ? 'Edit product' : 'Add product'}</h2>
        {error && <p className="error">{error}</p>}
        <form onSubmit={submit}>
          <label>Name
            <input value={form.name} required
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label>SKU (optional)
            <input value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          </label>
          <label>Rate (₹, per unit, GST-exclusive)
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
            <tr><th>Name</th><th>SKU</th><th className="num">Rate</th><th className="num">GST</th><th></th></tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.sku || '—'}</td>
                <td className="num">₹{p.rate.toFixed(2)}</td>
                <td className="num">{p.gst_rate}%</td>
                <td className="actions">
                  <button className="link" onClick={() => edit(p)}>Edit</button>
                  <button className="link danger" onClick={() => remove(p.id)}>Delete</button>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr><td colSpan="5" className="muted">No products yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
