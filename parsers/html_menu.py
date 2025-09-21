from __future__ import annotations
from bs4 import BeautifulSoup
import re

def extract_menu_items(html: str) -> list[dict]:
    """
    Heuristic HTML parser that looks for headings and item blocks with names/desc/prices.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Try common menu containers
    containers = soup.select("[class*=menu], [id*=menu], .menu-section, .menu, .menu-list")
    if not containers:
        containers = [soup]

    items = []
    for c in containers:
        # Section header candidates
        section = None
        for node in c.descendants:
            if getattr(node, "name", None) in ["h1","h2","h3","h4","h5"]:
                section = (node.get_text(" ", strip=True) or "").strip()
            if getattr(node, "name", None) in ["li","div","p"]:
                text = (node.get_text(" ", strip=True) or "").strip()
                if not text or len(text) < 5: 
                    continue
                # find price at end like $12 or 12.00
                m = re.search(r"(.*?)(?:\s+\$?\d+(?:\.\d{2})?)?$", text)
                name = ""
                desc = text
                # Heuristic split: strong/b tags for item name
                strong = node.find(["strong","b"])
                if strong:
                    name = strong.get_text(" ", strip=True)
                    desc = text.replace(name, "", 1).strip(" -–:")
                else:
                    # split by dash if present
                    parts = re.split(r"\s+-\s+|\s+–\s+", text, maxsplit=1)
                    if len(parts)==2 and len(parts[0])<=60:
                        name, desc = parts[0], parts[1]
                    else:
                        # first 4 words as name if capitalized
                        words = text.split()
                        if words and words[0][0].isupper():
                            name = " ".join(words[:min(5, len(words))])
                            desc = text[len(name):].strip(" -–:")

                if name and len(name) <= 80:
                    items.append({"section": section or "", "name": name, "description": desc})
    # de-dup by name+desc
    seen = set()
    uniq = []
    for it in items:
        key = (it["name"].lower(), it["description"].lower())
        if key in seen: 
            continue
        seen.add(key)
        uniq.append(it)
    return uniq[:200]
