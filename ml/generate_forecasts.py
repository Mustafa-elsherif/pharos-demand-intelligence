"""Roll the trained models forward to produce the 30 day demand outlook.

Uncertainty bands come from each group's held out RMSE, not from thin air, so
the shaded range reflects the model's measured error.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd
import joblib

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.features import forecast_recursive  # noqa: E402

ARTIFACTS = ROOT / "backend" / "artifacts"
HORIZON = 30


def load_history() -> pd.DataFrame:
    df = pd.read_csv(ARTIFACTS / "history.csv")
    df["datum"] = pd.to_datetime(df["datum"])
    return df.set_index("datum").sort_index()


def main() -> None:
    bundle = joblib.load(ARTIFACTS / "forecast_models.joblib")
    models, cats = bundle["models"], bundle["cats"]
    metrics = json.loads((ARTIFACTS / "forecast_metrics.json").read_text())
    hist = load_history()

    out = {"horizon": HORIZON, "generated_from": hist.index.max().strftime("%Y-%m-%d"),
           "categories": {}}
    for cat in cats:
        fc = forecast_recursive(models[cat], hist[cat], HORIZON)
        rmse = metrics[cat]["model"]["rmse"]
        out["categories"][cat] = {
            "dates": [d.strftime("%Y-%m-%d") for d in fc.index],
            "forecast": [round(float(v), 2) for v in fc.values],
            "lower": [round(max(0.0, float(v) - 1.28 * rmse), 2) for v in fc.values],
            "upper": [round(float(v) + 1.28 * rmse, 2) for v in fc.values],
            "next7_units": round(float(fc.iloc[:7].sum()), 1),
            "next30_units": round(float(fc.sum()), 1),
        }
        print(f"{cat:6s} next7={out['categories'][cat]['next7_units']:7.1f} "
              f"next30={out['categories'][cat]['next30_units']:7.1f}")

    (ARTIFACTS / "forecasts.json").write_text(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
