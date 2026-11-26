"""Pharos API: serves demand forecasts, anomaly detection, inventory alerts
and the grounded drug-information assistant from pre-trained artifacts."""
from __future__ import annotations

import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import config
from .models import (AnomalyScoreRequest, AnomalyScoreResponse, AssistantRequest,
                     AssistantResponse, ForecastRequest, ForecastResponse)
from .forecasting import ForecastService
from .anomaly import AnomalyService
from .assistant import Assistant

state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    state["forecast"] = ForecastService()
    state["anomaly"] = AnomalyService()
    state["assistant"] = Assistant()
    state["inventory"] = json.loads(
        (config.ARTIFACTS / "inventory.json").read_text())
    yield
    state.clear()


app = FastAPI(title=f"{config.APP_NAME} API", version=config.VERSION,
              description="Pharmacy demand intelligence.", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"])


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "app": config.APP_NAME, "version": config.VERSION,
            "assistant_engine": "gemini" if config.GEMINI_API_KEY else "local"}


@app.get("/api/categories")
def categories() -> dict:
    fs: ForecastService = state["forecast"]
    return {"categories": fs.cats, "metrics": fs.metrics}


@app.get("/api/forecast", response_model=ForecastResponse)
def forecast_get(category: str = Query(...), horizon: int = Query(14, ge=1, le=60)):
    return _forecast(category, horizon)


@app.post("/api/forecast", response_model=ForecastResponse)
def forecast_post(req: ForecastRequest):
    return _forecast(req.category, req.horizon)


def _forecast(category: str, horizon: int) -> ForecastResponse:
    fs: ForecastService = state["forecast"]
    try:
        res = fs.forecast(category, horizon)
    except KeyError:
        raise HTTPException(404, f"Unknown category '{category}'")
    from .domain_names import CATEGORY_NAMES
    res["category_name"] = CATEGORY_NAMES.get(category, category)
    return ForecastResponse(**res)


@app.get("/api/anomalies")
def anomalies() -> dict:
    return state["anomaly"].precomputed


@app.post("/api/anomalies/score", response_model=AnomalyScoreResponse)
def anomaly_score(req: AnomalyScoreRequest):
    return AnomalyScoreResponse(**state["anomaly"].score_day(req.values))


@app.get("/api/inventory")
def inventory() -> dict:
    return state["inventory"]


@app.get("/api/alerts")
def alerts() -> dict:
    inv = state["inventory"]
    return {"as_of": inv["as_of"], "low_stock": inv["low_stock"],
            "expiry": inv["expiry"], "counts": inv["counts"]}


@app.post("/api/assistant", response_model=AssistantResponse)
def assistant(req: AssistantRequest):
    return AssistantResponse(**state["assistant"].answer(req.message))
