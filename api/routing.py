import httpx

OSRM_BASE_URL = "http://localhost:5001"  # or host.docker.internal:5001 if API runs in Docker


async def get_route(origin_lat: float, origin_lng: float, dest_lat: float, dest_lng: float):
    """Get route from OSRM. Returns distance (m), duration (s), and optional geometry."""
    url = f"{OSRM_BASE_URL}/route/v1/driving/{origin_lng},{origin_lat};{dest_lng},{dest_lat}"
    params = {"overview": "false", "steps": "false"}
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        data = resp.json()
    
    if data.get("code") != "Ok":
        return None
    
    route = data["routes"][0]
    return {
        "distance_m": route["distance"],
        "distance_km": round(route["distance"] / 1000, 2),
        "duration_s": route["duration"],
        "duration_min": round(route["duration"] / 60, 2),
    }


async def get_distance_duration(origin_lat: float, origin_lng: float, dest_lat: float, dest_lng: float):
    """Convenience: just distance and duration."""
    result = await get_route(origin_lat, origin_lng, dest_lat, dest_lng)
    if result is None:
        return None
    return {"distance_km": result["distance_km"], "duration_min": result["duration_min"]}