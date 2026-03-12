import math
import httpx

OSRM_BASE_URL = "http://localhost:5001"  # or host.docker.internal:5001 if API runs in Docker


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def fallback_route_response(origin_lat: float, origin_lng: float, dest_lat: float, dest_lng: float) -> dict:
    """When OSRM is down or returns no route, return 200 with empty coordinates so frontend can use straight line."""
    km = _haversine_km(origin_lat, origin_lng, dest_lat, dest_lng)
    duration_min = max(1.0, (km / 25.0) * 60)  # assume ~25 km/h in city
    return {
        "distance_m": km * 1000,
        "distance_km": round(km, 2),
        "duration_s": duration_min * 60,
        "duration_min": round(duration_min, 2),
        "coordinates": [],
    }


async def get_route(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    *,
    with_geometry: bool = False,
):
    """Get route from OSRM. Returns distance (m), duration (s), and optional geometry (list of [lng, lat])."""
    url = f"{OSRM_BASE_URL}/route/v1/driving/{origin_lng},{origin_lat};{dest_lng},{dest_lat}"
    params: dict = {"steps": "false"}
    if with_geometry:
        params["overview"] = "full"
        params["geometries"] = "geojson"
    else:
        params["overview"] = "false"
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, httpx.RequestError, KeyError, IndexError):
        return None

    if data.get("code") != "Ok":
        return None

    route = data["routes"][0]
    result = {
        "distance_m": route["distance"],
        "distance_km": round(route["distance"] / 1000, 2),
        "duration_s": route["duration"],
        "duration_min": round(route["duration"] / 60, 2),
    }
    if with_geometry:
        # OSRM GeoJSON geometry: { "type": "LineString", "coordinates": [[lng,lat], ...] }
        geom = route.get("geometry") or {}
        coords = geom.get("coordinates") if isinstance(geom, dict) else None
        if coords and len(coords) > 0:
            result["coordinates"] = [
                {"lat": float(lat), "lng": float(lng)}
                for lng, lat in coords
            ]
        else:
            result["coordinates"] = []
    return result


async def get_distance_duration(origin_lat: float, origin_lng: float, dest_lat: float, dest_lng: float):
    """Convenience: just distance and duration."""
    result = await get_route(origin_lat, origin_lng, dest_lat, dest_lng)
    if result is None:
        return None
    return {"distance_km": result["distance_km"], "duration_min": result["duration_min"]}