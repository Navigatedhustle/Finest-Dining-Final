import os, io, time, json, re
from flask import Flask, request, render_template, jsonify, send_from_directory
import requests

from nutrition_rules import rank_items, score_item
from parsers.html_menu import extract_items as extract_html_items
from parsers.pdf_menu import extract_from_pdf_bytes
from parsers.robots import is_allowed as robots_allowed
from integrations.osm import geocode_zip, overpass_restaurants
from integrations.openfoodfacts import search_off

APP_NAME = "FineDiningCoach"
UA = "FineDiningCoach/1.0 (+https://example.com; contact demo@example.com)"

app = Flask(__name__)

# ----------------- Simple TTL Cache -----------------
class TTLCache:
    def __init__(self, ttl_sec=3600, max_items=128):
        self.ttl = ttl_sec
        self.max = max_items
        self.store = {}

    def get(self, key):
        v = self.store.get(key)
        if not v: return None
        if time.time() - v[1] > self.ttl:
            self.store.pop(key, None); return None
        return v[0]

    def set(self, key, val):
        if len(self.store) >= self.max:
            # drop oldest
            oldest = sorted(self.store.items(), key=lambda x: x[1][1])[0][0]
            self.store.pop(oldest, None)
        self.store[key] = (val, time.time())

zip_cache = TTLCache(ttl_sec=3600, max_items=32)  # 60 min
menu_cache = TTLCache(ttl_sec=24*3600, max_items=128)  # 24h

# --------------- Helpers ---------------
def sanitize_url(u: str) -> str:
    if not re.match(r"^https?://", u, re.I):
        raise ValueError("URL must start with http(s)://")
    # No internal networks
    if re.search(r"(?i)^(https?://)(127\.|10\.|192\.168\.|169\.254\.)", u):
        raise ValueError("URL not allowed")
    return u

def build_pick_from_rules(items, ctx):
    ranked = rank_items(items, ctx.get("calorie_target",600), ctx.get("prioritize_protein", True), ctx.get("flags",[]))
    return ranked[:3]

def build_pick_from_playbook(name, cuisines, ctx):
    # Try chain match
    import json, os
    with open(os.path.join("data","chain_playbooks.json"), "r") as f:
        chains = json.load(f)
    with open(os.path.join("data","cuisine_playbooks.json"), "r") as f:
        cuisines_db = json.load(f)
    picks = []
    if name in chains:
        picks = chains[name]
    else:
        for c in cuisines or []:
            c = c.lower()
            if c in cuisines_db:
                picks = cuisines_db[c]
                break
    if not picks:
        picks = [{"section":"Playbook","item_name":"Grilled chicken + veg, starch half portion",
                  "description":"Ask for sauce on side"}]
    # Attach scores via rules (use their described text)
    items = [{"section":p.get("section","Playbook"), "item_name":p["item_name"], "description":p.get("description","")} for p in picks]
    return build_pick_from_rules(items, ctx)

def menu_resolver(website: str) -> str:
    # cached
    v = menu_cache.get(website)
    if v: return v
    # simple heuristic: try common paths
    tried = ["/menu","/menus","/food","/dinner","/lunch","/our-menu","/menu.pdf","/menus/dinner","/menus/lunch"]
    base = website.rstrip("/")
    session = requests.Session()
    session.headers.update({"User-Agent": UA})
    for path in tried:
        url = base + path
        try:
            if not robots_allowed(url):
                continue
            r = session.get(url, timeout=15, allow_redirects=True)
            if r.status_code == 200 and ("text/html" in r.headers.get("Content-Type","") or "application/pdf" in r.headers.get("Content-Type","")):
                menu_cache.set(website, url)
                return url
        except Exception:
            continue
    # last resort: scan homepage anchors
    try:
        if robots_allowed(base):
            r = session.get(base, timeout=15)
            if r.ok:
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(r.text, "html.parser")
                for a in soup.find_all("a", href=True):
                    if re.search(r"menu", a.get_text(" ", strip=True), re.I) or re.search(r"/menu|/menus", a["href"], re.I):
                        href = a["href"]
                        if href.startswith("/"):
                            url = base + href
                        elif href.startswith("http"):
                            url = href
                        else:
                            url = base + "/" + href
                        menu_cache.set(website, url)
                        return url
    except Exception:
        pass
    return ""

