from __future__ import annotations
import io, re
import pdfplumber
from PIL import Image
try:
    import pytesseract
except Exception:
    pytesseract = None

def extract_text_blocks_from_pdf(data: bytes, ocr: bool=False, max_pages: int = 20) -> str:
    text = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for i, page in enumerate(pdf.pages[:max_pages]):
            t = page.extract_text(x_tolerance=2) or ""
            if t.strip():
                text.append(t)
    big = "\n".join(text).strip()
    if not big and ocr and pytesseract:
        # crude OCR: rasterize each page and run Tesseract
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for page in pdf.pages[:max_pages]:
                im = page.to_image(resolution=200).original
                if not isinstance(im, Image.Image):
                    im = Image.fromarray(im)
                t = pytesseract.image_to_string(im)
                if t.strip():
                    text.append(t)
        big = "\n".join(text).strip()
    return big

def extract_menu_items_from_text(text: str) -> list[dict]:
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    items = []
    section = ""
    for ln in lines:
        # header if all caps or Title Case and short
        if (ln.isupper() or re.match(r"^([A-Z][a-z]+)(\s[A-Z][a-z]+){0,3}$", ln)) and len(ln) <= 40:
            section = ln.title()
            continue
        # item if contains a dash or a sentence-like pattern
        if re.search(r"\s[-–]\s", ln) or (len(ln.split()) > 3 and ln[0].isalpha()):
            # split name - desc
            parts = re.split(r"\s[-–]\s", ln, maxsplit=1)
            if len(parts)==2:
                name, desc = parts
            else:
                # first sentence as name-ish
                words = ln.split()
                name = " ".join(words[:min(6, len(words))])
                desc = " ".join(words[min(6, len(words)):])
            if len(name) <= 80:
                items.append({"section": section, "name": name, "description": desc})
    # compact
    uniq = []
    seen=set()
    for it in items:
        k=(it["name"].lower(), it["description"].lower())
        if k in seen: continue
        seen.add(k)
        uniq.append(it)
    return uniq[:200]
