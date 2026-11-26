"""API tests. These exercise the loaded artifacts end to end."""
from pathlib import Path
import sys

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.main import app  # noqa: E402

client = TestClient(app)


def test_health():
    with TestClient(app) as c:
        r = c.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


def test_categories():
    with TestClient(app) as c:
        r = c.get("/api/categories")
        assert r.status_code == 200
        assert len(r.json()["categories"]) == 8


def test_forecast_shape():
    with TestClient(app) as c:
        r = c.get("/api/forecast", params={"category": "N02BE", "horizon": 14})
        assert r.status_code == 200
        body = r.json()
        assert len(body["points"]) == 14
        for p in body["points"]:
            assert p["lower"] <= p["forecast"] <= p["upper"]
            assert p["forecast"] >= 0


def test_forecast_unknown_category():
    with TestClient(app) as c:
        r = c.get("/api/forecast", params={"category": "ZZZ"})
        assert r.status_code == 404


def test_anomaly_score_spike():
    with TestClient(app) as c:
        huge = {k: 0 for k in ["M01AB", "M01AE", "N02BA", "N02BE",
                               "N05B", "N05C", "R03", "R06"]}
        huge["N02BE"] = 400
        r = c.post("/api/anomalies/score", json={"values": huge})
        assert r.status_code == 200
        assert r.json()["is_unusual"] is True


def test_alerts():
    with TestClient(app) as c:
        r = c.get("/api/alerts")
        assert r.status_code == 200
        assert "counts" in r.json()


def test_assistant_grounded():
    with TestClient(app) as c:
        r = c.post("/api/assistant", json={"message": "What is ibuprofen used for?"})
        assert r.status_code == 200
        body = r.json()
        assert body["sources"]
        assert body["grounded"] is True


def test_assistant_guardrail():
    with TestClient(app) as c:
        r = c.post("/api/assistant",
                   json={"message": "How much paracetamol should I take?"})
        assert r.status_code == 200
        assert r.json()["engine"] == "guardrail"
