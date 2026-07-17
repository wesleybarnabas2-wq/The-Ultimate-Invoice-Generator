import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeGstin,
  isValidGstin,
  buildRegisteredAddress,
  mapSandboxResponse,
  isEmptyCustomer,
} from './gstin.js';

test('valid GSTIN format passes', () => {
  assert.equal(isValidGstin('33AABCR6577K1Z0'), true);
  assert.equal(isValidGstin('29AABCU9603R1ZX'), true);
});

test('invalid GSTIN format fails', () => {
  assert.equal(isValidGstin('33AABCR6577K1Z'), false); // 14 chars
  assert.equal(isValidGstin('AAABCR6577K1Z00'), false); // no leading digits
  assert.equal(isValidGstin('33aabcr6577k1z0'), false); // lowercase (pre-normalize)
  assert.equal(isValidGstin('33AABCR6577K1A0'), false); // 13th char not 'Z'
  assert.equal(isValidGstin(''), false);
  assert.equal(isValidGstin(null), false);
});

test('normalization trims, removes internal spaces, and uppercases', () => {
  assert.equal(normalizeGstin('  33aabcr6577k1z0 '), '33AABCR6577K1Z0');
  assert.equal(normalizeGstin('33 aabc r6577 k1z0'), '33AABCR6577K1Z0');
  assert.equal(isValidGstin(normalizeGstin('  33aabcr6577k1z0 ')), true);
});

test('buildRegisteredAddress joins only non-empty street fields', () => {
  const addr = { bno: '12', bnm: 'ABC Towers', flno: 'Second Floor', st: 'Anna Salai' };
  assert.equal(buildRegisteredAddress(addr), '12, ABC Towers, Second Floor, Anna Salai');
});

test('empty address fields do not create repeated commas', () => {
  assert.equal(buildRegisteredAddress({ bno: '12', bnm: '', flno: '', st: 'Anna Salai' }), '12, Anna Salai');
  assert.equal(buildRegisteredAddress({ bno: '', bnm: '', flno: '', st: '' }), '');
  assert.equal(buildRegisteredAddress({}), '');
});

test('registeredAddress excludes city/district/state/pin', () => {
  const payload = { data: { tradeNam: 'ABC TRADERS', pradr: { addr: {
    bno: '12', bnm: 'ABC Towers', flno: 'Second Floor', st: 'Anna Salai',
    loc: 'Chennai', dst: 'Chennai', stcd: 'Tamil Nadu', pncd: '600002',
  } } } };
  const c = mapSandboxResponse(payload);
  assert.equal(c.registeredAddress, '12, ABC Towers, Second Floor, Anna Salai');
  assert.ok(!c.registeredAddress.includes('Chennai'));
  assert.ok(!c.registeredAddress.includes('600002'));
});

test('maps tradeName and the six fields correctly', () => {
  const payload = { data: { tradeNam: 'ABC TRADERS', lgnm: 'ABC PRIVATE LIMITED', pradr: { addr: {
    bno: '12', bnm: 'ABC Towers', flno: 'Second Floor', st: 'Anna Salai',
    loc: 'Chennai', dst: 'Chennai', stcd: 'Tamil Nadu', pncd: '600002',
  } } } };
  const c = mapSandboxResponse(payload);
  assert.deepEqual(c, {
    tradeName: 'ABC TRADERS',
    registeredAddress: '12, ABC Towers, Second Floor, Anna Salai',
    city: 'Chennai',
    district: 'Chennai',
    state: 'Tamil Nadu',
    pincode: '600002',
  });
});

test('maps the real Sandbox nested shape (data.data.{tradeNam,pradr})', () => {
  // Sandbox wraps the record under two `data` levels alongside status_cd.
  const payload = { code: 200, data: { status_cd: '1', data: {
    tradeNam: 'ABC TRADERS', lgnm: 'ABC PRIVATE LIMITED', pan: 'AABCR6577K',
    pradr: { addr: {
      bno: '12', bnm: 'ABC Towers', flno: 'Second Floor', st: 'Anna Salai',
      loc: 'Chennai', dst: 'Chennai', stcd: 'Tamil Nadu', pncd: '600002',
    } },
  } } };
  const c = mapSandboxResponse(payload);
  assert.equal(c.tradeName, 'ABC TRADERS');
  assert.equal(c.registeredAddress, '12, ABC Towers, Second Floor, Anna Salai');
  assert.equal(c.city, 'Chennai');
  assert.equal(c.pincode, '600002');
  assert.equal(isEmptyCustomer(c), false);
});

test('missing tradeNam returns empty string (no legal-name fallback)', () => {
  const payload = { data: { lgnm: 'ABC PRIVATE LIMITED', pradr: { addr: { loc: 'Chennai' } } } };
  const c = mapSandboxResponse(payload);
  assert.equal(c.tradeName, '');
  assert.ok(!Object.values(c).includes('ABC PRIVATE LIMITED'));
});

test('only the six approved fields are returned', () => {
  const payload = { data: {
    tradeNam: 'ABC', lgnm: 'LEGAL', sts: 'Active', ctb: 'Private Limited',
    rgdt: '01/01/2020', pan: 'AABCR6577K', dty: 'Regular',
    pradr: { addr: { loc: 'Chennai', dst: 'Chennai', stcd: 'Tamil Nadu', pncd: '600002' } },
    adadr: [{ addr: { loc: 'Extra' } }],
  } };
  const c = mapSandboxResponse(payload);
  assert.deepEqual(
    Object.keys(c).sort(),
    ['city', 'district', 'pincode', 'registeredAddress', 'state', 'tradeName'],
  );
});

test('isEmptyCustomer detects a blank result', () => {
  assert.equal(isEmptyCustomer(mapSandboxResponse({ data: {} })), true);
  assert.equal(isEmptyCustomer(mapSandboxResponse({ data: { tradeNam: 'X' } })), false);
});
