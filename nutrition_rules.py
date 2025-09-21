# Deterministic nutrition heuristics and scoring
from __future__ import annotations
import re
from dataclasses import dataclass, field
from typing import List, Dict, Any, Tuple

LEAN_PROTEINS = [
    "chicken","turkey","steak","beef","salmon","tuna","shrimp","prawn","tofu","egg","eggs",
    "yogurt","greek yogurt","lamb","pork","ham"
]

COOKING_LEAN = ["grilled","baked","roasted","seared","steamed","poached","broiled"]
COOKING_RICH = ["fried","battered","tempura","creamy","alfredo","hollandaise","aioli","butter","buttered","smothered","cheesy","cheese sauce","queso"]

STARCHES = ["rice","pasta","bun","tortilla","fries","potato","potatoes","gnocchi","couscous","bread","noodles"]
HIGH_CAL_SAUCES = ["mayo","aioli","ranch","queso","alfredo","cream","butter","hollandaise","cheese sauce"]
LOW_CAL_SAUCES = ["salsa","tomato sauce","marinara","chimichurri","vinaigrette","soy","ponzu","salsa verde"]

SECTION_CAL_RANGES = {
    "salad": (350, 650),
    "bowl": (550, 800),
    "burger": (700, 1000),
    "pasta": (700, 1100),
    "taco": (150, 250),
    "steak": (450, 800),
    "sandwich": (550, 900),
    "wrap": (500, 800),
    "pizza": (250, 350),  # per slice rough
}

SECTION_PRO_TEIR = {
    "lean_entree": (30, 50),
    "burger": (25, 40),
    "pasta": (15, 30),
    "salad_plus_chicken": (28, 45),
}

FLAG_KEYWORDS = {
    "low_carb": ["rice","pasta","bun","tortilla","fries","potato","bread","noodles","gnocchi","couscous"],
    "gluten_mindful": ["flour","bread","pasta","noodles","batter","battered","tortilla"],
    "dairy_mindful": ["cheese","cream","alfredo","butter","yogurt","hollandaise"],
    "no_fried": ["fried","battered","tempura"]
}

SERVER_MODIFIERS = [
    "sauce on the side", "half rice", "extra vegetables", "sub salad for fries",
    "grilled instead of fried", "no mayo/aioli", "light cheese", "extra protein (if available)"
]

@dataclass
class ScoredItem:
    section: str
    item_name: str
    description: str = ""
    est_kcal: int = 0
    est_protein_g: int = 0
    confidence: str = "low"
    modifiers: List[str] = field(default_factory=list)
    server_script: str = ""
    why_it_works: str = ""
    evidence: Dict[str, Any] = field(default_factory=dict)
    score: float = 0.0

def _normalize_text(x: str) -> str:
    return re.sub(r"\s+", " ", x or "").strip().lower()

def _contains_any(text: str, words: List[str]) -> bool:
    t = _normalize_text(text)
    return any(w in t for w in words)

def estimate_kcal_and_protein(section_guess: str, name: str, desc: str) -> Tuple[int,int,str,Dict[str,Any]]:
    """
    Very simple heuristics based on section guess + signals in text.
    """
    text = f"{name} {desc}".lower()
    ev = {"signals": []}
    base_min, base_max = 500, 800  # default
    # Pick a base range by section cues
    for key, (lo, hi) in SECTION_CAL_RANGES.items():
        if key in text or key in section_guess:
            base_min, base_max = lo, hi
            ev["signals"].append(f"section:{key}")
            break

    kcal = int((base_min + base_max) / 2)
    protein = 25

    # protein cues
    pro_hits = sum(1 for p in LEAN_PROTEINS if p in text)
    if pro_hits:
        protein += 7 * pro_hits
        ev["signals"].append(f"protein_cues:{pro_hits}")

    # lean cooking reduces calories slightly
    if _contains_any(text, COOKING_LEAN):
        kcal -= 60
        protein += 2
        ev["signals"].append("lean_cooking")

    # rich cooking increases cals
    rich_hits = sum(1 for w in COOKING_RICH if w in text)
    if rich_hits:
        kcal += 100 + 30 * (rich_hits - 1)
        ev["signals"].append(f"rich_cooking:{rich_hits}")

    # starch bumps
    starch_hits = sum(1 for s in STARCHES if s in text)
    if starch_hits:
        kcal += 60 + 30 * (starch_hits - 1)
        ev["signals"].append(f"starches:{starch_hits}")

    # sauce adjustments
    if _contains_any(text, HIGH_CAL_SAUCES):
        kcal += 80
        ev["signals"].append("high_cal_sauce")
    if _contains_any(text, LOW_CAL_SAUCES):
        kcal -= 40
        ev["signals"].append("low_cal_sauce")

    kcal = max(120, kcal)
    protein = max(8, protein)
    # confidence based on number of signals
    sig_count = len(ev["signals"])
    if sig_count >= 3:
        conf = "high"
    elif sig_count == 2:
        conf = "medium"
    else:
        conf = "low"
    return kcal, protein, conf, ev

