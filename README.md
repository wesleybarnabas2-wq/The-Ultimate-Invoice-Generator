# Billing App

A simple GST billing application. Pick products (with their rate and GST %),
build a bill, and generate a printable tax invoice with **CGST/SGST** breakdown.

- **Frontend:** React + Vite (`client/`)
- **Backend:** Node/Express + built-in SQLite `node:sqlite` (`server/`)
- **Data:** stored in `server/billing.db` (created automatically, seeded with sample products)

## Requirements
- Node.js 22.5+ (built-in SQLite). Tested on Node 24.

## Setup
```powershell
# Backend
cd server
npm install

# Frontend
cd ../client
npm install
```

## Run (two terminals)
```powershell
# Terminal 1 — API on http://localhost:3001
cd server
npm start
```
```powershell
# Terminal 2 — UI on http://localhost:5173
cd client
npm run dev
```
Open http://localhost:5173.

## Using it
1. **Products tab** — add/edit products with a rate and GST slab (0/5/12/18/28%).
2. **New Bill tab** — choose a product, set quantity, add it to the bill. Totals
   (taxable value, CGST, SGST, grand total) update live.
3. **Generate Receipt** — saves the bill and shows a printable tax invoice.
   Use **Print / Save PDF** to print or save as PDF.

## GST logic
Rates are GST-exclusive. For each line: `taxable = rate × qty`,
`GST = taxable × gst% `, split equally into CGST and SGST (intra-state).
Grand total = taxable value + CGST + SGST. Amounts are rounded to 2 decimals.
