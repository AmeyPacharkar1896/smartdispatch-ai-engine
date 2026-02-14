"""
ML model inference for duration and price prediction.
"""
from __future__ import annotations

import joblib
from pathlib import Path

MODELS_DIR = Path(__file__).parent.parent / "models"
TRAVEL_TIME_MODEL = MODELS_DIR / "travel_time_model.joblib"
PRICING_MODEL = MODELS_DIR / "pricing_model.joblib"
URGENCY_ENCODER = MODELS_DIR / "urgency_encoder.joblib"
DEMAND_MODEL = MODELS_DIR / "demand_model.joblib"
HOTSPOTS = MODELS_DIR / "hotspots.joblib"

_travel_model = None
_pricing_model = None
_urgency_meta = None
_demand_model = None
_hotspots = None


def _load_models():
    global _travel_model, _pricing_model, _urgency_meta, _demand_model, _hotspots
    if _travel_model is None and TRAVEL_TIME_MODEL.exists():
        _travel_model = joblib.load(TRAVEL_TIME_MODEL)
    if _pricing_model is None and PRICING_MODEL.exists():
        _pricing_model = joblib.load(PRICING_MODEL)
    if _urgency_meta is None and URGENCY_ENCODER.exists():
        _urgency_meta = joblib.load(URGENCY_ENCODER)
    if _demand_model is None and DEMAND_MODEL.exists():
        _demand_model = joblib.load(DEMAND_MODEL)
    if _hotspots is None and HOTSPOTS.exists():
        _hotspots = joblib.load(HOTSPOTS)


def predict_duration(distance_km: float, hour: int, day_of_week: int) -> float | None:
    """Predict travel duration in minutes."""
    _load_models()
    if _travel_model is None:
        return None
    is_rush = 1 if ((7 <= hour <= 9) or (17 <= hour <= 20)) else 0
    x = [[distance_km, hour, day_of_week, is_rush]]
    return round(float(_travel_model.predict(x)[0]), 2)


def predict_price(
    distance_km: float,
    weight_kg: float,
    volume_l: float,
    urgency: str,
    hour: int,
    day_of_week: int,
    demand_score: float = 1.0,
) -> float | None:
    """Predict delivery price in INR."""
    _load_models()
    if _pricing_model is None or _urgency_meta is None:
        return None
    le = _urgency_meta["encoder"]
    classes = _urgency_meta["urgency_classes"]
    urgency_enc = le.transform([urgency])[0] if urgency in classes else 0
    x = [[distance_km, weight_kg, volume_l, urgency_enc, hour, day_of_week, demand_score]]
    return round(float(_pricing_model.predict(x)[0]), 2)


def predict_demand(hour: int, day_of_week: int) -> float | None:
    """Predict demand (request count) for given hour and day of week."""
    _load_models()
    if _demand_model is None:
        return None
    import math
    hour_sin = math.sin(2 * math.pi * hour / 24)
    hour_cos = math.cos(2 * math.pi * hour / 24)
    is_rush = 1 if ((7 <= hour <= 9) or (17 <= hour <= 20)) else 0
    x = [[hour, day_of_week, hour_sin, hour_cos, is_rush]]
    return round(float(_demand_model.predict(x)[0]), 1)


def get_hotspots(top_n: int = 10) -> list[dict] | None:
    """Return top N hotspot centroids for agent pre-positioning."""
    _load_models()
    if _hotspots is None:
        return None
    return _hotspots[:top_n]
