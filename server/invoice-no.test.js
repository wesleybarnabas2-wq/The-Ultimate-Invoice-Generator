import test from 'node:test';
import assert from 'node:assert/strict';
import { bumpInvoiceNo, FIRST_INVOICE_NO } from './invoice-no.js';

test('increments the trailing number and keeps the prefix', () => {
  assert.equal(bumpInvoiceNo('GB/2026-27/001'), 'GB/2026-27/002');
  assert.equal(bumpInvoiceNo('INV-2026-629642'), 'INV-2026-629643');
  assert.equal(bumpInvoiceNo('7'), '8');
});

test('preserves zero-padding, and grows past it when needed', () => {
  assert.equal(bumpInvoiceNo('001'), '002');
  assert.equal(bumpInvoiceNo('009'), '010');
  assert.equal(bumpInvoiceNo('099'), '100');
  assert.equal(bumpInvoiceNo('999'), '1000'); // must not truncate back to 000
});

test('only the last digit run moves — earlier numbers are part of the series name', () => {
  assert.equal(bumpInvoiceNo('2026-27/001'), '2026-27/002');
  assert.equal(bumpInvoiceNo('GST/2024/25/9'), 'GST/2024/25/10');
});

test('digits followed by a suffix still increment', () => {
  assert.equal(bumpInvoiceNo('2024/99/A'), '2024/100/A');
  assert.equal(bumpInvoiceNo('INV-007-B'), 'INV-008-B');
});

test('a number with no digits still advances', () => {
  assert.equal(bumpInvoiceNo('ABC'), 'ABC-1');
});

test('blank input yields blank rather than inventing a series', () => {
  assert.equal(bumpInvoiceNo(''), '');
  assert.equal(bumpInvoiceNo('   '), '');
  assert.equal(bumpInvoiceNo(null), '');
  assert.equal(bumpInvoiceNo(undefined), '');
});

test('the first invoice number is a padded serial', () => {
  assert.equal(FIRST_INVOICE_NO, '001');
});
