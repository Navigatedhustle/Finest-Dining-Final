# Fine Dining Coach – Free Menu Analyzer

Production-quality, **free** Flask app that parses restaurant menus (HTML/PDF) with deterministic nutrition rules and provides healthy recommendations. **No paid APIs**. Location discovery via OpenStreetMap (Nominatim + Overpass). Packaged items via **Open Food Facts**. Optional OCR via `pytesseract` if installed, behind a UI toggle.

## Live stack
- Flask (Python 3.11)
- Requests, BeautifulSoup4, pdfplumber, Pillow
- Optional OCR: pytesseract (requires `tesseract` binary on server)
- OpenStreetMap: Nominatim (ZIP → lat/lon), Overpass (nearby restaurants)
- Open Food Facts (free API)
- Tailwind CDN, Alpine.js for minimal interactivity
- In-memory TTL cache only (no paid cache)

## Run locally
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
# (optional) install tesseract for OCR: sudo apt-get install tesseract-ocr
python app.py
```

Open http://localhost:8000

## Deploy (Render free web service)
1. Create a new Web Service, select this repo, Build Command:
   ```
   pip install -r requirements.txt
   ```
   Start Command:
   ```
   python app.py
   ```
2. Ensure free plan idles and cold-starts are acceptable.
3. (Optional) Install `tesseract-ocr` if OCR is needed via a start script or Docker.
   If not available, leave the OCR toggle off.

## Endpoints
- `GET /` – Index UI.
- `POST /nearby-by-zip` – body: `{ zip, radius_miles, only_chains, calorie_target, flags, prioritize_protein }`.
- `POST /analyze-url` – body: `{ url, params }`.
- `POST /analyze-pdf` – multipart with `pdf`, `ocr` (0/1), and `params` JSON.
- `GET /openfoodfacts?q=term`
- `POST /rank` – body: `{ items: [...], params: {...} }`

All JSON responses follow the schema described in the prompt.

## Robots.txt & Attribution
- The app **checks robots.txt** before fetching any website or menu path.
- If disallowed or blocked, the UI shows a friendly message and suggests uploading a PDF.
- Footer attribution (required): “© OpenStreetMap contributors. Geocoding by Nominatim. Data via Overpass API. Packaged items from Open Food Facts.”

## Security & Privacy
- URL sanitizer blocks non-http(s) and private networks.
- PDF size ≤ 10 MB, pages ≤ 20.
- No accounts, PII, or cookies. UI presets stored in `localStorage` only.

## Deterministic Rules
See `nutrition_rules.py` for signal lists, calorie/protein estimators, and scoring math. Evidence is visible per pick.

## Playbooks
`data/cuisine_playbooks.json` and `data/chain_playbooks.json` seed safe fallbacks. Extend these via PRs. See `playbooks/CONTRIBUTING.md` for guidelines.

## Known limits
- Heuristics are approximate, not medical advice.
- Some restaurants use heavy JS or gated sites. Use the PDF upload in those cases.
- Overpass/Nominatim have rate limits. The app backs off via sleeps and small result sets.

## License
MIT (attribution to OSM and Open Food Facts required in UI).