# ----------------- Routes -----------------
@app.get("/")
def home():
    return render_template("index.html")

@app.get("/_ping")
def _ping():
    return ("ok", 200)

@app.post("/nearby-by-zip")
def nearby_by_zip_post():
    data = request.get_json(force=True, silent=True) or {}
    zipc = str(data.get("zip","")).strip()
    radius = float(data.get("radius_miles", 3.0))
    ctx = {
        "calorie_target": int(data.get("calorie_target", 600)),
        "prioritize_protein": bool(data.get("prioritize_protein", True)),
        "flags": data.get("flags", []) or []
    }
    if not zipc or not zipc.isdigit() or len(zipc) != 5:
        return jsonify({"error":"invalid zip"}), 400
    cache_key = f"{zipc}:{radius}"
    cached = zip_cache.get(cache_key)
    if cached:
        return jsonify(cached)
    # Nominatim + Overpass
    try:
        geo = geocode_zip(zipc)
        if not geo: raise RuntimeError("ZIP not resolved")
        ents = overpass_restaurants(geo["lat"], geo["lon"], radius_mi=radius, limit=25)
    except Exception as e:
        # graceful fallback
        ents = []
    restaurants = []
    for ent in ents[:25]:
        picks = []
        source = "playbook"
        if ent.get("website"):
            murl = menu_resolver(ent["website"])
            if murl:
                # fetch and parse
                try:
                    if robots_allowed(murl):
                        r = requests.get(murl, headers={"User-Agent": UA}, timeout=20)
                        if r.ok and "text/html" in r.headers.get("Content-Type",""):
                            items = extract_html_items(r.text, base_url=murl)
                            if items:
                                picks = build_pick_from_rules(items, ctx)
                                source = "menu"
                except Exception:
                    pass
        if not picks:
            picks = build_pick_from_playbook(ent["name"], ent.get("cuisine"), ctx)
            source = source or "playbook"
        restaurants.append({
            "name": ent["name"],
            "distance_mi": round(ent["distance_mi"],2),
            "cuisine": ent.get("cuisine") or [],
            "website": ent.get("website"),
            "source": source,
            "picks": picks
        })
    # If OSM failed, produce minimal fake list so UI isn't empty
    if not restaurants:
        restaurants = [{
            "name":"Sample Grill",
            "distance_mi": 0.4,
            "cuisine": ["american"],
            "website": None,
            "source":"playbook",
            "picks": build_pick_from_playbook("Sample Grill", ["american"], ctx)
        }]
    payload = {
        "context": {"source":"zip","restaurant_name":None,"zip":zipc,"radius_miles":radius,"calorie_target":ctx["calorie_target"],"flags":ctx["flags"]},
        "restaurants": restaurants,
        "fallback_rules":[
            "Pick grilled lean protein; ask for sauce on the side.",
            "Choose one starch the size of your fist.",
            "If portions are large, box half at the start."
        ]
    }
    zip_cache.set(cache_key, payload)
    return jsonify(payload)

@app.get("/nearby-by-zip-test")
def nearby_by_zip_test():
    zipc = request.args.get("zip","00000")
    radius = float(request.args.get("radius_miles", "3"))
    ctx = {"calorie_target":600,"prioritize_protein":True,"flags":[]}
    # Deterministic small stub
    restaurants = [
        {"name":"Black Olive","distance_mi":0.33,"cuisine":[],"website":None,"source":"playbook","picks": build_pick_from_playbook("Black Olive", [], ctx)},
        {"name":"Joe's Pasta House","distance_mi":0.36,"cuisine":["italian"],"website":"https://joespastahouse.com/","source":"menu","picks": build_pick_from_playbook("Joe's Pasta House", ["italian"], ctx)},
    ]
    payload = {"context":{"source":"zip","restaurant_name":None,"zip":zipc,"radius_miles":radius,"calorie_target":600,"flags":[]},
               "restaurants": restaurants}
    return jsonify(payload)

