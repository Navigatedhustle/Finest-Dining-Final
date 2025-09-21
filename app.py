from __future__ import annotations
import os, io, json, re, time, base64, urllib.parse as urlparse
from functools import lru_cache
from flask import Flask, request, jsonify, render_template
import requests

from nutrition_rules import rank_items
from parsers.html_menu import extract_menu_items
from parsers.pdf_menu import extract_text_blocks_from_pdf, extract_menu_items_from_text
from parsers.robots import allowed_by_robots
from integrations.osm import geocode_zip, overpass_restaurants
from integrations.openfoodfacts import search_off

import qrcode

app = Flask(__name__)
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

HEADERS = {"User-Agent": "FineDiningCoach-Free/1.0 (+https://example.local)"}

# --------------------- Helpers ---------------------
SAFE_NETS = (r"127.", r"10.", r"192.168.", r"172.16.", r"172.17.", r"172.18.", r"172.19.", r"172.2", r"localhost")
def is_safe_url(u: str) -> bool:
    try:
        p = urlparse.urlparse(u)
        if p.scheme not in ("http","https"):
            return False
        host = p.hostname or ""
        if any(host.startswith(pref) for pref in SAFE_NETS):
            return False
        return True
    except Exception:
        return False

def make_qr(text: str) -> str:
    img = qrcode.make(text)
    bio = io.BytesIO()
    img.save(bio, format="PNG")
    return "data:image/png;base64," + base64.b64encode(bio.getvalue()).decode()

# Simple TTL cache using lru_cache + timestamp
class TTLCache:
    def __init__(self, ttl_seconds: int, maxsize: int=128):
        self.ttl = ttl_seconds
        self.maxsize = maxsize
        self._store = {}

    def get(self, key):
        v = self._store.get(key)
        if not v: return None
        val, ts = v
        if time.time() - ts > self.ttl:
            self._store.pop(key, None)
            return None
        return val

    def set(self, key, value):
        if len(self._store) >= self.maxsize:
            # drop oldest
            oldest = min(self._store.items(), key=lambda kv: kv[1][1])[0]
            self._store.pop(oldest, None)
        self._store[key] = (value, time.time())

overpass_cache = TTLCache(3600, maxsize=64)      # 60 min
menu_url_cache = TTLCache(86400, maxsize=256)    # 24 h

COMMON_MENU_PATHS = ["/menu","/menus","/food","/dinner","/lunch","/our-menu","/ourmenu","/food-menu"]

# --------------------- Routes ---------------------
@app.get("/")
def home():
    return render_template("index.html")

@app.post("/nearby-by-zip")
def nearby_by_zip():
    data = request.get_json(force=True, silent=True) or {}
    zip_code = str(data.get("zip","")).strip()
    radius = float(data.get("radius_miles", 3))
    only_chains = bool(data.get("only_chains", False))
    params = {
        "calorie_target": int(data.get("calorie_target", 600)),
        "flags": data.get("flags", []),
        "prioritize_protein": bool(data.get("prioritize_protein", True))
    }

    if not re.match(r"^\d{5}$", zip_code):
        return jsonify({"error":"Invalid ZIP"}), 400

    ll = geocode_zip(zip_code)
    if not ll:
        return jsonify({"error":"ZIP not found"}), 404
    lat, lon = ll

    cache_key = f"{zip_code}:{radius}:{only_chains}"
    cached = overpass_cache.get(cache_key)
    if cached:
        restaurants = cached
    else:
        restaurants = overpass_restaurants(lat, lon, radius, limit=25)
        overpass_cache.set(cache_key, restaurants)

    # Optionally filter for chains by simplistic heuristic: name contains common known chains
    if only_chains:
        chains = ("chipotle","panera","mcdonald","subway","starbucks","wendy","taco bell","domino","panda","chick-fil-a")
        restaurants = [r for r in restaurants if r["name"] and any(c in r["name"].lower() for c in chains)]

    output_restaurants = []
    for r in restaurants:
        website = r.get("website")
        picks = []
        source = "playbook"
        # Resolve menu if website exists and allowed by robots
        if website and is_safe_url(website):
            menu_url = resolve_menu_url(website)
            if menu_url and allowed_by_robots(menu_url):
                try:
                    items = fetch_and_extract_menu(menu_url)
                    ranked = rank_items(items, params)
                    picks = ranked["picks"]
                    source = "menu"
                except Exception:
                    picks = []
        # If no picks, fall back to playbooks
        if not picks:
            picks = playbook_picks(r, params)
            source = "playbook"
        # QR for server script of top pick
        if picks:
            script = picks[0].get("server_script","")
            if script:
                picks[0]["qr_data_uri"] = make_qr(script)

        output_restaurants.append({
            "name": r.get("name"),
            "distance_mi": r.get("distance_mi"),
            "cuisine": r.get("cuisine"),
            "website": website,
            "source": source,
            "picks": picks[:2]
        })

    ctx = {"source":"zip", "restaurant_name": None, "zip": zip_code, "radius_miles": radius, **params}
    return jsonify({"context": ctx, "restaurants": output_restaurants})

