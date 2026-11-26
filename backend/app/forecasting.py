"""Forecasting service: load serialized models once, forecast on demand."""
from __future__ import annotations

import json

import joblib
import pandas as pd

from . import config
from .features import forecast_recursive


class ForecastService:
    def __init__(self) -> None:
        bundle = joblib.load(config.ARTIFACTS / "forecast_models.joblib")
        self.models = bundle["models"]
        self.cats = bundle["cats"]
        self.metrics = json.loads((config.ARTIFACTS / "forecast_metrics.json").read_text())
        hist = pd.read_csv(config.ARTIFACTS / "history.csv")
        hist["datum"] = pd.to_datetime(hist["datum"])
        self.history = hist.set_index("datum").sort_index()
        self.last_date = self.history.index.max()

    def forecast(self, category: str, horizon: int) -> dict:
        if category not in self.models:
            raise KeyError(category)
        fc = forecast_recursive(self.models[category], self.history[category], horizon)
        rmse = self.metrics[category]["model"]["rmse"]
        points = [{
            "date": d.strftime("%Y-%m-%d"),
            "forecast": round(float(v), 2),
            "lower": round(max(0.0, float(v) - 1.28 * rmse), 2),
            "upper": round(float(v) + 1.28 * rmse, 2),
        } for d, v in fc.items()]
        return {
            "category": category,
            "horizon": horizon,
            "generated_from": self.last_date.strftime("%Y-%m-%d"),
            "points": points,
            "next7_units": round(float(fc.iloc[:7].sum()), 1),
            "mae": self.metrics[category]["model"]["mae"],
            "mae_skill_vs_seasonal_naive_pct":
                self.metrics[category]["mae_skill_vs_seasonal_naive_pct"],
        }