@app.post("/analyze-url")
def analyze_url_post():
    data = request.get_json(force=True, silent=True) or {}
    url = sanitize_url(str(data.get("url","")).strip())
    ctx = {
        "calorie_target": int(data.get("calorie_target", 600)),
        "prioritize_protein": bool(data.get("prioritize_protein", True)),
        "flags": data.get("flags", []) or []
    }
    if not robots_allowed(url):
        return jsonify({"error":"robots_disallow","message":"Robots.txt disallows fetching this URL. Please upload a PDF instead.","context":{"source":"url"}}), 403
    try:
        r = requests.get(url, headers={"User-Agent": UA}, timeout=25)
    except Exception as e:
        return jsonify({"error":"fetch_failed","message":str(e)}), 502
    content_type = r.headers.get("Content-Type","")
    restaurants = []
    if "text/html" in content_type:
        items = extract_html_items(r.text, base_url=url)
        picks = build_pick_from_rules(items, ctx)[:3]
        restaurants.append({"name":"Menu","distance_mi":None,"cuisine":[],"website":url,"source":"menu","picks":picks})
    elif "application/pdf" in content_type or url.lower().endswith(".pdf"):
        items = extract_from_pdf_bytes(r.content, use_ocr=False)
        picks = build_pick_from_rules(items, ctx)[:3]
        restaurants.append({"name":"Menu PDF","distance_mi":None,"cuisine":[],"website":url,"source":"menu","picks":picks})
    else:
        return jsonify({"error":"unsupported","message":f"Unsupported content-type: {content_type}"}), 415
    payload = {"context":{"source":"url","restaurant_name":None,"zip":None,"radius_miles":None,
                          "calorie_target":ctx["calorie_target"],"flags":ctx["flags"]},
               "restaurants":restaurants}
    return jsonify(payload)

@app.get("/analyze-url-test")
def analyze_url_test():
    url = request.args.get("url","")
    ctx = {"calorie_target":600,"prioritize_protein":True,"flags":[]}
    # Short stub independent of network
    items = [
        {"section":"Steak","item_name":"Grilled Sirloin","description":"with vegetables and baked potato"},
        {"section":"Seafood","item_name":"Seared Salmon","description":"lemon, herbs, broccoli"}
    ]
    picks = build_pick_from_rules(items, ctx)
    payload = {"context":{"source":"url","restaurant_name":None,"zip":None,"radius_miles":None,"calorie_target":600,"flags":[]},
               "restaurants":[{"name":"Menu","distance_mi":None,"cuisine":[],"website":url,"source":"menu","picks":picks}]}
    return jsonify(payload)

@app.post("/analyze-pdf")
def analyze_pdf():
    f = request.files.get("menu_pdf")
    use_ocr = (request.form.get("use_ocr","0") == "1")
    if not f: return jsonify({"error":"no_file"}), 400
    pdf_bytes = f.read()
    items = extract_from_pdf_bytes(pdf_bytes, use_ocr=use_ocr)
    ctx = {
        "calorie_target": int(request.form.get("calorie_target", "600")),
        "prioritize_protein": request.form.get("prioritize_protein","1") == "1",
        "flags": request.form.getlist("flags")
    }
    picks = build_pick_from_rules(items, ctx)[:3]
    payload = {"context":{"source":"pdf","restaurant_name":None,"zip":None,"radius_miles":None,
                          "calorie_target":ctx["calorie_target"],"flags":ctx["flags"]},
               "restaurants":[{"name":"Uploaded Menu","distance_mi":None,"cuisine":[],"website":None,"source":"menu","picks":picks}]}
    return jsonify(payload)

@app.get("/openfoodfacts")
def off_proxy():
    q = request.args.get("q","").strip()
    if not q: return jsonify({"items":[]})
    try:
        data = search_off(q, page_size=10)
        return jsonify({"context":{"source":"openfoodfacts"}, **data})
    except Exception as e:
        return jsonify({"items":[],"error":str(e)}), 502

@app.post("/rank")
def rank_endpoint():
    data = request.get_json(force=True, silent=True) or {}
    items = data.get("items", [])
    ctx = {
        "calorie_target": int(data.get("calorie_target", 600)),
        "prioritize_protein": bool(data.get("prioritize_protein", True)),
        "flags": data.get("flags", []) or []
    }
    picks = rank_items(items, ctx["calorie_target"], ctx["prioritize_protein"], ctx["flags"])[:5]
    return jsonify({"picks": picks})

# Favicon (optional nice to have)
@app.get("/favicon.ico")
def favicon():
    return send_from_directory("static", "favicon.ico", mimetype="image/x-icon")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "10000"))
    app.run(host="0.0.0.0", port=port)
