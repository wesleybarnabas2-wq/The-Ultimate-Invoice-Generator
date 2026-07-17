import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { STATES } from '../states.js';

export default function Settings({ settings, onSaved }) {
  const [form, setForm] = useState({ store_name: '', address: '', gstin: '', state: '' });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (settings) {
      setForm({
        store_name: settings.store_name || '',
        address: settings.address || '',
        gstin: settings.gstin || '',
        state: settings.state || '',
      });
    }
  }, [settings]);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setStatus('');
    try {
      await api.saveSettings(form);
      setStatus('Saved.');
      onSaved?.();
      setTimeout(() => setStatus(''), 2000);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="grid">
      <section className="card">
        <h2>Store details</h2>
        <p className="muted">These appear on every tax invoice.</p>
        {error && <p className="error">{error}</p>}
        {status && <p className="success">{status}</p>}
        <form onSubmit={submit}>
          <label>Store / business name
            <input value={form.store_name} required
              onChange={(e) => setForm({ ...form, store_name: e.target.value })} />
          </label>
          <label>Address
            <textarea rows="2" value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </label>
          <label>GSTIN
            <input value={form.gstin} placeholder="e.g. 27ABCDE1234F1Z5"
              onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} />
          </label>
          <label>Home state (for inter-state detection)
            <select value={form.state}
              onChange={(e) => setForm({ ...form, state: e.target.value })}>
              <option value="">— Select —</option>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <button type="submit">Save profile</button>
        </form>
      </section>
    </div>
  );
}