def resolve_menu_url(website: str) -> str|None:
    cached = menu_url_cache.get(website)
    if cached is not None:
        return cached
    if not allowed_by_robots(website):
        menu_url_cache.set(website, None); return None
    try:
        # first try common paths
        for path in COMMON_MENU_PATHS:
            u = website.rstrip("/") + path
            if allowed_by_robots(u):
                r = requests.get(u, headers=HEADERS, timeout=10, allow_redirects=True)
                if r.status_code == 200 and ("menu" in r.text.lower() or "menu" in u.lower()):
                    menu_url_cache.set(website, u); return u
                time.sleep(0.4)
        # fallback scan homepage for anchors containing "menu"
        r = requests.get(website, headers=HEADERS, timeout=10)
        if r.status_code == 200 and "menu" in r.text.lower():
            import bs4
            soup = bs4.BeautifulSoup(r.text, "html.parser")
            for a in soup.find_all("a"):
                t = (a.get_text(" ", strip=True) or "").lower()
                href = a.get("href")
                if href and "menu" in t or (href and "menu" in href.lower()):
                    # build absolute
                    absu = requests.compat.urljoin(website, href)
                    menu_url_cache.set(website, absu)
                    return absu
    except Exception:
        pass
    menu_url_cache.set(website, None)
    return None

def fetch_and_extract_menu(url: str) -> list[dict]:
    if not is_safe_url(url): 
        return []
    if not allowed_by_robots(url):
        raise RuntimeError("Blocked by robots.txt")
    r = requests.get(url, headers=HEADERS, timeout=15)
    r.raise_for_status()
    ct = r.headers.get("Content-Type","").lower()
    if "pdf" in ct or url.lower().endswith(".pdf"):
        items = extract_menu_items_from_text(extract_text_blocks_from_pdf(r.content, ocr=False))
    else:
        items = extract_menu_items(r.text)
        # look for embedded links to a menu PDF
        if len(items) < 5 and ".pdf" in r.text.lower():
            import re
            m = re.search(r'href="([^"]+\.pdf)"', r.text, re.IGNORECASE)
            if m:
                pdf_url = requests.compat.urljoin(url, m.group(1))
                rpdf = requests.get(pdf_url, headers=HEADERS, timeout=15)
                if rpdf.status_code == 200:
                    items = extract_menu_items_from_text(extract_text_blocks_from_pdf(rpdf.content, ocr=False))
    return items

