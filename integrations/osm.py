from __future__ import annotations
import time, math
import requests

HEADERS = {"User-Agent": "FineDiningCoach-Free/1.0 (+https://example.local)"}

def geocode_zip(zip_code: str) -> tuple[float,float] | None:
    url = "https://nominatim.openstreetmap.org/search"
    params = {"postalcode": zip_code, "countrycodes": "us", "format": "jsonv2", "limit": 1}
    r = requests.get(url, params=params, headers=HEADERS, timeout=10)
    r.raise_for_status()
    data = r.json()
    if not data:
        return None
    lat = float(data[0]["lat"]); lon = float(data[0]["lon"])
    time.sleep(1)  # be kind to rate limits
    return lat, lon

def overpass_restaurants(lat: float, lon: float, radius_miles: float=3.0, limit: int=25) -> list[dict]:
    radius_m = max(200, int(radius_miles * 1609.34))
    q = f"""
    [out:json][timeout:25];
    (
      node["amenity"="restaurant"](around:{radius_m},{lat},{lon});
      way["amenity"="restaurant"](around:{radius_m},{lat},{lon});
      relation["amenity"="restaurant"](around:{radius_m},{lat},{lon});
    );
    out center {limit};
    """
    url = "https://overpass-api.de/api/interpreter"
    r = requests.post(url, data=q, headers=HEADERS, timeout=35)
    r.raise_for_status()
    data = r.json()
    time.sleep(1)  # gentle
    results = []
    for el in data.get("elements", [])[:limit]:
        tags = el.get("tags", {})
        name = tags.get("name")
        website = tags.get("website") or tags.get("contact:website")
        cuisine = [c.strip() for c in (tags.get("cuisine","") or "").split(";") if c.strip()]
        latc = el.get("lat") or (el.get("center") or {}).get("lat")
        lonc = el.get("lon") or (el.get("center") or {}).get("lon")
        if not name or latc is None or lonc is None: 
            continue
        # rough distance
        dist = haversine(lat, lon, float(latc), float(lonc))
        results.append({
            "name": name,
            "website": website,
            "cuisine": cuisine,
            "lat": float(latc),
            "lon": float(lonc),
            "distance_mi": round(dist,2),
            "id": el.get("id"),
        })
    results.sort(key=lambda x: x["distance_mi"])
    return results[:limit]

def haversine(lat1, lon1, lat2, lon2):
    R = 3958.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = (math.sin(dphi/2)**2 +
         math.cos(p1) * math.cos(p2) * math.sin(dl/2)**2)
    return 2 * R * math.asin(math.sqrt(a))
