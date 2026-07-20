// Thin wrapper around the backend REST API.
const json = async (res) => {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
};

export const api = {
  listProducts: () => fetch('/api/products').then(json),
  addProduct: (p) =>
    fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }).then(json),
  updateProduct: (id, p) =>
    fetch(`/api/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    }).then(json),
  deleteProduct: (id) =>
    fetch(`/api/products/${id}`, { method: 'DELETE' }).then(json),
  // Live GSTIN lookup — always goes through our backend, never Sandbox directly.
  lookupGstin: (gstin) =>
    fetch('/api/gst/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gstin }),
    }).then(json),
  createBill: (payload) =>
    fetch('/api/bills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(json),
  listBills: () => fetch('/api/bills').then(json),
  // Next number in the series, suggested from the most recent bill.
  nextInvoiceNo: () => fetch('/api/bills/next-number').then(json),
  getBill: (id) => fetch(`/api/bills/${id}`).then(json),
  getSettings: () => fetch('/api/settings').then(json),
  saveSettings: (s) =>
    fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    }).then(json),
};
