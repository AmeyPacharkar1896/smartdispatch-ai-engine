from datetime import datetime, timezone, timedelta

from fastapi import FastAPI, HTTPException, Query

from .routing import get_route, get_distance_duration
from . import predict

app = FastAPI(title="Delivery Routing API", version="1.0.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/route")
async def route(
    origin_lat: float = Query(..., description="Pickup latitude"),
    origin_lng: float = Query(..., description="Pickup longitude"),
    dest_lat: float = Query(..., description="Drop latitude"),
    dest_lng: float = Query(..., description="Drop longitude"),
):
    """Get shortest route with distance and duration."""
    result = await get_route(origin_lat, origin_lng, dest_lat, dest_lng)
    if result is None:
        raise HTTPException(status_code=404, detail="Route not found")
    return result


@app.get("/distance")
async def distance(
    origin_lat: float = Query(...),
    origin_lng: float = Query(...),
    dest_lat: float = Query(...),
    dest_lng: float = Query(...),
):
    """Get distance (km) and duration (min) only."""
    print(f"Getting distance and duration for {origin_lat}, {origin_lng}, {dest_lat}, {dest_lng}")
    result = await get_distance_duration(origin_lat, origin_lng, dest_lat, dest_lng)
    if result is None:
        raise HTTPException(status_code=404, detail="Route not found")
    return result


@app.get("/predict/duration")
async def predict_duration(
    distance_km: float = Query(...),
    hour: int = Query(..., ge=0, le=23),
    day_of_week: int = Query(..., ge=0, le=6),
):
    """Predict travel duration (min) from distance + time features. ML model."""
    result = predict.predict_duration(distance_km, hour, day_of_week)
    if result is None:
        raise HTTPException(status_code=503, detail="Model not loaded. Run ml/02_model_training.ipynb first.")
    return {"duration_min": result}


@app.get("/eta")
async def eta(
    origin_lat: float = Query(...),
    origin_lng: float = Query(...),
    dest_lat: float = Query(...),
    dest_lng: float = Query(...),
    departure_time: str | None = Query(None, description="ISO datetime e.g. 2026-02-14T18:00:00"),
):
    """Estimate arrival time. Gets route, uses ML for duration, returns ETA."""
    route = await get_route(origin_lat, origin_lng, dest_lat, dest_lng)
    if route is None:
        raise HTTPException(status_code=404, detail="Route not found")
    dep = datetime.fromisoformat(departure_time.replace("Z", "+00:00")) if departure_time else datetime.now(timezone.utc)
    if dep.tzinfo is None:
        dep = dep.replace(tzinfo=timezone.utc)
    hour, day_of_week = dep.hour, dep.weekday()
    duration_min = predict.predict_duration(route["distance_km"], hour, day_of_week)
    duration_min = duration_min or route["duration_min"]
    eta_dt = dep + timedelta(minutes=duration_min)
    return {
        "distance_km": route["distance_km"],
        "duration_min": round(duration_min, 2),
        "departure_at": dep.isoformat(),
        "eta_at": eta_dt.isoformat(),
    }


@app.get("/route/traffic-aware")
async def route_traffic_aware(
    origin_lat: float = Query(...),
    origin_lng: float = Query(...),
    dest_lat: float = Query(...),
    dest_lng: float = Query(...),
    hour: int = Query(None, ge=0, le=23, description="Current hour (default: now)"),
    day_of_week: int = Query(None, ge=0, le=6, description="0=Mon (default: today)"),
):
    """Same path as /route but with traffic-adjusted duration from ML model."""
    route = await get_route(origin_lat, origin_lng, dest_lat, dest_lng)
    if route is None:
        raise HTTPException(status_code=404, detail="Route not found")
    now = datetime.now(timezone.utc)
    h = hour if hour is not None else now.hour
    d = day_of_week if day_of_week is not None else now.weekday()
    adj_duration = predict.predict_duration(route["distance_km"], h, d)
    adj_duration = adj_duration or route["duration_min"]
    return {
        "distance_km": route["distance_km"],
        "duration_min_osrm": route["duration_min"],
        "duration_min_traffic_adjusted": round(adj_duration, 2),
    }


@app.get("/predict/price")
async def predict_price(
    distance_km: float = Query(...),
    weight_kg: float = Query(0.5, ge=0.1),
    volume_l: float = Query(1.0, ge=0.1),
    urgency: str = Query("normal", description="normal | express | same_day"),
    hour: int = Query(12, ge=0, le=23),
    day_of_week: int = Query(0, ge=0, le=6),
    demand_score: float = Query(1.0, ge=0.5, le=2.0),
):
    """Predict delivery price (INR) from parameters. ML model."""
    result = predict.predict_price(distance_km, weight_kg, volume_l, urgency, hour, day_of_week, demand_score)
    if result is None:
        raise HTTPException(status_code=503, detail="Model not loaded. Run ml/02_model_training.ipynb first.")
    return {"price_inr": result}


@app.get("/forecast/demand")
async def forecast_demand(
    hour: int = Query(..., ge=0, le=23),
    day_of_week: int = Query(..., ge=0, le=6),
):
    """Forecast demand (expected request count) for given hour and day. ML model."""
    result = predict.predict_demand(hour, day_of_week)
    if result is None:
        raise HTTPException(status_code=503, detail="Model not loaded. Run ml/02_model_training.ipynb first.")
    return {"demand_forecast": result}


@app.get("/hotspots")
async def hotspots(
    top_n: int = Query(10, ge=1, le=20, description="Number of hotspots to return"),
):
    """Hotspot centroids for agent pre-positioning. Clustered from historical pickup/drop locations."""
    result = predict.get_hotspots(top_n)
    if result is None:
        raise HTTPException(status_code=503, detail="Hotspots not loaded. Run ml/02_model_training.ipynb first.")
    return {"hotspots": result}