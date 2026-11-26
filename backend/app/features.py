"""Feature engineering for demand forecasting.

This module is the single source of truth for how features are built. Both the
offline training pipeline and the online serving layer import it, so the model
always sees features constructed exactly the same way.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# Lag windows (in days) and rolling windows used by the forecaster.
LAGS = [1, 7, 14, 28]
ROLL_WINDOWS = [7, 14, 28]

FEATURE_NAMES = (
    ["dow", "month", "weekofyear", "is_weekend", "doy_sin", "doy_cos"]
    + [f"lag_{l}" for l in LAGS]
    + [f"roll_mean_{w}" for w in ROLL_WINDOWS]
    + [f"roll_std_{w}" for w in ROLL_WINDOWS]
    + ["same_dow_mean_4"]
)


def _calendar_features(ts: pd.Timestamp) -> list[float]:
    doy = ts.day_of_year
    return [
        float(ts.day_of_week),
        float(ts.month),
        float(ts.isocalendar().week),
        1.0 if ts.day_of_week >= 5 else 0.0,
        float(np.sin(2 * np.pi * doy / 365.25)),
        float(np.cos(2 * np.pi * doy / 365.25)),
    ]


def build_row(history: pd.Series, target_date: pd.Timestamp) -> np.ndarray:
    """Build a single feature vector for `target_date` from prior observations.

    `history` must be a date-indexed Series containing values strictly before
    `target_date`. Missing lags fall back to the series mean so the vector is
    always complete.
    """
    hist = history[history.index < target_date]
    fill = float(hist.mean()) if len(hist) else 0.0

    feats = _calendar_features(target_date)

    for lag in LAGS:
        d = target_date - pd.Timedelta(days=lag)
        feats.append(float(hist[d]) if d in hist.index else fill)

    tail = hist.tail(max(ROLL_WINDOWS))
    for w in ROLL_WINDOWS:
        win = tail.tail(w)
        feats.append(float(win.mean()) if len(win) else fill)
    for w in ROLL_WINDOWS:
        win = tail.tail(w)
        feats.append(float(win.std(ddof=0)) if len(win) > 1 else 0.0)

    same_dow = hist[hist.index.day_of_week == target_date.day_of_week].tail(4)
    feats.append(float(same_dow.mean()) if len(same_dow) else fill)

    return np.asarray(feats, dtype="float64")


def build_matrix(series: pd.Series, min_history: int = 28):
    """Build a training matrix (X, y, dates) from a full date-indexed series."""
    series = series.sort_index()
    rows, targets, dates = [], [], []
    for i, (ts, val) in enumerate(series.items()):
        if i < min_history:
            continue
        rows.append(build_row(series.iloc[:i], ts))
        targets.append(float(val))
        dates.append(ts)
    return np.asarray(rows), np.asarray(targets), pd.DatetimeIndex(dates)


def forecast_recursive(model, history: pd.Series, horizon: int) -> pd.Series:
    """Roll the model forward `horizon` days, feeding predictions back in."""
    hist = history.sort_index().copy()
    out_dates, out_vals = [], []
    cur = hist.index.max()
    for _ in range(horizon):
        cur = cur + pd.Timedelta(days=1)
        x = build_row(hist, cur).reshape(1, -1)
        pred = float(model.predict(x)[0])
        pred = max(0.0, pred)
        hist.loc[cur] = pred
        out_dates.append(cur)
        out_vals.append(pred)
    return pd.Series(out_vals, index=pd.DatetimeIndex(out_dates))