def playbook_picks(r: dict, params: dict) -> list[dict]:
    # chain playbook by simple name match
    try:
        with open(os.path.join("data","chain_playbooks.json"), "r") as f:
            chains = json.load(f)
        nm = (r.get("name") or "").lower()
        for key, pb in chains.items():
            if key in nm:
                # convert to picks schema
                items = [{"section":"Playbook","name":o["name"],"description":""} for o in pb.get("orders",[])]
                ranked = rank_items(items, params)
                # override est values with playbook
                for i, p in enumerate(ranked["picks"]):
                    if i < len(pb["orders"]):
                        p["est_kcal"] = pb["orders"][i]["est_kcal"]
                        p["est_protein_g"] = pb["orders"][i]["est_protein_g"]
                        p["modifiers"] = pb["orders"][i]["modifiers"]
                return ranked["picks"]
        # cuisine playbook using first cuisine tag
        with open(os.path.join("data","cuisine_playbooks.json"), "r") as f:
            cuis = json.load(f)
        if r.get("cuisine"):
            for c in r["cuisine"]:
                if c in cuis:
                    items = [{"section":"Playbook","name":o["name"],"description":""} for o in cuis[c].get("orders",[])]
                    ranked = rank_items(items, params)
                    return ranked["picks"]
    except Exception:
        pass
    # default safe suggestion if nothing matched
    default = [{"section":"Playbook","name":"Grilled chicken + veg, starch half portion","description":"Ask for sauce on side"}]
    return rank_items(default, params)["picks"]


@app.get("/nearby-by-zip-test")
def nearby_by_zip_test():
    zip_code = str(request.args.get("zip","")).strip()
    radius = float(request.args.get("radius_miles", 3))
    only_chains = request.args.get("only_chains","0") in ("1","true","True","yes")
    calorie_target = int(request.args.get("calorie_target", 600))
    flags = request.args.get("flags","")
    flags_list = [f for f in flags.split(",") if f]
    prioritize_protein = True

    if not re.match(r"^\d{5}(-\d{4})?$", zip_code):
        return jsonify({"error":"Invalid ZIP"}), 400

    ll = geocode_zip(zip_code)
    if not ll:
        return jsonify({"error":"ZIP not found"}), 404
    lat, lon = ll

    cache_key = f"{zip_code}:{radius}:{only_chains}"
    restaurants = overpass_cache.get(cache_key) or overpass_restaurants(lat, lon, radius, limit=25)
    overpass_cache.set(cache_key, restaurants)

    if only_chains:
        chains = ("chipotle","panera","mcdonald","subway","starbucks","wendy","taco bell","domino","panda","chick-fil-a")
        restaurants = [r for r in restaurants if r["name"] and any(c in r["name"].lower() for c in chains)]

    params = {"calorie_target": calorie_target, "flags": flags_list, "prioritize_protein": prioritize_protein}
    output_restaurants = []
    for r in restaurants:
        website = r.get("website")
        picks = []
        source = "playbook"
        if website and is_safe_url(website):
            menu_url = resolve_menu_url(website)
            if menu_url and allowed_by_robots(menu_url):
                try:
                    items = fetch_and_extract_menu(menu_url)
                    ranked = rank_items(items, params)
                    picks = ranked["picks"]
                    source = "menu"
                except Exception:
                    picks = []
        if not picks:
            picks = playbook_picks(r, params)
            source = "playbook"
        if picks:
            script = picks[0].get("server_script","")
            if script:
                picks[0]["qr_data_uri"] = make_qr(script)
        output_restaurants.append({
            "name": r.get("name"),
            "distance_mi": r.get("distance_mi"),
            "cuisine": r.get("cuisine"),
            "website": website,
            "source": source,
            "picks": picks[:2]
        })
    ctx = {"source":"zip", "restaurant_name": None, "zip": zip_code, "radius_miles": radius, "calorie_target": calorie_target, "flags": flags_list, "prioritize_protein": True}
    return jsonify({"context": ctx, "restaurants": output_restaurants})
