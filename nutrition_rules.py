"""
Deterministic nutrition scoring rules for Fine Dining Coach.
No paid services or LLM calls. Everything is simple heuristics.

We keep functions small and testable.
"""

import re
from dataclasses import dataclass
from typing import List, Dict, Any, Tuple

PROTEIN_CUES = [
    "chicken","turkey","steak","beef","salmon","tuna","shrimp","prawn","tofu","tempeh","egg","eggs","yogurt","greek yogurt","pork loin"
]

LEAN_COOKING = ["grilled","baked","roasted","seared","steamed","poached","broiled","oven","charbroiled"]
RICH_COOKING = ["fried","battered","tempura","creamy","alfredo","hollandaise","aioli","butter","buttered","smothered","cheesy","cheese sauce"]

STARCHES = ["rice","pasta","bun","tortilla","fries","chips","potato","potatoes","gnocchi","couscous","noodles","bread"]

HIGH_CAL_SAUCES = ["mayo","aioli","ranch","queso","alfredo","cream","butter","cheese sauce"]
LOW_CAL_SAUCES  = ["salsa","tomato sauce","marinara","chimichurri","vinaigrette","salsa verde"]

SECTION_PRIORS = [
    ("salad", (350,650), (22,45)),
    ("bowl",  (550,800), (25,45)),
    ("burger",(700,1000),(25,40)),
    ("pasta", (700,1100),(15,30)),
    ("taco",  (150,250), (12,25)),
    ("steak", (450,800), (30,50)),
    ("sandwich",(500,850),(20,35)),
    ("seafood",(450,800),(25,45)),
]

@dataclass
class ScoreResult:
    est_kcal: int
    est_protein_g: int
    evidence: Dict[str, Any]
    confidence: str
    score: float
    modifiers: List[str]
    why: str

def _count_hits(text: str, tokens: List[str]) -> int:
    t = text.lower()
    return sum(1 for w in tokens if w in t)

def _estimate_from_section(section: str) -> Tuple[Tuple[int,int], Tuple[int,int]]:
    s = (section or "").lower()
    for key, cal_rng, prot_rng in SECTION_PRIORS:
        if key in s:
            return cal_rng, prot_rng
    # default broad prior
    return (500,900), (20,40)

def estimate(text: str, section: str) -> Tuple[int,int, Dict[str,Any]]:
    """Return (kcal, protein_g, evidence) using cues and priors."""
    cal_rng, prot_rng = _estimate_from_section(section)

    protein_hits = _count_hits(text, PROTEIN_CUES)
    lean_hits    = _count_hits(text, LEAN_COOKING)
    rich_hits    = _count_hits(text, RICH_COOKING)
    starch_hits  = _count_hits(text, STARCHES)

    # start with mid-point
    kcal = int((cal_rng[0] + cal_rng[1]) / 2)
    protein = int((prot_rng[0] + prot_rng[1]) / 2)

    # adjust determinstically
    kcal += 60 * rich_hits
    kcal -= 35 * lean_hits
    kcal += 40 * starch_hits

    protein += 6 * protein_hits
    protein += 2 * lean_hits
    protein -= 2 * rich_hits

    kcal = max(250, min(1200, kcal))
    protein = max(8, min(80, protein))

    evidence = {
        "signals": [],
        "protein_hits": protein_hits,
        "lean_hits": lean_hits,
        "rich_hits": rich_hits,
        "starch_hits": starch_hits,
    }
    if protein_hits: evidence["signals"].append(f"protein_cues:{protein_hits}")
    if lean_hits:    evidence["signals"].append("lean_cooking")
    if rich_hits:    evidence["signals"].append("rich_cooking")
    if starch_hits:  evidence["signals"].append(f"starches:{starch_hits}")
    if section:      evidence["signals"].append(f"section:{section.lower()}")
    return kcal, protein, evidence

def score_item(name: str, description: str, section: str, calorie_target: int = 600,
               prioritize_protein: bool = True, flags: List[str] = None) -> ScoreResult:
    flags = flags or []
    text = " ".join([name or "", description or ""])
    kcal, protein, ev = estimate(text, section)

    # normalize features
    prot_norm = min(1.0, max(0.0, (protein - 10) / 60.0))
    closeness = max(0.0, 1.0 - abs(kcal - calorie_target) / max(250, calorie_target))
    rich_pen = 0.15 * ev.get("rich_hits", 0)

    conflict_pen = 0.0
    t = text.lower()
    if "low_carb" in flags and _count_hits(t, STARCHES) > 0:
        conflict_pen += 0.15
    if "no_fried" in flags and _count_hits(t, ["fried","tempura","battered"]) > 0:
        conflict_pen += 0.2
    # gluten/dairy are heuristic words only
    if "gluten_mindful" in flags and "pasta" in t:
        conflict_pen += 0.1
    if "dairy_mindful" in flags and _count_hits(t, ["cheese","cream","alfredo","yogurt"]) > 0:
        conflict_pen += 0.1

    protein_w = 0.6 if prioritize_protein else 0.35
    target_w  = 0.4 if prioritize_protein else 0.55

    score = (protein_w * prot_norm) + (target_w * closeness) - rich_pen - conflict_pen
    score = max(0.0, min(1.0, score))

    conf = "low"
    hits = ev.get("protein_hits",0) + ev.get("lean_hits",0) + ev.get("starch_hits",0) + ev.get("rich_hits",0)
    if hits >= 4: conf = "high"
    elif hits >= 2: conf = "medium"

    # Simple modifiers
    modifiers = []
    if _count_hits(t, HIGH_CAL_SAUCES) > 0: modifiers.append("sauce on side")
    if _count_hits(t, STARCHES) > 0: modifiers.append("half starch")
    if _count_hits(t, LEAN_COOKING) > 0: modifiers.append("extra vegetables")
    if "fried" in t: modifiers.append("ask grilled if possible")

    why = "High protein emphasis, closer to your target."

    return ScoreResult(
        est_kcal=int(kcal), est_protein_g=int(protein),
        evidence={"final_score": round(score,3), "protein_norm": round(prot_norm,3),
                  "closeness": round(closeness,3), "rich_pen": round(rich_pen,3),
                  "flag_pen": round(conflict_pen,3), "signals": ev.get("signals", [])},
        confidence=conf, score=score, modifiers=modifiers, why=why
    )

def rank_items(items: List[Dict[str,Any]], calorie_target: int = 600,
               prioritize_protein: bool = True, flags: List[str] = None) -> List[Dict[str,Any]]:
    ranked = []
    for it in items:
        sres = score_item(it.get("item_name",""), it.get("description",""), it.get("section",""),
                          calorie_target, prioritize_protein, flags or [])
        ranked.append({
            "section": it.get("section"),
            "item_name": it.get("item_name"),
            "description": it.get("description",""),
            "est_kcal": sres.est_kcal,
            "est_protein_g": sres.est_protein_g,
            "confidence": sres.confidence,
            "modifiers": sres.modifiers[:3],
            "server_script": f"Could I get the {it.get('item_name')} with " + (", ".join(sres.modifiers) if sres.modifiers else "those default options, please?"),
            "why_it_works": sres.why,
            "evidence": sres.evidence,
            "score": sres.score,
        })
    ranked.sort(key=lambda x: x["score"], reverse=True)
    return ranked
