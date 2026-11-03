# SolarIQ

SolarIQ — Off-Grid System Design. A single-page web app for energy audits and off-grid solar system sizing.

## Run locally

Open `energy-audit-system.html` in any modern browser. No build step or server is required.

## Deployment

Hosted on GitHub Pages from the `main` branch. `index.html` redirects to `energy-audit-system.html`.

## System sizing

`sizing-engine.js` follows the AUDITING sheet of the *AUDIT QUOTATION with parallel function* workbook:

- **Battery bank:** adjusted energy (+20% system loss) ÷ (system V × battery efficiency × DoD) × days of autonomy. Efficiency is 90% for lithium and 80% otherwise; DoD comes from each battery model.
- **Panels:** battery bank × (1 + 50% charging loss) ÷ peak sun hours ÷ panel W ÷ panel efficiency. The result is then fitted into strings that stay under the inverter's PV voltage.
- **Inverter:** load ÷ power factor ÷ inverter efficiency, rounded up to a whole kW. "Auto" picks the cheapest model of the preferred brand, or several in parallel, that passes every data-sheet check: capacity, parallel, battery voltage, and PV power, voltage and current.
- **Quote:** inverter, panels and batteries at catalog user prices, an itemised accessories list, 8% installation, logistics, and free 1-year support.

The default product catalog (models, specs, dealer and user prices) in `energy-audit-system.html` was generated from the workbook's two price-list sheets. Installers can edit it on the Price Lists page.

## Cloud database (Supabase)

Each installer signs in with email and password, and their designs, quotes, CRM leads and installer profile are saved to a Supabase database. Row-level security means each account can only see its own data. `cloud-sync.js` handles sign-in and syncing; the app keeps a working copy in the browser so it stays fast and survives short connection drops.

Setup:

1. Create a free project at supabase.com.
2. In **SQL Editor**, run [`supabase/schema.sql`](supabase/schema.sql).
3. In **Authentication → URL Configuration**, set **Site URL** to `https://solidity0.github.io/solariq/` and add `https://solidity0.github.io/solariq/**` under **Redirect URLs**.
4. In **Project Settings → API**, copy the **Project URL** and the **anon / publishable** key into [`config.js`](config.js). Both are safe to publish. Never put the `service_role` / secret key in this repo.

With `config.js` left empty, SolarIQ runs in local-only mode and saves data in the browser only.

## Notes

Without a database configured, app data (projects, CRM, installer settings, theme) is saved in the browser's `localStorage`, so it stays on the visitor's device. If the browser blocks storage (for example some private modes), the app still runs but nothing is kept after the tab closes.

`favicon.svg` and `manifest.webmanifest` provide the site icon and let the app be installed to a phone's home screen.
