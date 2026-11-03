# SolarIQ

SolarIQ — Off-Grid System Design. A single-page web app for energy audits and off-grid solar system sizing.

## Run locally

Open `energy-audit-system.html` in any modern browser. No build step or server is required.

## Deployment

Hosted on GitHub Pages from the `main` branch. `index.html` redirects to `energy-audit-system.html`.

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
