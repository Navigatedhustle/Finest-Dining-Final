from typing import List, Dict, Any
import io
import re

def extract_from_pdf_bytes(pdf_bytes: bytes, use_ocr: bool = False) -> List[Dict[str,Any]]:
    items = []
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            lines = []
            for page in pdf.pages[:20]:
                text = page.extract_text() or ""
                for ln in text.splitlines():
                    ln = ln.strip()
                    if ln:
                        lines.append(ln)
    except Exception:
        lines = []

    if not lines and use_ocr:
        try:
            from PIL import Image
            import pdf2image  # optional if available
        except Exception:
            pass

    # Grouping: a header is ALL CAPS or Title Case short-ish line
    section = ""
    for ln in lines:
        is_header = (ln.isupper() and len(ln) <= 40) or (re.match(r"^[A-Z][a-z]+(?: [A-Z][a-z]+){0,4}$", ln) and len(ln) <= 50)
        if is_header:
            section = ln.title()
            continue
        # Treat as potential item: first sentence up to ' - ' or end
        if len(ln) >= 6:
            parts = ln.split(" - ", 1)
            name = parts[0][:80]
            desc = parts[1] if len(parts)==2 else ""
            items.append({"section": section, "item_name": name, "description": desc})
    return items[:200]
