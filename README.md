# Fine Dining Coach – Free Menu Analyzer (Full Project)

This is a **free**, deterministic Flask app that finds nearby restaurants by ZIP (OpenStreetMap / Overpass) and analyzes menus (HTML/PDF) to recommend healthier picks — no paid APIs, no paid LLMs.

## Quick start (local)

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export PORT=10000
python app.py
```

Open http://127.0.0.1:10000

## Deploy to Render (free)

- New > Web Service > Build from your repo
- Start command: `python app.py`
- Set the `PORT` env var if not provided by platform
- Free tier note: Respect rate limits (we do simple caching).

## Endpoints

- `GET /` — UI
- `GET /_ping` — health
- `POST /nearby-by-zip` — JSON: `{zip, radius_miles, calorie_target, prioritize_protein, flags, only_chains}`
- `GET /nearby-by-zip-test?zip=87124&radius_miles=3` — stub for smoke tests
- `POST /analyze-url` — JSON: `{url, calorie_target, prioritize_protein, flags}`
- `GET /analyze-url-test?url=...` — stub for smoke tests
- `POST /analyze-pdf` — multipart with `menu_pdf`
- `GET /openfoodfacts?q=...` — proxy to OFF

## Robots & attribution

- We check robots.txt before fetching any site.
- Footer attribution: OSM/Nominatim, Overpass, Open Food Facts.

## OCR (optional)

- Install Tesseract on your host (system package) and uncomment `pytesseract` in requirements.
- Toggle "Try OCR" in the UI when PDFs have images only.

## Security & privacy

- No accounts; no persistent PII.
- Simple URL sanitization (no file://, no private IPs).
- PDF size/pages should be enforced by deployments; update as needed.

