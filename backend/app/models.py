"""Pydantic request and response schemas for the REST API."""
from __future__ import annotations

from typing import Optional
from pydantic import BaseModel, Field

CATS = ["M01AB", "M01AE", "N02BA", "N02BE", "N05B", "N05C", "R03", "R06"]


class ForecastRequest(BaseModel):
    category: str = Field(..., description="ATC group code")
    horizon: int = Field(14, ge=1, le=60, description="Days to forecast")


class ForecastPoint(BaseModel):
    date: str
    forecast: float
    lower: float
    upper: float


class ForecastResponse(BaseModel):
    category: str
    category_name: str
    horizon: int
    generated_from: str
    points: list[ForecastPoint]
    next7_units: float
    mae: float
    mae_skill_vs_seasonal_naive_pct: float


class AnomalyScoreRequest(BaseModel):
    values: dict[str, float] = Field(
        ..., description="One day of units sold per ATC group")


class AnomalyScoreResponse(BaseModel):
    is_unusual: bool
    score: float
    top_category: str
    note: str


class AssistantRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=1000)


class Source(BaseModel):
    id: str
    title: str
    score: float


class AssistantResponse(BaseModel):
    answer: str
    sources: list[Source]
    language: str
    engine: str
    grounded: bool
