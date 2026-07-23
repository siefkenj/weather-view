# weather-view

At-a-glance weather dashboard — composite forecasts, precipitation, air quality, and
optional confidence intervals — that looks good on desktop and phone.

Live site: **https://siefkenj.github.io/weather-view/**

Data comes entirely from the free [Open-Meteo](https://open-meteo.com/) APIs (no key,
permissive CORS), so the static site fetches everything directly from the browser.

## Features

- **Composite forecast** up to 16 days using Open-Meteo's `best_match` model.
- **Meteogram** (Apache ECharts) with three linked, scrubbable panels:
  - temperature / feels-like / dew-point, with a "now" marker and per-day shading;
  - **precipitation** amount + chance-of-precip;
  - cloud cover / humidity / pressure.
- **Confidence intervals** (toggle): 10–90% ensemble bands for temperature and
  precipitation, computed client-side from the ECMWF IFS ensemble (51 members).
- **Air quality**: Canada's Air Quality Health Index (AQHI), graphed over the visible
  days, plus PM2.5 / PM10 / ozone / NO₂. AQHI is computed client-side from the
  pollutant concentrations per Environment and Climate Change Canada's method.
- **Scrollable timeline**: the chart shows a 10-day window; the ‹ / › arrows pan left
  into the last ~90 days of recorded weather and right through the 16-day forecast —
  one continuous view, no separate history mode. The centered date range jumps back to
  today.
- **City search** (geocoding) — the location is stored in the URL hash path; the query
  string holds what's visible (`days`, `offset`, `layers`, `panels`, `ci`, `unitsgit `).
- Light/dark theme, responsive layout, °C/°F toggle.

## Stack

Vite + React + TypeScript · React Router (hash routing) · TanStack Query · Apache ECharts.

## Development

```bash
npm install
npm run dev        # start the dev server
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm test           # vitest
npm run build      # tsc + vite build  -> ./dist
npm run preview    # serve the production build under /weather-view/
```

## Deployment

Pushing to `main` runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml),
which builds the site and publishes `./dist` to GitHub Pages via the first-party
`configure-pages` → `upload-pages-artifact` → `deploy-pages` actions.
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) typechecks, lints, tests, and
builds on pull requests.

One-time setup: in the repo settings, set **Settings → Pages → Build and deployment →
Source** to **GitHub Actions**.

The build is **relocatable** — Vite's `base` is `"./"`, so `dist/` uses relative asset
URLs and runs unchanged from the domain root, a `/weather-view/` project-pages subpath, a
custom domain, or even a `file://` path. Nothing to reconfigure when the location changes.

## Attribution

Weather & air-quality data by [Open-Meteo.com](https://open-meteo.com/) (CC BY 4.0).
Licensed under GPL-3.0-or-later.
