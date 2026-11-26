"""Anomaly service: expose precomputed anomalies and score a new day."""
from __future__ import annotations

import json

import joblib
import numpy as np

from . import config


class AnomalyService:
    def __init__(self) -> None:
        bundle = joblib.load(config.ARTIFACTS / "anomaly_model.joblib")
        self.scaler = bundle["scaler"]
        self.iso = bundle["iso"]
        self.cats = bundle["cats"]
        self.precomputed = json.loads((config.ARTIFACTS / "anomalies.json").read_text())

    def score_day(self, values: dict[str, float]) -> dict:
        vec = np.array([[float(values.get(c, 0.0)) for c in self.cats]])
        xs = self.scaler.transform(vec)
        score = float(self.iso.decision_function(xs)[0])
        is_unusual = bool(self.iso.predict(xs)[0] == -1)
        row = {c: float(values.get(c, 0.0)) for c in self.cats}
        top = max(row, key=row.get)
        note = ("This sales pattern is unusual versus the trained history."
                if is_unusual else "This sales pattern looks within normal range.")
        return {"is_unusual": is_unusual, "score": round(score, 4),
                "top_category": top, "note": note}
