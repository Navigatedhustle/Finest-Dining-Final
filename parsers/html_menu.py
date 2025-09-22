from bs4 import BeautifulSoup
from typing import List, Dict, Any
import re

SECTION_HINTS = ["starters","appetizer","mains","entrees","salads","pasta","pizza","sandwich","bowls","tacos","seafood","steak","sides"]

def extract_items(html: str, base_url: str = "") -> List[Dict[str,Any]]:
    soup = BeautifulSoup(html, "html.parser")

    # Try semantic menu item containers first
    items = []
    for sel in [".menu-item", ".dish", ".item", ".menu__item", ".c-menu-item"]:
        for el in soup.select(sel):
            name = (el.find(class_=re.compile("title|name")) or el.find("h3") or el.find("h4"))
            desc = (el.find(class_=re.compile("desc|description|body")))
            section = None
            parent = el.find_parent(re.compile("section|div"))
            if parent:
                # crude section: nearest heading above
                heading = parent.find_previous(["h2","h3","h4"])
                if heading:
                    section = heading.get_text(strip=True)
            if not name:
                continue
            items.append({
                "section": section or infer_section(name.get_text(strip=True)),
                "item_name": name.get_text(" ", strip=True),
                "description": desc.get_text(" ", strip=True) if desc else "",
            })

    # Fallback: headings with following lis or ps
    if len(items) < 8:
        for h in soup.find_all(["h2","h3","h4"]):
            sec = h.get_text(strip=True)
            nxt = h.find_next_sibling()
            bucket = []
            scans = 0
            while nxt and scans < 6:
                scans += 1
                if nxt.name in ["ul","ol"]:
                    for li in nxt.find_all("li", recursive=False):
                        txt = li.get_text(" ", strip=True)
                        if len(txt) > 3:
                            nm = txt.split(" - ")[0][:80]
                            desc = txt[len(nm):].strip(" -·—:")
                            bucket.append({"section": sec, "item_name": nm, "description": desc})
                elif nxt.name in ["p","div"]:
                    txt = nxt.get_text(" ", strip=True)
                    if len(txt) > 6 and len(txt.split()) >= 2:
                        # Heuristic: strong/b bold name + remainder
                        strong = nxt.find(["strong","b"])
                        if strong:
                            nm = strong.get_text(" ", strip=True)
                            desc = txt.replace(nm, "").strip(" -·—:")
                        else:
                            parts = txt.split(" - ", 1)
                            nm, desc = (parts[0], parts[1]) if len(parts)==2 else (txt[:60], txt[60:])
                        bucket.append({"section": sec, "item_name": nm, "description": desc})
                nxt = nxt.find_next_sibling()
            items.extend(bucket)

    # Deduplicate by name/section
    seen = set()
    uniq = []
    for it in items:
        key = (it["section"] or "") + "|" + (it["item_name"] or "")
        if key in seen: continue
        seen.add(key)
        uniq.append(it)

    return uniq

def infer_section(text: str) -> str:
    t = text.lower()
    for hint in SECTION_HINTS:
        if hint in t: return hint.title()
    return ""
