// Pure helper for suggesting the next invoice number in a series.
// No database or network here — safe to unit-test in isolation.

// Increment the LAST run of digits in an invoice number, keeping the prefix,
// any trailing non-digits, and the original zero-padding:
//   GB/2026-27/001 → GB/2026-27/002
//   INV-2026-629642 → INV-2026-629643
//   2024/99/A       → 2024/100/A
// A number with no digits at all gets a "-1" appended, so it still advances.
export function bumpInvoiceNo(no) {
  const value = String(no ?? '').trim();
  if (!value) return '';
  const match = value.match(/^(.*?)(\d+)(\D*)$/);
  if (!match) return `${value}-1`;
  const [, prefix, digits, suffix] = match;
  const next = String(Number(digits) + 1);
  // Keep the original width only while the number still fits inside it.
  return prefix + next.padStart(digits.length, '0') + suffix;
}

// The number to offer when a store has no bills yet.
export const FIRST_INVOICE_NO = '001';
