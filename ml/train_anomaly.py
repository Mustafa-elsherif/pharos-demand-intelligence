"""Anomaly detection for unusual sales.

Two complementary views:
  1. Per group residual z-score against a rolling median expectation, which
     explains *why* a day is unusual (how far above or below normal it was).
  2. A multivariate IsolationForest over the eight group vector, which flags
     whole days that look unusual across the product mix.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import joblib
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

CATS = ["M01AB", "M01AE", "N02BA", "N02BE", "N05B", "N05C", "R03", "R06"]
ARTIFACTS = ROOT / "backend" / "artifacts"
Z_THRESH = 3.5
WINDOW = 28


def load() -> pd.DataFrame:
    df = pd.read_csv(ROOT / "data" / "salesdaily.csv")
    df["datum"] = pd.to_datetime(df["datum"], format="%m/%d/%Y")
    return df.set_index("datum").sort_index()[CATS].astype("float64")


def residual_anomalies(df: pd.DataFrame) -> list[dict]:
    out = []
    for cat in CATS:
        s = df[cat]
        med = s.rolling(WINDOW, min_periods=10).median()
        mad = (s - med).abs().rolling(WINDOW, min_periods=10).median()
        scale = (mad * 1.4826).replace(0, np.nan)
        z = (s - med) / scale
        flagged = z[(z.abs() >= Z_THRESH) & z.notna()]
        for ts, zval in flagged.items():
            out.append({
                "date": ts.strftime("%Y-%m-%d"),
                "category": cat,
                "value": round(float(s[ts]), 2),
                "expected": round(float(med[ts]), 2),
                "z": round(float(zval), 2),
                "direction": "spike" if zval > 0 else "drop",
            })
    out.sort(key=lambda r: abs(r["z"]), reverse=True)
    return out


def main() -> None:
    df = load()

    # multivariate model over the full product mix
    scaler = StandardScaler().fit(df.values)
    Xs = scaler.transform(df.values)
    iso = IsolationForest(n_estimators=300, contamination=0.02, random_state=42)
    iso.fit(Xs)
    scores = iso.decision_function(Xs)       # higher = more normal
    flags = iso.predict(Xs)                  # -1 = anomaly

    joblib.dump({"scaler": scaler, "iso": iso, "cats": CATS},
                ARTIFACTS / "anomaly_model.joblib")

    unusual_days = []
    for ts, sc, fl in zip(df.index, scores, flags):
        if fl == -1:
            row = df.loc[ts]
            top = row.sort_values(ascending=False).index[0]
            unusual_days.append({
                "date": ts.strftime("%Y-%m-%d"),
                "score": round(float(sc), 4),
                "total_units": round(float(row.sum()), 1),
                "top_category": top,
            })
    unusual_days.sort(key=lambda r: r["score"])

    res = residual_anomalies(df)
    payload = {
        "method": {
            "residual": f"robust z-score vs {WINDOW}-day rolling median, |z|>={Z_THRESH}",
            "multivariate": "IsolationForest, contamination=0.02, 8-dim daily vector",
        },
        "n_residual_anomalies": len(res),
        "n_unusual_days": len(unusual_days),
        "residual_top": res[:60],
        "unusual_days": unusual_days,
    }
    (ARTIFACTS / "anomalies.json").write_text(json.dumps(payload, indent=2))
    print(f"residual anomalies: {len(res)}  unusual days: {len(unusual_days)}")
    if res:
        t = res[0]
        print(f"top: {t['date']} {t['category']} {t['direction']} "
              f"value={t['value']} expected={t['expected']} z={t['z']}")


if __name__ == "__main__":
    main()
