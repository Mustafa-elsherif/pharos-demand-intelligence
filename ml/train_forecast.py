"""Train per drug group demand forecasters and record honest backtest metrics.

Model: gradient boosted regression trees (XGBoost), one per ATC group, with a
one step ahead backtest on a held out tail. Accuracy is reported against two
transparent baselines so the numbers can be trusted:
  - naive persistence (yesterday's value)
  - seasonal naive (same weekday last week)
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from xgboost import XGBRegressor

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.features import build_matrix, FEATURE_NAMES  # noqa: E402

CATS = ["M01AB", "M01AE", "N02BA", "N02BE", "N05B", "N05C", "R03", "R06"]
TEST_DAYS = 120
ARTIFACTS = ROOT / "backend" / "artifacts"


def load_series() -> pd.DataFrame:
    df = pd.read_csv(ROOT / "data" / "salesdaily.csv")
    df["datum"] = pd.to_datetime(df["datum"], format="%m/%d/%Y")
    df = df.set_index("datum").sort_index()
    return df[CATS].astype("float64")


def metrics(y_true, y_pred) -> dict:
    y_true = np.asarray(y_true, dtype="float64")
    y_pred = np.asarray(y_pred, dtype="float64")
    err = y_pred - y_true
    mae = float(np.mean(np.abs(err)))
    rmse = float(np.sqrt(np.mean(err ** 2)))
    mask = y_true > 1e-6
    mape = float(np.mean(np.abs(err[mask] / y_true[mask])) * 100) if mask.any() else None
    return {"mae": round(mae, 3), "rmse": round(rmse, 3),
            "mape": round(mape, 2) if mape is not None else None}


def new_model() -> XGBRegressor:
    return XGBRegressor(
        n_estimators=450, max_depth=4, learning_rate=0.045,
        subsample=0.85, colsample_bytree=0.85, min_child_weight=3,
        reg_lambda=1.2, objective="reg:squarederror",
        n_jobs=4, random_state=42,
    )


def main() -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    df = load_series()
    X_all, report = {}, {}

    import joblib
    models = {}
    backtest = {}
    for cat in CATS:
        s = df[cat]
        X, y, dates = build_matrix(s)
        split = len(X) - TEST_DAYS
        Xtr, Xte, ytr, yte = X[:split], X[split:], y[:split], y[split:]

        model = new_model()
        model.fit(Xtr, ytr)
        pred = np.clip(model.predict(Xte), 0, None)

        # baselines computed on the same test targets
        test_dates = dates[split:]
        naive = s.reindex(test_dates - pd.Timedelta(days=1)).to_numpy()
        snaive = s.reindex(test_dates - pd.Timedelta(days=7)).to_numpy()
        naive = np.nan_to_num(naive, nan=float(s.mean()))
        snaive = np.nan_to_num(snaive, nan=float(s.mean()))

        m_model = metrics(yte, pred)
        m_naive = metrics(yte, naive)
        m_snaive = metrics(yte, snaive)
        skill = round((1 - m_model["mae"] / m_snaive["mae"]) * 100, 1)

        report[cat] = {
            "test_days": int(TEST_DAYS),
            "model": m_model,
            "naive_persistence": m_naive,
            "seasonal_naive": m_snaive,
            "mae_skill_vs_seasonal_naive_pct": skill,
            "mean_daily_units": round(float(s.mean()), 2),
        }

        backtest[cat] = {
            "dates": [d.strftime("%Y-%m-%d") for d in test_dates],
            "actual": [round(float(v), 2) for v in yte],
            "predicted": [round(float(v), 2) for v in pred],
        }

        # refit on the full series for serving
        full = new_model()
        full.fit(X, y)
        models[cat] = full
        print(f"{cat:6s} MAE model={m_model['mae']:.2f} snaive={m_snaive['mae']:.2f} "
              f"skill={skill:+.1f}% MAPE={m_model['mape']}")

    joblib.dump({"models": models, "features": list(FEATURE_NAMES), "cats": CATS},
                ARTIFACTS / "forecast_models.joblib")
    df.to_parquet(ARTIFACTS / "history.parquet") if _has_pyarrow() else \
        df.to_csv(ARTIFACTS / "history.csv")

    # macro average skill
    avg_skill = round(float(np.mean([report[c]["mae_skill_vs_seasonal_naive_pct"]
                                     for c in CATS])), 1)
    report["_summary"] = {
        "avg_mae_skill_vs_seasonal_naive_pct": avg_skill,
        "n_categories": len(CATS),
        "train_days": int(len(df) - TEST_DAYS),
    }
    (ARTIFACTS / "forecast_metrics.json").write_text(json.dumps(report, indent=2))
    (ARTIFACTS / "forecast_backtest.json").write_text(json.dumps(backtest))
    print(f"\nAverage MAE skill vs seasonal naive: {avg_skill:+.1f}%")


def _has_pyarrow() -> bool:
    try:
        import pyarrow  # noqa: F401
        return True
    except Exception:
        return False


if __name__ == "__main__":
    main()
