# ML Delivery API – Sample Outputs for Node.js Integration

**Base URL:** `http://localhost:8000`  
**Content-Type:** `application/json`

---

## 1. Health Check

**Request**
```
GET /health
```

**Sample Response** (200)
```json
{"status":"ok"}
```

---

## 2. Route (Distance & Duration from OSRM)

**Request**
```
GET /route?origin_lat=19.06&origin_lng=72.83&dest_lat=19.11&dest_lng=72.85
```

**Query Params**
| Param       | Type  | Required | Description        |
|------------|-------|----------|--------------------|
| origin_lat | float | ✓        | Pickup latitude    |
| origin_lng | float | ✓        | Pickup longitude   |
| dest_lat   | float | ✓        | Drop latitude      |
| dest_lng   | float | ✓        | Drop longitude     |

**Sample Response** (200)
```json
{
  "distance_m": 7367,
  "distance_km": 7.37,
  "duration_s": 497.7,
  "duration_min": 8.29
}
```

---

## 3. Distance (Short Form)

**Request**
```
GET /distance?origin_lat=19.06&origin_lng=72.83&dest_lat=19.11&dest_lng=72.85
```

**Sample Response** (200)
```json
{
  "distance_km": 7.37,
  "duration_min": 8.29
}
```

---

## 4. ETA (Estimated Arrival Time)

**Request**
```
GET /eta?origin_lat=19.06&origin_lng=72.83&dest_lat=19.11&dest_lng=72.85
```

**Query Params**
| Param          | Type | Required | Description                      |
|----------------|------|----------|----------------------------------|
| origin_lat     | float| ✓        | Pickup latitude                  |
| origin_lng     | float| ✓        | Pickup longitude                 |
| dest_lat       | float| ✓        | Drop latitude                    |
| dest_lng       | float| ✓        | Drop longitude                   |
| departure_time | string| ✗       | ISO datetime, e.g. `2026-02-14T18:00:00` |

**Sample Response** (200)
```json
{
  "distance_km": 7.37,
  "duration_min": 8.12,
  "departure_at": "2026-02-14T11:55:44.056631+00:00",
  "eta_at": "2026-02-14T12:03:51.256631+00:00"
}
```

---

## 5. Traffic-Aware Route

**Request**
```
GET /route/traffic-aware?origin_lat=19.06&origin_lng=72.83&dest_lat=19.11&dest_lng=72.85
```

**Query Params**
| Param      | Type | Required | Description              |
|------------|------|----------|--------------------------|
| origin_lat | float| ✓        | Pickup latitude          |
| origin_lng | float| ✓        | Pickup longitude         |
| dest_lat   | float| ✓        | Drop latitude            |
| dest_lng   | float| ✓        | Drop longitude           |
| hour       | int  | ✗        | Current hour (0-23), default: now |
| day_of_week | int | ✗       | 0=Mon..6=Sun, default: today |

**Sample Response** (200)
```json
{
  "distance_km": 7.37,
  "duration_min_osrm": 8.29,
  "duration_min_traffic_adjusted": 8.12
}
```

---

## 6. Predict Duration (ML)

**Request**
```
GET /predict/duration?distance_km=15&hour=18&day_of_week=5
```

**Query Params**
| Param       | Type  | Required | Description        |
|-------------|-------|----------|--------------------|
| distance_km | float | ✓        | Route distance     |
| hour        | int   | ✓        | Hour of day (0-23) |
| day_of_week | int   | ✓        | 0=Mon..6=Sun       |

**Sample Response** (200)
```json
{
  "duration_min": 15.17
}
```

---

## 7. Predict Price (ML – Dynamic Pricing)

**Request**
```
GET /predict/price?distance_km=10&weight_kg=2&volume_l=5&urgency=express
```

**Query Params**
| Param       | Type  | Required | Default | Description               |
|-------------|-------|----------|---------|---------------------------|
| distance_km | float | ✓        | -       | Distance in km            |
| weight_kg   | float | ✓        | -       | Package weight (kg)       |
| volume_l    | float | ✓        | -       | Volume in litres          |
| urgency     | string| ✓        | normal  | `normal`, `express`, `same_day` |
| hour        | int   | ✗        | 12      | Hour (0-23)               |
| day_of_week | int   | ✗        | 0       | 0=Mon..6=Sun             |
| demand_score| float | ✗        | 1.0     | Demand multiplier (0.5-2.0) |

**Sample Response** (200)
```json
{
  "price_inr": 259.17
}
```

---

## 8. Demand Forecast (ML)

**Request**
```
GET /forecast/demand?hour=18&day_of_week=4
```

**Query Params**
| Param       | Type | Required | Description        |
|-------------|------|----------|--------------------|
| hour        | int  | ✓        | Hour (0-23)        |
| day_of_week | int  | ✓        | 0=Mon..6=Sun      |

**Sample Response** (200)
```json
{
  "demand_forecast": 5.5
}
```

---

## 9. Hotspots (Agent Pre-positioning)

**Request**
```
GET /hotspots?top_n=5
```

**Query Params**
| Param | Type | Required | Default | Description            |
|-------|------|----------|---------|------------------------|
| top_n | int  | ✗        | 10      | Number of hotspots (1-20) |

**Sample Response** (200)
```json
{
  "hotspots": [
    {"lat": 19.1688, "lng": 72.8591, "rank": 1},
    {"lat": 18.9989, "lng": 72.8176, "rank": 2},
    {"lat": 19.0896, "lng": 72.8656, "rank": 3},
    {"lat": 18.9421, "lng": 72.831, "rank": 4},
    {"lat": 19.1334, "lng": 72.913, "rank": 5}
  ]
}
```

---

## Node.js Integration Example

```javascript
const BASE_URL = 'http://localhost:8000';

// Using fetch (Node 18+)
async function getRoute(originLat, originLng, destLat, destLng) {
  const params = new URLSearchParams({ origin_lat: originLat, origin_lng: originLng, dest_lat: destLat, dest_lng: destLng });
  const res = await fetch(`${BASE_URL}/route?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function getETA(originLat, originLng, destLat, destLng, departureTime) {
  const params = new URLSearchParams({ origin_lat: originLat, origin_lng: originLng, dest_lat: destLat, dest_lng: destLng });
  if (departureTime) params.set('departure_time', departureTime);
  const res = await fetch(`${BASE_URL}/eta?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function getPrice(distanceKm, weightKg, volumeL, urgency = 'normal') {
  const params = new URLSearchParams({ distance_km: distanceKm, weight_kg: weightKg, volume_l: volumeL, urgency });
  const res = await fetch(`${BASE_URL}/predict/price?${params}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function getHotspots(topN = 5) {
  const res = await fetch(`${BASE_URL}/hotspots?top_n=${topN}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Example usage
(async () => {
  const route = await getRoute(19.06, 72.83, 19.11, 72.85);
  console.log(route); // { distance_km: 7.37, duration_min: 8.29, ... }

  const price = await getPrice(10, 2, 5, 'express');
  console.log(price); // { price_inr: 259.17 }

  const hotspots = await getHotspots(5);
  console.log(hotspots.hotspots); // [{ lat, lng, rank }, ...]
})();
```

---

## Error Responses

| Status | When |
|--------|------|
| 404 | Route not found (points outside Mumbai / unreachable) |
| 503 | ML model not loaded (run `ml/02_model_training.ipynb` first) |
