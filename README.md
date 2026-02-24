# SmartDispatch AI Engine

The Python-based AI/ML Optimization Engine for SmartDispatch. This repo contains the code for dynamic pricing, route optimization, demand prediction, and agent hotspot identification. It exposes its functionalities via a FastAPI that the smartdispatch-backend can consume.

---

## Smart Delivery ML Pipeline

Person-to-person delivery app with routing, dynamic pricing, and travel time prediction for Mumbai.

## Quick Start

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Start OSRM (Mumbai routing)

```bash
docker run -t -i -p 5001:5000 -v "$(pwd)":/data ghcr.io/project-osrm/osrm-backend:latest osrm-routed /data/data/Bombay.osrm
```

### 3. Generate data & train models

```bash
cd ml
jupyter notebook
# Run 01_data_generation.ipynb
# Run 02_model_training.ipynb
```

### 4. Start API

```bash
uvicorn api.main:app --reload --port 8000
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check |
| `GET /route` | Route with distance & duration (OSRM) |
| `GET /distance` | Distance & duration only |
| `GET /eta` | ETA: route + ML duration → arrival time |
| `GET /route/traffic-aware` | Route with traffic-adjusted duration (ML) |
| `GET /predict/duration` | ML: predict travel time |
| `GET /predict/price` | ML: dynamic pricing |
| `GET /forecast/demand` | ML: demand forecast by hour & day |
| `GET /hotspots` | Hotspot centroids for agent pre-positioning |

### Example requests

```bash
# Route (Bandra → Andheri)
curl "http://localhost:8000/route?origin_lat=19.0596&origin_lng=72.8341&dest_lat=19.1136&dest_lng=72.8491"

# Predict duration (distance_km=15, hour=18, day=5)
curl "http://localhost:8000/predict/duration?distance_km=15&hour=18&day_of_week=5"

# Predict price
curl "http://localhost:8000/predict/price?distance_km=10&weight_kg=2&volume_l=5&urgency=express"
```

---

## Dev Backend (auth, orders, drivers)

For local mobile development, a stub backend provides auth, orders, and driver APIs:

```bash
uvicorn backend.main:app --reload --port 8000
```

The mobile app expects the backend on port 8000 and the AI engine on port 8001. Run both in separate terminals:

```bash
# Terminal 1: Backend (auth, orders, drivers)
uvicorn backend.main:app --reload --port 8000

# Terminal 2: AI Engine (routing, pricing)
uvicorn api.main:app --reload --port 8001
```

---

## Mobile App (React Native)

A React Native (Expo) app in `mobile/` provides Customer and Driver flows.

```bash
cd mobile
npm install
npm start
```

See [mobile/README.md](mobile/README.md) for setup and [docs/SMARTDISPATCH_ARCHITECTURE.md](docs/SMARTDISPATCH_ARCHITECTURE.md) for architecture.