def score_item(item: ScoredItem, calorie_target: int, flags: List[str], prioritize_protein: bool, max_fat: int|None = None) -> ScoredItem:
    # normalized protein ~ 60g scale
    protein_norm = min(item.est_protein_g, 60) / 60.0
    # closeness to target
    tdiff = abs(item.est_kcal - calorie_target)
    closeness = max(0.0, 1.0 - tdiff / max(200.0, calorie_target))  # linear falloff

    rich_pen = 0.0
    if _contains_any(item.item_name + " " + item.description, COOKING_RICH + HIGH_CAL_SAUCES):
        rich_pen = 0.25

    flag_pen = 0.0
    for f in flags:
        kws = FLAG_KEYWORDS.get(f, [])
        if _contains_any(item.item_name + " " + item.description, kws):
            flag_pen += 0.2

    protein_weight = 0.6 if prioritize_protein else 0.4
    target_weight = 0.4 if prioritize_protein else 0.6

    item.score = protein_weight * protein_norm + target_weight * closeness - rich_pen - flag_pen
    # suggest default modifiers
    mods = []
    if _contains_any(item.item_name + " " + item.description, STARCHES):
        mods.append("half rice" if "rice" in (item.item_name+" "+item.description).lower() else "open-faced (skip top bun)")
    if _contains_any(item.item_name + " " + item.description, HIGH_CAL_SAUCES + ["mayo","aioli"]):
        mods.append("sauce on the side")
    if _contains_any(item.item_name + " " + item.description, ["fried","battered","tempura"]):
        mods.append("grilled instead of fried (if possible)")
    mods.append("extra vegetables")
    item.modifiers = list(dict.fromkeys(mods))[:4]

    # server script
    ask_parts = []
    if "sauce on the side" in item.modifiers:
        ask_parts.append("sauce on the side")
    if any(m.startswith("half") for m in item.modifiers):
        ask_parts.append("half rice")
    if "grilled instead of fried (if possible)" in item.modifiers:
        ask_parts.append("grilled instead of fried")
    if "extra vegetables" in item.modifiers:
        ask_parts.append("extra vegetables")
    if not ask_parts:
        ask_parts = ["light oil", "add extra veggies if available"]
    item.server_script = f"Could I get the {item.item_name} with " + ", ".join(ask_parts) + "?"

    item.why_it_works = "High protein emphasis, controlled add-ons, closer to your calorie target."
    item.evidence.update({
        "protein_norm": round(protein_norm,3),
        "closeness": round(closeness,3),
        "rich_pen": rich_pen,
        "flag_pen": round(flag_pen,3),
        "final_score": round(item.score,3)
    })
    return item

def rank_items(raw_items: List[Dict[str,Any]], params: Dict[str,Any]) -> Dict[str,Any]:
    calorie_target = int(params.get("calorie_target", 600))
    flags = params.get("flags", [])
    prioritize_protein = bool(params.get("prioritize_protein", True))
    # max_fat currently unused in deterministic estimate, placeholder for future
    picks = []
    for it in raw_items:
        name = it.get("name") or it.get("item_name") or ""
        desc = it.get("description") or ""
        section = it.get("section") or ""
        est_kcal, est_pro, conf, ev = estimate_kcal_and_protein(section, name, desc)
        scored = ScoredItem(section=section, item_name=name, description=desc, est_kcal=est_kcal, est_protein_g=est_pro, confidence=conf, evidence=ev)
        scored = score_item(scored, calorie_target, flags, prioritize_protein)
        picks.append(scored)

    picks.sort(key=lambda x: x.score, reverse=True)
    top = picks[:2]
    alts = picks[2:6]
    result = {
        "picks": [x.__dict__ for x in top],
        "alternates": [x.__dict__ for x in alts],
        "fallback_rules": [
            "Pick grilled lean protein, ask for sauce on the side.",
            "Choose one starch about the size of your fist.",
            "If portions are large, box half at the start."
        ]
    }
    return result
