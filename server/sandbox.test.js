import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxClient, SandboxError } from './sandbox.js';

// Minimal fake Response.
const res = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const authOk = () => res(200, { data: { access_token: 'tok-123' } });
const searchOk = () => res(200, { data: { tradeNam: 'ABC', pradr: { addr: { loc: 'Chennai' } } } });

// Build a client with a scripted fetch that records calls.
function make(handlers, { now } = {}) {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, opts });
    const handler = url.endsWith('/authenticate') ? handlers.auth : handlers.search;
    return handler(calls);
  };
  const client = createSandboxClient({
    baseUrl: 'https://api.sandbox.co.in',
    apiKey: 'key_test', apiSecret: 'secret_test',
    fetch, now: now || Date.now,
  });
  return { client, calls };
}

test('successful authentication returns and caches the token', async () => {
  const { client } = make({ auth: authOk, search: searchOk });
  const token = await client.authenticate();
  assert.equal(token, 'tok-123');
  assert.equal(client._peekCache().token, 'tok-123');
});

test('successful search returns normalized-able provider JSON', async () => {
  const { client } = make({ auth: authOk, search: searchOk });
  const json = await client.searchGstin('33AABCR6577K1Z0');
  assert.equal(json.data.tradeNam, 'ABC');
});

test('authorization header carries the raw token (no Bearer prefix)', async () => {
  const { client, calls } = make({ auth: authOk, search: searchOk });
  await client.searchGstin('33AABCR6577K1Z0');
  const searchCall = calls.find((c) => c.url.endsWith('/search'));
  assert.equal(searchCall.opts.headers.authorization, 'tok-123');
});

test('access token is cached and reused across searches (auth called once)', async () => {
  const { client, calls } = make({ auth: authOk, search: searchOk });
  await client.searchGstin('33AABCR6577K1Z0');
  await client.searchGstin('33AABCR6577K1Z0');
  const authCalls = calls.filter((c) => c.url.endsWith('/authenticate'));
  assert.equal(authCalls.length, 1);
});

test('token is refreshed after expiry', async () => {
  let t = 1_000;
  const { client, calls } = make({ auth: authOk, search: searchOk }, { now: () => t });
  await client.searchGstin('33AABCR6577K1Z0');       // authenticates at t=1000
  t += 24 * 60 * 60 * 1000;                           // jump past the 23h TTL
  await client.searchGstin('33AABCR6577K1Z0');        // must re-authenticate
  const authCalls = calls.filter((c) => c.url.endsWith('/authenticate'));
  assert.equal(authCalls.length, 2);
});

test('authentication failure throws AUTH_FAILED', async () => {
  const { client } = make({ auth: () => res(401, { error: 'bad' }), search: searchOk });
  await assert.rejects(client.searchGstin('33AABCR6577K1Z0'),
    (e) => e instanceof SandboxError && e.code === 'AUTH_FAILED');
});

test('missing credentials throw AUTH_FAILED without a network call', async () => {
  let fetched = false;
  const client = createSandboxClient({ apiKey: '', apiSecret: '', fetch: async () => { fetched = true; return authOk(); } });
  await assert.rejects(client.authenticate(), (e) => e.code === 'AUTH_FAILED');
  assert.equal(fetched, false);
});

test('search server error throws UPSTREAM', async () => {
  const { client } = make({ auth: authOk, search: () => res(500, {}) });
  await assert.rejects(client.searchGstin('33AABCR6577K1Z0'),
    (e) => e.code === 'UPSTREAM');
});

test('rate limit and not-found map to their codes', async () => {
  const rl = make({ auth: authOk, search: () => res(429, {}) });
  await assert.rejects(rl.client.searchGstin('33AABCR6577K1Z0'), (e) => e.code === 'RATE_LIMIT');
  const nf = make({ auth: authOk, search: () => res(404, {}) });
  await assert.rejects(nf.client.searchGstin('33AABCR6577K1Z0'), (e) => e.code === 'NOT_FOUND');
});

test('request timeout throws TIMEOUT', async () => {
  const fetch = async (_url, opts) => {
    // Simulate an aborted request.
    return new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };
  const client = createSandboxClient({ apiKey: 'k', apiSecret: 's', fetch, timeoutMs: 5 });
  await assert.rejects(client.authenticate(), (e) => e.code === 'TIMEOUT');
});

test('a 401 on search triggers exactly one re-auth + retry, then succeeds', async () => {
  let searchHits = 0;
  const client = createSandboxClient({
    apiKey: 'k', apiSecret: 's',
    fetch: async (url) => {
      if (url.endsWith('/authenticate')) return authOk();
      searchHits += 1;
      return searchHits === 1 ? res(401, {}) : searchOk(); // first 401, then OK
    },
  });
  const json = await client.searchGstin('33AABCR6577K1Z0');
  assert.equal(json.data.tradeNam, 'ABC');
  assert.equal(searchHits, 2); // original + one retry
});

test('persistent 401 does not loop — retries once then throws AUTH_FAILED', async () => {
  let searchHits = 0;
  let authHits = 0;
  const client = createSandboxClient({
    apiKey: 'k', apiSecret: 's',
    fetch: async (url) => {
      if (url.endsWith('/authenticate')) { authHits += 1; return authOk(); }
      searchHits += 1;
      return res(401, {}); // always unauthorized
    },
  });
  await assert.rejects(client.searchGstin('33AABCR6577K1Z0'), (e) => e.code === 'AUTH_FAILED');
  assert.equal(searchHits, 2); // original + exactly one retry, no infinite loop
  assert.equal(authHits, 2);   // initial auth + one refresh
});
