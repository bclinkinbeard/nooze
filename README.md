# Nooze

Offline-friendly custom news reader for a small, curated list of sources:

- https://simonwillison.net/
- https://x.com/steipete
- https://x.com/karpathy

## Features

- Pulls fresh content on load (and with **Refresh now**).
- Caches fetched items in `localStorage` for offline reading.
- Uses a service worker to cache app shell assets.
- Source toggles to include/exclude specific feeds.
- Configurable time window (days back) for feed filtering.
- Items link to originals while still showing in-app readable content previews.

## Run locally

Serve over HTTP (service workers require this in most browsers):

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Notes

X/Twitter accounts are fetched via Nitter RSS mirrors with multiple fallbacks and proxy attempts. Availability can vary depending on CORS and endpoint uptime.
