import requests
from typing import List, Dict, Any

UA = "FineDiningCoach/1.0 (contact: demo@example.com)"

def search_off(query: str, page_size:int=10) -> Dict[str,Any]:
    url = "https://world.openfoodfacts.org/cgi/search.pl"
    params = {"search_terms": query, "search_simple": 1, "json": 1, "page_size": page_size}
    r = requests.get(url, params=params, headers={"User-Agent": UA}, timeout=20)
    r.raise_for_status()
    data = r.json()
    items = []
    for p in data.get("products", []):
        name = p.get("product_name") or p.get("generic_name") or ""
        brand = p.get("brands") or ""
        nutr = p.get("nutriments", {})
        per100 = {"energy_kcal_100g": nutr.get("energy-kcal_100g") or nutr.get("energy-kcal_value")}
        per_serv = {"energy_kcal_serving": nutr.get("energy-kcal_serving"),
                    "proteins_serving": nutr.get("proteins_serving")}
        items.append({
            "name": name, "brand": brand,
            "energy_kcal_100g": per100["energy_kcal_100g"],
            "protein_100g": nutr.get("proteins_100g"),
            "energy_kcal_serving": per_serv["energy_kcal_serving"],
            "protein_serving": per_serv["proteins_serving"],
            "serving_size": p.get("serving_size")
        })
    return {"count": len(items), "items": items}
