import requests, math, time
from typing import List, Dict, Any

UA = "FineDiningCoach/1.0 (contact: demo@example.com)"

def geocode_zip(zipcode: str) -> Dict[str,float]:
    url = "https://nominatim.openstreetmap.org/search"
    params = {"q": zipcode, "countrycodes":"us", "format":"jsonv2", "limit":1}
    r = requests.get(url, params=params, headers={"User-Agent": UA}, timeout=15)
    r.raise_for_status()
    data = r.json()
    if not data:
        return {}
    return {"lat": float(data[0]["lat"]), "lon": float(data[0]["lon"])}

def haversine(lat1, lon1, lat2, lon2):
    R=3958.8 # miles
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2-lat1)
    dl = math.radians(lon2-lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dl/2)**2
    return 2*R*math.asin(math.sqrt(a))

def overpass_restaurants(lat: float, lon: float, radius_mi: float=3.0, limit:int=25) -> List[Dict[str,Any]]:
    radius_m = max(100, int(radius_mi * 1609.34))
    q = f"""
    [out:json][timeout:25];
    (
      node["amenity"="restaurant"](around:{radius_m},{lat},{lon});
      way["amenity"="restaurant"](around:{radius_m},{lat},{lon});
      relation["amenity"="restaurant"](around:{radius_m},{lat},{lon});
    );
    out center 60;
    """
    r = requests.post("https://overpass-api.de/api/interpreter", data=q.encode("utf-8"), headers={"User-Agent": UA}, timeout=55)
    r.raise_for_status()
    data = r.json()
    ents = []
    for el in data.get("elements", []):
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name: continue
        web = tags.get("website") or tags.get("contact:website")
        cuisine_raw = tags.get("cuisine","")
        cuisine = [c.strip() for c in cuisine_raw.split(";") if c.strip()] if cuisine_raw else []
        lat2 = el.get("lat") or (el.get("center") or {}).get("lat")
        lon2 = el.get("lon") or (el.get("center") or {}).get("lon")
        if lat2 is None or lon2 is None: continue
        dist = haversine(lat, lon, float(lat2), float(lon2))
        ents.append({
            "name": name, "website": web, "cuisine": cuisine,
            "lat": float(lat2), "lon": float(lon2), "distance_mi": dist
        })
    ents.sort(key=lambda x: x["distance_mi"])
    return ents[:limit]
