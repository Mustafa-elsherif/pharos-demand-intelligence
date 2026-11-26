# Model card: Pharos demand intelligence

## Overview
Pharos contains three model families trained on six years of daily pharmacy
point-of-sale counts for eight ATC drug groups (2 January 2014 to 8 October 2019,
2106 days, no missing days).

| Component | Model | Purpose |
|---|---|---|
| Demand forecast | XGBoost regression, one model per group | Predict next-day units, rolled forward for a 30 day outlook |
| Whole-day anomalies | IsolationForest over the 8-group vector | Flag days that are unusual across the product mix |
| Per-group anomalies | Robust z-score vs 28-day rolling median | Explain how far a day sits from normal |
| Assistant retrieval | TF-IDF (1-2 grams) + cosine | Ground answers in the knowledge base |

## Forecasting: data and features
Target is next-day units per group. Features (18 total) are built only from
information available before the target day: calendar terms (day of week, month,
week of year, weekend flag, day-of-year sine and cosine), lags at 1, 7, 14 and 28
days, rolling mean and standard deviation over 7, 14 and 28 days, and the mean of
the last four same-weekday values. Feature construction lives in one module used
by both training and serving, so there is no train/serve skew.

## Forecasting: evaluation
One-step-ahead backtest on the last 120 days. Baselines: persistence (yesterday)
and seasonal naive (same weekday last week). Skill is the reduction in MAE versus
seasonal naive. Metrics are honest and reproducible (`python ml/train_forecast.py`).

| Group | Name | Model MAE | Seasonal naive MAE | Skill |
|---|---|---:|---:|---:|
| M01AB | Acetic acid NSAIDs | 2.48 | 3.33 | +25.6% |
| M01AE | Propionic acid NSAIDs | 1.52 | 2.01 | +24.6% |
| N02BA | Salicylic acid analgesics | 1.44 | 1.97 | +26.8% |
| N02BE | Anilide analgesics | 7.01 | 8.86 | +20.9% |
| N05B | Anxiolytics | 2.93 | 3.72 | +21.3% |
| N05C | Hypnotics and sedatives | 0.85 | 1.17 | +27.2% |
| R03 | Airway disease drugs | 4.06 | 5.00 | +18.8% |
| R06 | Systemic antihistamines | 1.67 | 2.58 | +35.6% |

**Average MAE skill versus seasonal naive: +25.1%.**

MAPE is reported in the artifacts but is not the headline metric: several groups
sell only a handful of units a day, so percentage error is unstable and not a
meaningful scale there. MAE is used instead.

## Anomaly detection
The IsolationForest uses 300 trees and a 0.02 contamination target, which flags
43 whole-day outliers. The robust z-score uses the median absolute deviation, so
it does not assume a normal or symmetric distribution; this matters for the skewed
low-count groups. The largest flagged deviations are seasonal surges in the airway
group (R03), whose small baseline makes a surge read as a very high z-score.

## Assistant
Retrieval runs over 13 curated documents (eight drug groups plus five operations
notes). Answers are generated only from retrieved context. Generation uses Gemini
when `GEMINI_API_KEY` is set and a local extractive fallback otherwise. Guardrails
sit in front of both paths and decline personal dosing, diagnosis and interaction
questions regardless of language.

## Intended use and limits
- For pharmacy operations planning (restocking, expiry, demand review), not for
  clinical decisions about individual patients.
- The knowledge base is general reference information, not medical advice.
- The dataset is a single pharmacy's history; forecasts reflect that demand profile
  and would be retrained per site in production.
- Inventory stock levels and batch expiry dates are generated deterministically for
  demonstration because the source dataset carries sales only, not stock. Reorder
  points, safety stock and expiry logic are the real engine driving the alerts.