@app.post("/analyze-url")
def analyze_url():
    data = request.get_json(force=True, silent=True) or {}
    url = str(data.get("url","")).strip()
    params = data.get("params", {}) or {}
    if not is_safe_url(url):
        return jsonify({"error":"Invalid or unsafe URL"}), 400
    if not allowed_by_robots(url):
        return jsonify({"error":"Blocked by robots.txt. Try uploading a PDF."}), 400
    items = fetch_and_extract_menu(url)
    ranked = rank_items(items, params)
    ctx = {"source":"html", "restaurant_name": urlparse.urlparse(url).netloc, **params}
    return jsonify({"context": ctx, "restaurants":[{"name":ctx["restaurant_name"], "picks": ranked["picks"]}], **ranked})


@app.get("/analyze-url-test")
def analyze_url_test():
    url = request.args.get("url", "").strip()
    calorie_target = int(request.args.get("calorie_target", 600))
    flags = [f for f in (request.args.get("flags","") or "").split(",") if f]
    params = {"calorie_target": calorie_target, "flags": flags, "prioritize_protein": True}
    if not is_safe_url(url):
        return jsonify({"error":"Invalid or unsupported URL"}), 400
    if not allowed_by_robots(url):
        return jsonify({"error":"Blocked by robots.txt. Download the PDF and upload it instead."}), 403
    items = fetch_and_extract_menu(url)
    ranked = rank_items(items, params)
    ctx = {"source":"url", "restaurant_name": None, "zip": None, "radius_miles": None, "calorie_target": calorie_target, "flags": flags}
    return jsonify({"context": ctx, "restaurants":[{"name":"Menu","distance_mi":None,"cuisine":[], "website":url, "source":"menu","picks": ranked.get("picks",[])[:3]}]})
@app.post("/analyze-pdf")
def analyze_pdf():
    if "pdf" not in request.files:
        return jsonify({"error":"No file"}), 400
    f = request.files["pdf"]
    if f.mimetype != "application/pdf":
        return jsonify({"error":"Must be a PDF"}), 400
    if request.content_length and request.content_length > 10*1024*1024:
        return jsonify({"error":"PDF too large (max 10MB)"}), 400
    ocr = request.form.get("ocr") == "1"
    params = json.loads(request.form.get("params","{}") or "{}")
    raw = f.read()
    text = extract_text_blocks_from_pdf(raw, ocr=ocr, max_pages=20)
    items = extract_menu_items_from_text(text)
    ranked = rank_items(items, params)
    ctx = {"source":"pdf", "restaurant_name": None, **params}
    return jsonify({"context": ctx, "restaurants":[{"name":"PDF Menu","picks": ranked["picks"]}], **ranked})

@app.get("/openfoodfacts")
def openfoodfacts_proxy():
    q = request.args.get("q","").strip()
    if not q:
        return jsonify({"items":[]})
    items = search_off(q, page_size=6)
    return jsonify({"context":{"source":"openfoodfacts"}, "items": items})

@app.post("/rank")
def rank_endpoint():
    data = request.get_json(force=True, silent=True) or {}
    items = data.get("items", [])
    params = data.get("params", {})
    ranked = rank_items(items, params)
    ctx = {"source":"rank", **params}
    return jsonify({"context": ctx, **ranked})

# --------------- Local Prompt Stubs (Optional) ----------------
# These are *not* used at runtime, but show where a local LLM could be called.
# They require no keys and are clearly marked.
def LOCAL_PROMPT_stub_for_future_refinement(text: str) -> str:
    """
    Placeholder for offline/local LLM prompt if user runs a local model.
    Currently returns the same text; do not wire into core logic.
    """
    return text




@app.after_request
def _no_cache_static(resp):
    # Prevent stale JS/CSS after deploys
    try:
        p = request.path or ''
        if p.startswith('/static/') or p == '/':
            resp.headers['Cache-Control'] = 'no-store, max-age=0, must-revalidate'
            resp.headers['Pragma'] = 'no-cache'
            resp.headers['Expires'] = '0'
    except Exception:
        pass
    return resp

@app.get("/_ping")
def ping():
    return jsonify({"ok": True, "message": "pong"})
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 8000)), debug=False)
