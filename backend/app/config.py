"""Runtime configuration. Secrets come only from the environment."""
from __future__ import annotations

import os
from pathlib import Path

ARTIFACTS = Path(__file__).resolve().parent.parent / "artifacts"

# Gemini is optional. When no key is present the assistant uses the local
# grounded fallback, so the service runs fully offline.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash").strip()

APP_NAME = "Pharos"
APP_TAGLINE = "Pharmacy demand intelligence"
VERSION = "1.0.0"

# retrieval
RAG_MIN_SCORE = 0.06
RAG_TOP_K = 3
