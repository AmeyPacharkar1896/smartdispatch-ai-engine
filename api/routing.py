import math
import httpx

OSRM_BASE_URL = "http://localhost:5001"  # or host.docker.internal:5001 if API runs in Docker
# Used when local OSRM is unavailable or returns no geometry (same OSRM API, global coverage).
PUBLIC_OSRM_BASE_URL = "https://router.project-osrm.org"

# Greater Mumbai bounds (route endpoints must be inside for valid OSRM coverage)
MUMBAI_BOUNDS = {"lat_min": 18.88, "lat_max": 19.28, "lng_min": 72.78, "lng_max": 73.05}


def is_in_mumbai(lat: float, lng: float) -> bool:
    return (
        MUMBAI_BOUNDS["lat_min"] <= lat <= MUMBAI_BOUNDS["lat_max"]
        and MUMBAI_BOUNDS["lng_min"] <= lng <= MUMBAI_BOUNDS["lng_max"]
    )


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


def _parse_osrm_route_json(data: dict, *, with_geometry: bool) -> dict | None:
    """Parse OSRM /route JSON into our response shape. Returns None if not routable."""
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


async def _request_osrm_route(
    base_url: str,
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    *,
    with_geometry: bool,
) -> dict | None:
    url = f"{base_url.rstrip('/')}/route/v1/driving/{origin_lng},{origin_lat};{dest_lng},{dest_lat}"
    params: dict = {"steps": "false"}
    if with_geometry:
        params["overview"] = "full"
        params["geometries"] = "geojson"
    else:
        params["overview"] = "false"
    try:
        async with httpx.AsyncClient(timeout=45.0) as client:
            resp = await client.get(
                url,
                params=params,
                headers={"User-Agent": "smartdispatch-ai-engine/1.0"},
            )
            resp.raise_for_status()
            data = resp.json()
    except (httpx.HTTPError, httpx.RequestError, KeyError, IndexError, TypeError, ValueError):
        return None
    return _parse_osrm_route_json(data, with_geometry=with_geometry)


async def get_route(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    *,
    with_geometry: bool = False,
):
    """Get route from OSRM (local first, then public demo server). Returns distance, duration, optional geometry."""
    primary = await _request_osrm_route(
        OSRM_BASE_URL, origin_lat, origin_lng, dest_lat, dest_lng, with_geometry=with_geometry
    )
    if primary is not None:
        if not with_geometry:
            return primary
        coords = primary.get("coordinates") or []
        if len(coords) > 0:
            return primary

    return await _request_osrm_route(
        PUBLIC_OSRM_BASE_URL, origin_lat, origin_lng, dest_lat, dest_lng, with_geometry=with_geometry
    )


async def get_distance_duration(origin_lat: float, origin_lng: float, dest_lat: float, dest_lng: float):
    """Convenience: just distance and duration."""
    result = await get_route(origin_lat, origin_lng, dest_lat, dest_lng)
    if result is None:
        return None
    return {"distance_km": result["distance_km"], "duration_min": result["duration_min"]}