import urllib.parse as urlparse
import requests
import urllib.robotparser as robotparser

UA = "FineDiningCoach/1.0 (contact: demo@example.com)"

def is_allowed(url: str) -> bool:
    try:
        parts = urlparse.urlsplit(url)
        robots_url = f"{parts.scheme}://{parts.netloc}/robots.txt"
        rp = robotparser.RobotFileParser()
        r = requests.get(robots_url, headers={"User-Agent": UA}, timeout=8)
        if r.status_code >= 400:
            rp.parse([])
        else:
            rp.parse(r.text.splitlines())
        return rp.can_fetch(UA, url)
    except Exception:
        return False
