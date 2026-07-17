// Server-only Sandbox (api.sandbox.co.in) client for GSTIN lookups.
//
// Responsibilities:
//  - authenticate with the API key/secret and cache the access token in memory
//  - reuse the token across requests; refresh shortly before expiry (23h)
//  - on a 401 from the search endpoint: clear the token, re-auth, retry ONCE
//  - enforce a request timeout and translate failures into coded errors
//
// It never returns the token, credentials, or the raw provider headers to
// callers, and never logs them. Errors carry a `.code` the route maps to a
// user-facing message.
//
// Built as a factory so tests can inject a fake `fetch` and clock.

const AUTH_TTL_MS = 23 * 60 * 60 * 1000; // refresh ~1h before the 24h expiry
const DEFAULT_TIMEOUT_MS = 10_000;
const API_VERSION = '1.0.0';

// Coded error whose `.code` the caller maps to a safe message.
export class SandboxError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'SandboxError';
    this.code = code;
  }
}

export function createSandboxClient({
  baseUrl,
  apiKey,
  apiSecret,
  fetch = globalThis.fetch,
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const root = String(baseUrl || 'https://api.sandbox.co.in').replace(/\/+$/, '');
  let cache = { token: null, expiresAt: 0 };

  // fetch wrapper: adds a timeout and normalizes abort/network faults to codes.
  async function httpRequest(path, { headers, body }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(root + path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body ?? {}),
        signal: controller.signal,
      });
    } catch (err) {
      if (err && err.name === 'AbortError') throw new SandboxError('TIMEOUT');
      throw new SandboxError('NETWORK');
    } finally {
      clearTimeout(timer);
    }
  }

  async function authenticate() {
    if (!apiKey || !apiSecret) throw new SandboxError('AUTH_FAILED');
    const res = await httpRequest('/authenticate', {
      headers: {
        'x-api-key': apiKey,
        'x-api-secret': apiSecret,
        'x-api-version': API_VERSION,
        'Content-Type': 'application/json',
      },
      body: {},
    });
    if (!res.ok) throw new SandboxError('AUTH_FAILED');
    let json;
    try { json = await res.json(); } catch { throw new SandboxError('AUTH_FAILED'); }
    const token = json?.data?.access_token;
    if (!token) throw new SandboxError('AUTH_FAILED');
    cache = { token, expiresAt: now() + AUTH_TTL_MS };
    return token;
  }

  async function getToken(force = false) {
    if (!force && cache.token && now() < cache.expiresAt) return cache.token;
    return authenticate();
  }

  function clearToken() {
    cache = { token: null, expiresAt: 0 };
  }

  function doSearch(gstin, token) {
    return httpRequest('/gst/compliance/public/gstin/search', {
      headers: {
        'x-api-key': apiKey,
        authorization: token, // sent as-is, no "Bearer" prefix
        'x-api-version': API_VERSION,
        'Content-Type': 'application/json',
      },
      body: { gstin },
    });
  }

  // Returns the parsed provider JSON. The route maps it down to six fields;
  // the raw body never leaves the backend.
  async function searchGstin(gstin) {
    let token = await getToken();
    let res = await doSearch(gstin, token);

    // Token likely expired/invalid — refresh once and retry a single time.
    if (res.status === 401) {
      clearToken();
      token = await getToken(true);
      res = await doSearch(gstin, token);
    }

    if (res.status === 401) throw new SandboxError('AUTH_FAILED');
    if (res.status === 403 || res.status === 402) throw new SandboxError('SUBSCRIPTION');
    if (res.status === 429) throw new SandboxError('RATE_LIMIT');
    if (res.status === 404 || res.status === 400) throw new SandboxError('NOT_FOUND');
    if (!res.ok) throw new SandboxError('UPSTREAM');

    try {
      return await res.json();
    } catch {
      throw new SandboxError('UPSTREAM');
    }
  }

  return {
    authenticate,
    getToken,
    clearToken,
    searchGstin,
    // Test-only peek; never exposes the token through the HTTP layer.
    _peekCache: () => ({ ...cache }),
  };
}
