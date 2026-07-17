// Pure, reusable GSTIN helpers: normalization, format validation, and mapping
// a Sandbox GST-search response down to the exact six fields we expose.
// No network or secrets here — safe to unit-test in isolation.

// 2 digits (state) + 5 letters (PAN) + 4 digits + 1 letter + 1 alnum + 'Z' + 1 alnum.
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;

// Trim, drop all whitespace (incl. internal), and uppercase.
export function normalizeGstin(raw) {
  return String(raw ?? '').replace(/\s+/g, '').toUpperCase();
}

export function isValidGstin(gstin) {
  return typeof gstin === 'string' && gstin.length === 15 && GSTIN_REGEX.test(gstin);
}

const clean = (v) => (v == null ? '' : String(v).trim());

// Join only the non-empty street-level fields, in order, with ", ".
// City/district/state/PIN are intentionally excluded — they're returned separately.
export function buildRegisteredAddress(addr = {}) {
  return [addr.bno, addr.bnm, addr.flno, addr.st]
    .map(clean)
    .filter(Boolean)
    .join(', ');
}

// Sandbox nests the GST record under one or more `data` wrappers, e.g.
// { data: { data: {...record...}, status_cd } }. Peel `.data` off until we
// reach the object that actually holds the record fields (tradeNam / pradr).
function unwrapDetails(payload) {
  let node = payload;
  for (let i = 0; i < 4; i++) {
    if (!node || typeof node !== 'object') return {};
    if ('tradeNam' in node || 'pradr' in node) return node;
    node = node.data;
  }
  return {};
}

// Map a Sandbox response to exactly the six approved fields.
// No legal-name fallback for tradeName; nothing else is read or kept.
export function mapSandboxResponse(payload) {
  const details = unwrapDetails(payload);
  const addr = details?.pradr?.addr ?? {};
  return {
    tradeName: clean(details.tradeNam),
    registeredAddress: buildRegisteredAddress(addr),
    city: clean(addr.loc),
    district: clean(addr.dst),
    state: clean(addr.stcd),
    pincode: clean(addr.pncd),
  };
}

// True when the mapped result carries no usable registration detail.
export function isEmptyCustomer(c) {
  return !c.tradeName && !c.registeredAddress && !c.city &&
    !c.district && !c.state && !c.pincode;
}
