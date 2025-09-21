# Minimal robots.txt checker
from __future__ import annotations
import urllib.parse as urlparse
import requests
from functools import lru_cache

HEADERS = {"User-Agent": "FineDiningCoach-Free/1.0 (+https://example.local)"}

@lru_cache(maxsize=256)
def fetch_robots_txt(base_url: str, timeout: float = 5.0) -> str|None:
    try:
        parsed = urlparse.urlparse(base_url)
        robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
        r = requests.get(robots_url, headers=HEADERS, timeout=timeout)
        if r.status_code == 200 and "Disallow" in r.text:
            return r.text
        if r.status_code == 404:
            return ""
    except Exception:
        return None
    return ""

def allowed_by_robots(target_url: str) -> bool:
    try:
        parsed = urlparse.urlparse(target_url)
        base = f"{parsed.scheme}://{parsed.netloc}"
        txt = fetch_robots_txt(base) or ""
        # extremely simple allow: if disallow contains the path prefix, block
        path = parsed.path or "/"
        disallows = []
        for line in txt.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.lower().startswith("disallow:"):
                rule = line.split(":",1)[1].strip()
                disallows.append(rule)
        for d in disallows:
            if d == "":
                # Disallow:  (empty) means allow all for that user-agent block, but we are naive; treat as allow
                continue
            if path.startswith(d):
                return False
        return True
    except Exception:
        # if robots cannot be fetched or parsed, be safe and allow only homepage fetches
        return parsed.path in ("","/")
