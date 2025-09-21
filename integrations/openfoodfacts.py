from __future__ import annotations
import requests

HEADERS = {"User-Agent": "FineDiningCoach-Free/1.0 (+https://example.local)"}

def search_off(query: str, page_size: int=5) -> list[dict]:
    url = "https://world.openfoodfacts.org/cgi/search.pl"
    params = {
        "search_terms": query,
        "search_simple": 1,
        "json": 1,
        "page_size": page_size,
        "fields": "product_name,brands,nutriments,serving_size"
    }
    r = requests.get(url, params=params, headers=HEADERS, timeout=12)
    r.raise_for_status()
    data = r.json()
    out = []
    for p in data.get("products", []):
        nutr = p.get("nutriments", {}) or {}
        kcal_100 = nutr.get("energy-kcal_100g") or nutr.get("energy-kcal_serving")
        protein_100 = nutr.get("proteins_100g") or nutr.get("proteins_serving")
        out.append({
            "name": p.get("product_name"),
            "brand": p.get("brands"),
            "energy_kcal_per_100g": kcal_100,
            "protein_per_100g": protein_100,
            "serving_size": p.get("serving_size")
        })
    return out
