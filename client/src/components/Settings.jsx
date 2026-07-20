import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { STATES } from '../states.js';

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

export default function Settings({ settings, onSaved }) {
  const [form, setForm] = useState({
    store_name: '', address: '', gstin: '', state: '', dealer_type: 'unregistered',
    phone: '', email: '', website: '', social1: '', social2: '', social3: '',
  });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  // GSTIN is collected in a dialog that opens the moment "Registered" is picked.
  const [askGstin, setAskGstin] = useState(false);
  const [gstinDraft, setGstinDraft] = useState('');
  const [gstinError, setGstinError] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  // Set when the GSTIN is well-formed but the lookup itself failed, so the user
  // can still register with it rather than being blocked by an API outage.
  const [skippable, setSkippable] = useState('');
  // True when the store details on screen came from the GST database, which
  // makes them read-only. A profile saved via "Use anyway" has no such details,
  // so it stays editable rather than locking the user out of empty fields.
  const [fromGst, setFromGst] = useState(false);
  const gstinInput = useRef(null);

  useEffect(() => {
    if (settings) {
      setForm({
        store_name: settings.store_name || '',
        address: settings.address || '',
        gstin: settings.gstin || '',
        state: settings.state || '',
        dealer_type: settings.dealer_type || 'unregistered',
        phone: settings.phone || '',
        email: settings.email || '',
        website: settings.website || '',
        social1: settings.social1 || '',
        social2: settings.social2 || '',
        social3: settings.social3 || '',
      });
      // A saved registered profile carrying a name was filled from the lookup.
      setFromGst(settings.dealer_type === 'registered' && !!settings.store_name);
    }
  }, [settings]);

  const registered = form.dealer_type === 'registered';
  const locked = registered && fromGst;

  useEffect(() => {
    if (!askGstin) return;
    gstinInput.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') closeGstin(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [askGstin]);

  const openGstin = () => {
    setGstinDraft(form.gstin || '');
    setGstinError('');
    setSkippable('');
    setAskGstin(true);
  };

  // Closing without a valid GSTIN leaves the profile unregistered — we never
  // want a "registered" dealer sitting there with no number.
  const closeGstin = () => {
    if (lookingUp) return; // don't drop a lookup mid-flight
    setAskGstin(false);
    setGstinError('');
    setSkippable('');
  };

  // The lookup returns the state as a name; map it onto our dropdown's list.
  const matchState = (name) =>
    STATES.find((s) => s.toLowerCase() === String(name ?? '').trim().toLowerCase()) || '';

  // Join the address parts, dropping case-insensitive duplicates — GST records
  // routinely repeat the city as the district ("CHENNAI" / "Chennai").
  const joinAddress = (...parts) => {
    const seen = new Set();
    return parts
      .map((p) => String(p ?? '').trim())
      .filter((p) => {
        const key = p.toLowerCase();
        if (!p || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .join(', ');
  };

  // Commit the GSTIN, filling in whatever registration details we got back.
  const applyGstin = (gstin, details = null) => {
    setForm((f) => ({
      ...f,
      dealer_type: 'registered',
      gstin,
      store_name: details?.tradeName || f.store_name,
      address: details
        ? joinAddress(details.registeredAddress, details.city, details.district,
            details.pincode) || f.address
        : f.address,
      state: (details && matchState(details.state)) || f.state,
    }));
    setFromGst(!!details);
    setAskGstin(false);
    setGstinError('');
    setSkippable('');
  };

  const chooseDealerType = (value) => {
    setError(''); setStatus('');
    if (value === 'registered') {
      openGstin();
      return; // not committed until a valid GSTIN is confirmed
    }
    setForm((f) => ({ ...f, dealer_type: 'unregistered', gstin: '' }));
  };

  // Confirming pulls the registration details straight from the GST database
  // and fills the profile in, so the store never has to type them by hand.
  const confirmGstin = async (e) => {
    e.preventDefault();
    if (lookingUp) return;
    const value = gstinDraft.replace(/\s+/g, '').toUpperCase();
    if (!GSTIN_REGEX.test(value)) {
      setGstinError('Enter a valid 15-character GSTIN, e.g. 27ABCDE1234F1Z5.');
      setSkippable('');
      return;
    }
    setGstinError(''); setSkippable(''); setLookingUp(true);
    try {
      const { customer: details } = await api.lookupGstin(value);
      applyGstin(value, details);
      setStatus('GST details fetched — review them below, then Save profile.');
    } catch (err) {
      setGstinError(err.message || 'GST details could not be retrieved.');
      setSkippable(value); // well-formed, so let them register without the lookup
    } finally {
      setLookingUp(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setStatus('');
    try {
      // An unregistered dealer has no GSTIN — never send a stale one.
      await api.saveSettings(registered ? form : { ...form, gstin: '' });
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
        <p className="muted">These appear on every invoice you issue.</p>
        {error && <p className="error">{error}</p>}
        {status && <p className="success">{status}</p>}

        <form onSubmit={submit}>
          <fieldset className="choice">
            <legend>Registration status</legend>
            <label className="checkbox">
              <input type="radio" name="dealer_type" value="registered"
                checked={registered}
                onChange={(e) => chooseDealerType(e.target.value)} />
              <span>Registered dealer <span className="muted">— has a GSTIN, issues Tax Invoices</span></span>
            </label>
            <label className="checkbox">
              <input type="radio" name="dealer_type" value="unregistered"
                checked={!registered}
                onChange={(e) => chooseDealerType(e.target.value)} />
              <span>Unregistered <span className="muted">— no GST charged, Bill of Supply only</span></span>
            </label>

            {registered && (
              <p className="small gstin-line">
                GSTIN: <strong>{form.gstin}</strong>{' '}
                <button type="button" className="link" onClick={openGstin}>Change</button>
              </p>
            )}
          </fieldset>

          {locked && (
            <p className="muted small">
              These come from your GST registration — change your GSTIN above to update them.
            </p>
          )}
          <label>Store / business name
            <input value={form.store_name} required readOnly={locked}
              onChange={(e) => setForm({ ...form, store_name: e.target.value })} />
          </label>
          <label>Address
            <textarea rows="2" value={form.address} readOnly={locked}
              onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </label>
          <label>Home state (for inter-state detection)
            <select value={form.state} disabled={locked}
              onChange={(e) => setForm({ ...form, state: e.target.value })}>
              <option value="">— Select —</option>
              {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <fieldset className="choice">
            <legend>Contact &amp; links — all optional</legend>
            <div className="add-row">
              <label className="grow">Phone
                <input type="tel" value={form.phone} maxLength={20}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="e.g. +91 98765 43210" />
              </label>
              <label className="grow">Email
                <input type="email" value={form.email} maxLength={120}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="e.g. name@example.com" />
              </label>
            </div>
            <label>Website
              <input type="url" value={form.website} maxLength={200}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
                placeholder="e.g. https://example.com" />
            </label>
            <label>Social link 1
              <input type="url" value={form.social1} maxLength={200}
                onChange={(e) => setForm({ ...form, social1: e.target.value })}
                placeholder="e.g. https://instagram.com/yourshop" />
            </label>
            <label>Social link 2
              <input type="url" value={form.social2} maxLength={200}
                onChange={(e) => setForm({ ...form, social2: e.target.value })} />
            </label>
            <label>Social link 3
              <input type="url" value={form.social3} maxLength={200}
                onChange={(e) => setForm({ ...form, social3: e.target.value })} />
            </label>
          </fieldset>

          <button type="submit">Save profile</button>
        </form>
      </section>

      {askGstin && (
        <div className="modal-backdrop" onMouseDown={closeGstin}>
          <div className="modal" role="dialog" aria-modal="true"
            aria-labelledby="gstin-title" onMouseDown={(e) => e.stopPropagation()}>
            <h3 id="gstin-title">Enter your GSTIN</h3>
            <p className="muted small">
              We’ll pull your registered business name and address from the GST
              database — it prints on every tax invoice.
            </p>
            {gstinError && <p className="error">{gstinError}</p>}
            <form onSubmit={confirmGstin}>
              <label>GSTIN
                <input ref={gstinInput} value={gstinDraft} placeholder="e.g. 27ABCDE1234F1Z5"
                  maxLength={15} disabled={lookingUp}
                  onChange={(e) => { setGstinDraft(e.target.value.toUpperCase()); setSkippable(''); }} />
              </label>
              <div className="modal-actions">
                <button type="button" className="secondary" onClick={closeGstin}
                  disabled={lookingUp}>Cancel</button>
                {skippable && (
                  <button type="button" className="secondary"
                    onClick={() => applyGstin(skippable)}>Use anyway</button>
                )}
                <button type="submit" disabled={lookingUp}>
                  {lookingUp ? 'Fetching…' : 'Fetch details'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
