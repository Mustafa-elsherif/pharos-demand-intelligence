"""Assemble all precomputed JSON the static dashboard needs.

The frontend runs with no backend: every number here is produced once by the
trained models and written to frontend/data so GitHub Pages can serve it.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ml"))
from domain import CATEGORIES  # noqa: E402

ARTIFACTS = ROOT / "backend" / "artifacts"
OUT = ROOT / "frontend" / "data"
CATS = list(CATEGORIES.keys())
RECENT_DAYS = 180


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    hist = pd.read_csv(ARTIFACTS / "history.csv")
    hist["datum"] = pd.to_datetime(hist["datum"])
    hist = hist.set_index("datum").sort_index()
    as_of = hist.index.max()

    metrics = json.loads((ARTIFACTS / "forecast_metrics.json").read_text())
    backtest = json.loads((ARTIFACTS / "forecast_backtest.json").read_text())
    forecasts = json.loads((ARTIFACTS / "forecasts.json").read_text())
    anomalies = json.loads((ARTIFACTS / "anomalies.json").read_text())
    inventory = json.loads((ARTIFACTS / "inventory.json").read_text())
    knowledge = json.loads((ARTIFACTS / "rag_browser.json").read_text())

    recent = hist.tail(RECENT_DAYS)

    # per-category series: recent actuals, model backtest overlay, forecast
    series = {}
    for cat in CATS:
        bt = backtest[cat]
        bt_map = dict(zip(bt["dates"], bt["predicted"]))
        hist_pts = [{"date": d.strftime("%Y-%m-%d"),
                     "actual": round(float(recent[cat][d]), 2),
                     "predicted": bt_map.get(d.strftime("%Y-%m-%d"))}
                    for d in recent.index]
        series[cat] = {
            "name": CATEGORIES[cat]["name"],
            "history": hist_pts,
            "forecast": {
                "dates": forecasts["categories"][cat]["dates"],
                "forecast": forecasts["categories"][cat]["forecast"],
                "lower": forecasts["categories"][cat]["lower"],
                "upper": forecasts["categories"][cat]["upper"],
            },
            "metrics": metrics[cat],
        }

    # overview: weekly total sales across full history + category mix (last 90d)
    weekly = hist[CATS].sum(axis=1).resample("W").sum()
    mix90 = hist[CATS].tail(90).sum().round(1)
    totals_next30 = {c: forecasts["categories"][c]["next30_units"] for c in CATS}

    meta = {
        "app": "Pharos",
        "tagline": "Pharmacy demand intelligence",
        "as_of": as_of.strftime("%Y-%m-%d"),
        "data_span": [hist.index.min().strftime("%Y-%m-%d"), as_of.strftime("%Y-%m-%d")],
        "n_days": int(len(hist)),
        "categories": {c: {"name": CATEGORIES[c]["name"],
                           "group": CATEGORIES[c]["group"],
                           "examples": CATEGORIES[c]["examples"],
                           "seasonality": CATEGORIES[c]["seasonality"]} for c in CATS},
        "metrics_summary": metrics["_summary"],
        "overview": {
            "weekly_dates": [d.strftime("%Y-%m-%d") for d in weekly.index],
            "weekly_total": [round(float(v), 1) for v in weekly.values],
            "mix90": {c: float(mix90[c]) for c in CATS},
            "forecast_next30": totals_next30,
            "n_low_stock": inventory["counts"]["low_stock"],
            "n_expiry": (inventory["counts"]["expiring_urgent"]
                         + inventory["counts"]["expired"]
                         + inventory["counts"]["expiring_soon"]),
            "n_unusual_days": anomalies["n_unusual_days"],
        },
    }

    (OUT / "meta.json").write_text(json.dumps(meta))
    (OUT / "series.json").write_text(json.dumps(series))
    (OUT / "anomalies.json").write_text(json.dumps(anomalies))
    (OUT / "inventory.json").write_text(json.dumps(inventory))
    (OUT / "knowledge.json").write_text(json.dumps(knowledge))

    for f in OUT.glob("*.json"):
        print(f"  {f.name:16s} {f.stat().st_size/1024:7.1f} KB")


if __name__ == "__main__":
    main()
