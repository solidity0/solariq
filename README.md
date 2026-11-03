# SolarIQ

SolarIQ — Off-Grid System Design. A single-page web app for energy audits and off-grid solar system sizing.

## Run locally

Open `energy-audit-system.html` in any modern browser. No build step or server is required.

## Deployment

Hosted on GitHub Pages from the `main` branch. `index.html` redirects to `energy-audit-system.html`.

## Notes

App data (projects, CRM, installer settings, theme) is saved in the browser's `localStorage`, so it stays on the visitor's device. If the browser blocks storage (for example some private modes), the app still runs but nothing is kept after the tab closes.

`favicon.svg` and `manifest.webmanifest` provide the site icon and let the app be installed to a phone's home screen.
