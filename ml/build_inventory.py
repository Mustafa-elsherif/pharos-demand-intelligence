"""Build a realistic inventory snapshot and derive restock and expiry alerts.

The sales dataset has no stock levels, so a deterministic inventory is generated
(seeded, reproducible) and then driven by the real forecast: reorder points come
from forecast demand over the supplier lead time plus statistical safety stock.
Expiry alerts come from batch dates relative to the dataset's final day.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ml"))
from domain import CATEGORIES  # noqa: E402

ARTIFACTS = ROOT / "backend" / "artifacts"
LEAD_TIME_DAYS = 7
SERVICE_Z = 1.65          # ~95% service level
RNG = np.random.default_rng(7)

# Representative product per sub-item of each category (name, pack size label).
PRODUCTS = {
    "M01AB": [("Diclofenac 50mg tablets", "x30"), ("Ketorolac 10mg tablets", "x20")],
    "M01AE": [("Ibuprofen 400mg tablets", "x24"), ("Naproxen 250mg tablets", "x28")],
    "N02BA": [("Aspirin 300mg tablets", "x32")],
    "N02BE": [("Paracetamol 500mg tablets", "x32"),
              ("Paracetamol 500mg capsules", "x16"),
              ("Paracetamol 120mg/5ml suspension", "100ml")],
    "N05B": [("Diazepam 5mg tablets", "x28"), ("Alprazolam 0.5mg tablets", "x30")],
    "N05C": [("Zolpidem 10mg tablets", "x28")],
    "R03": [("Salbutamol 100mcg inhaler", "200 dose"),
            ("Budesonide 200mcg inhaler", "120 dose")],
    "R06": [("Cetirizine 10mg tablets", "x30"), ("Loratadine 10mg tablets", "x30")],
}


def main() -> None:
    hist = pd.read_csv(ARTIFACTS / "history.csv")
    hist["datum"] = pd.to_datetime(hist["datum"])
    hist = hist.set_index("datum").sort_index()
    as_of = hist.index.max()

    forecasts = json.loads((ARTIFACTS / "forecasts.json").read_text())
    daily_std = {c: float(hist[c].tail(90).std()) for c in CATEGORIES}

    items, low_stock, expiry = [], [], []
    pid = 0
    for cat, meta in CATEGORIES.items():
        prods = PRODUCTS[cat]
        # split category demand across products by descending weight
        weights = np.linspace(1.0, 0.6, len(prods))
        weights = weights / weights.sum()
        cat_7 = forecasts["categories"][cat]["next7_units"]
        shelf = meta["shelf_life_days"]

        for (name, pack), w in zip(prods, weights):
            pid += 1
            lead_demand = cat_7 / 7 * LEAD_TIME_DAYS * w
            safety = SERVICE_Z * (daily_std[cat] * w) * np.sqrt(LEAD_TIME_DAYS)
            reorder = int(np.ceil(lead_demand + safety))

            # stock position: some items deliberately below reorder point
            factor = RNG.uniform(0.2, 1.9)
            on_hand = int(max(0, round(reorder * factor)))

            # batches with expiry dates relative to as_of
            n_batches = int(RNG.integers(1, 4))
            batches = []
            remaining = on_hand
            for b in range(n_batches):
                qty = remaining if b == n_batches - 1 else int(remaining * RNG.uniform(0.3, 0.7))
                remaining -= qty
                # expiry anywhere from already-short to full shelf life
                days_to_exp = int(RNG.uniform(-10, shelf * 0.9))
                exp = as_of + pd.Timedelta(days=days_to_exp)
                batch = {
                    "batch_no": f"B{pid:02d}{b+1}",
                    "qty": int(qty),
                    "expiry": exp.strftime("%Y-%m-%d"),
                    "days_to_expiry": days_to_exp,
                }
                batches.append(batch)
                if qty > 0 and days_to_exp <= 90:
                    sev = "expired" if days_to_exp < 0 else (
                        "urgent" if days_to_exp <= 30 else "soon")
                    expiry.append({
                        "product_id": pid, "product": name, "category": cat,
                        "batch_no": batch["batch_no"], "qty": int(qty),
                        "expiry": batch["expiry"], "days_to_expiry": days_to_exp,
                        "severity": sev,
                    })

            item = {
                "product_id": pid, "name": name, "pack": pack, "category": cat,
                "category_name": meta["name"], "on_hand": on_hand,
                "reorder_point": reorder,
                "cover_days": round(on_hand / max(cat_7 / 7 * w, 0.1), 1),
                "batches": batches,
            }
            items.append(item)
            if on_hand <= reorder:
                low_stock.append({
                    "product_id": pid, "product": name, "category": cat,
                    "on_hand": on_hand, "reorder_point": reorder,
                    "suggested_order": int(max(reorder * 2 - on_hand, reorder)),
                    "cover_days": item["cover_days"],
                })

    low_stock.sort(key=lambda r: r["cover_days"])
    sev_rank = {"expired": 0, "urgent": 1, "soon": 2}
    expiry.sort(key=lambda r: (sev_rank[r["severity"]], r["days_to_expiry"]))

    payload = {
        "as_of": as_of.strftime("%Y-%m-%d"),
        "lead_time_days": LEAD_TIME_DAYS,
        "service_level": "95%",
        "n_products": len(items),
        "inventory_value_units": int(sum(i["on_hand"] for i in items)),
        "items": items,
        "low_stock": low_stock,
        "expiry": expiry,
        "counts": {
            "low_stock": len(low_stock),
            "expiring_soon": sum(1 for e in expiry if e["severity"] == "soon"),
            "expiring_urgent": sum(1 for e in expiry if e["severity"] == "urgent"),
            "expired": sum(1 for e in expiry if e["severity"] == "expired"),
        },
    }
    (ARTIFACTS / "inventory.json").write_text(json.dumps(payload, indent=2))
    print(f"products={len(items)} low_stock={len(low_stock)} "
          f"expiry_alerts={len(expiry)} {payload['counts']}")


if __name__ == "__main__":
    main()
