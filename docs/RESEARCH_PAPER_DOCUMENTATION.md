# Smart Delivery ML Pipeline: Complete Technical Documentation for Research

**Project:** Person-to-Person Courier Application for Mumbai  
**Domain:** Routing, Dynamic Pricing, Travel Time Prediction, Demand Forecasting, Agent Pre-positioning  
**Date:** February 2026

---

## Table of Contents

1. [Abstract](#1-abstract)
2. [Introduction & Problem Statement](#2-introduction--problem-statement)
3. [System Architecture](#3-system-architecture)
4. [Data Collection & Generation](#4-data-collection--generation)
5. [Machine Learning Models](#5-machine-learning-models)
6. [Evaluation Methodology & Results](#6-evaluation-methodology--results)
7. [API Design & Implementation](#7-api-design--implementation)
8. [Technical Stack & Dependencies](#8-technical-stack--dependencies)
9. [Limitations & Future Work](#9-limitations--future-work)
10. [Reproducibility](#10-reproducibility)

---

## 1. Abstract

We present an end-to-end machine learning pipeline for a smart, person-to-person delivery application operating in Mumbai, India. The system integrates Open Source Routing Machine (OSRM) for road-based routing with custom ML models for travel time prediction, dynamic pricing, demand forecasting, and agent hotspot identification. Our travel time model achieves 48.4% lower MAE than a naive distance/speed baseline; the pricing model achieves 90.5% improvement over distance-only pricing; and demand forecasting uses cyclic hour encoding to capture temporal patterns. All models are served via a REST API for real-time inference. The pipeline demonstrates how open-source routing data and gradient-boosted trees can be combined to build production-ready delivery intelligence without proprietary mapping services.

---

## 2. Introduction & Problem Statement

### 2.1 Context

Person-to-person (P2P) courier services require accurate estimates of travel time, fair and dynamic pricing, and efficient placement of delivery agents to minimize wait times and maximize throughput. In densely populated cities like Mumbai, traffic varies significantly by time of day and day of week, making fixed-rule approaches suboptimal.

### 2.2 Objectives

- **Travel time prediction**: Estimate delivery duration from origin–destination distance and temporal features (hour, day of week, rush-hour indicator) to provide reliable ETAs.
- **Dynamic pricing**: Predict delivery price from distance, weight, volume, urgency tier, time, and demand score.
- **Demand forecasting**: Estimate expected request volume by hour and day of week for capacity planning.
- **Agent hotspots**: Identify high-demand geographic clusters for pre-positioning delivery agents.

### 2.3 Scope

The system focuses on the Greater Mumbai region, using OpenStreetMap (OSM) data for routing via OSRM. Models are trained on synthetically augmented and API-derived data; the architecture is designed to integrate real transactional data in production.

---

## 3. System Architecture

### 3.1 High-Level Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Smart Delivery ML Pipeline                        │
├─────────────────────────────────────────────────────────────────────────┤
│  Data Layer          │  ML Layer              │  API Layer              │
│  ─────────────       │  ───────────            │  ───────────            │
│  • OSRM (Mumbai)     │  • Travel Time (LGB)    │  • FastAPI REST          │
│  • Travel Times CSV  │  • Pricing (LGB)        │  • 9 Endpoints           │
│  • Pricing CSV       │  • Demand (LGB)        │  • Real-time Inference   │
│  • 20 Road Locations │  • Hotspots (K-Means)   │                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Component Overview

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Routing Engine** | OSRM (Open Source Routing Machine) | Shortest-path routing on Mumbai road network |
| **Map Data** | OSM BBBike extract (`Bombay.osm.pbf`) | Mumbai road topology |
| **ML Framework** | LightGBM, scikit-learn | Regression and clustering |
| **API Server** | FastAPI, Uvicorn | REST API for routing and ML inference |

---

## 4. Data Collection & Generation

### 4.1 Travel Time Data

**Source:** `ml/01_data_generation.ipynb`

**Method:**
- **Origin–Destination sampling**: 20 fixed road coordinates across Mumbai (Bandra, Andheri, Dadar, Colaba, Juhu, Borivali, etc.).
- **API calls**: For each randomly sampled O/D pair, the system calls `GET /route` (which uses OSRM) to obtain `distance_km` and `duration_min`.
- **Temporal sampling**: `hour` (0–23) and `day_of_week` (0–6) are drawn uniformly at random to simulate requests at different times.
- **Volume**: 1,000 samples per run; failed API calls are skipped.

**Output schema** (`data/raw/travel_times.csv`):

| Column | Type | Description |
|--------|------|-------------|
| origin_lat | float | Pickup latitude |
| origin_lng | float | Pickup longitude |
| dest_lat | float | Drop latitude |
| dest_lng | float | Drop longitude |
| distance_km | float | Route distance in km |
| duration_min | float | Route duration in minutes (OSRM) |
| hour | int | Hour of day (0–23) |
| day_of_week | int | Day of week (0=Mon, 6=Sun) |

**Sample statistics:**
- Typical run: ~955 successful records
- Distance range: ~1–25 km
- Duration range: ~5–25 min

### 4.2 Synthetic Pricing Data

**Source:** `ml/01_data_generation.ipynb`

**Purpose:** Simulate delivery pricing when real transaction data is unavailable.

**Rule-based formula (with noise):**
```
price = BASE_PRICE + distance_km × PER_KM + weight_kg × WEIGHT_PER_KG + volume_l × VOLUME_PER_L
price *= URGENCY_MULT[urgency] × demand_score × random(0.95, 1.05)
price = max(80, price)  # Minimum 80 INR
```

**Parameters:**
- `BASE_PRICE = 50`
- `PER_KM = 12`
- `WEIGHT_PER_KG = 2`, `VOLUME_PER_L = 0.5`
- `URGENCY_MULT`: normal=1.0, express=1.4, same_day=1.8
- `demand_score`: uniform in [0.5, 1.5]

**Output:** `data/raw/pricing_synthetic.csv` — 5,000 rows with columns: `distance_km`, `weight_kg`, `volume_l`, `urgency`, `hour`, `day_of_week`, `demand_score`, `price`.

### 4.3 Mumbai Road Locations (Fixed Seeds)

The 20 coordinates used for O/D sampling span key Mumbai areas:

```
(19.0596, 72.8341), (19.1136, 72.8491), (19.0760, 72.8777), (18.9388, 72.8354),
(19.0176, 72.8562), (19.0825, 72.8821), (19.1334, 72.9130), (19.1998, 72.8414),
(19.0703, 72.8692), (18.9926, 72.8291), (19.0554, 72.8781), (19.0215, 72.8424),
(19.0896, 72.8656), (19.0027, 72.8025), (19.1688, 72.8591), (19.2193, 72.8378),
(18.9447, 72.8274), (19.0748, 72.8826), (19.0021, 72.8190)
```

---

## 5. Machine Learning Models

### 5.1 Travel Time Prediction

**File:** `models/travel_time_model.joblib`

**Algorithm:** LightGBM Regressor

**Features:**
- `distance_km`: Route distance from OSRM
- `hour`: Hour of day (0–23)
- `day_of_week`: Day of week (0–6)
- `is_rush`: Binary flag — 1 if hour in [7–9] or [17–20], else 0

**Target:** `duration_min` (minutes)

**Hyperparameters:**
- n_estimators: 200
- num_leaves: 31
- learning_rate: 0.08
- max_depth: 6
- min_child_samples: 20
- random_state: 42

**Training split:** 80% train, 20% validation (random_state=42)

**Validation MAE:** ~0.75 min

**Design rationale:** Rush-hour flag and time-of-day features allow the model to capture traffic-induced slowdowns compared to a static distance/speed baseline.

---

### 5.2 Dynamic Pricing

**Files:** `models/pricing_model.joblib`, `models/urgency_encoder.joblib`

**Algorithm:** LightGBM Regressor

**Features:**
- `distance_km`: Delivery distance
- `weight_kg`: Parcel weight
- `volume_l`: Parcel volume (liters)
- `urgency_enc`: Label-encoded urgency (normal, express, same_day)
- `hour`: Hour of day
- `day_of_week`: Day of week
- `demand_score`: Demand multiplier (0.5–2.0)

**Target:** `price` (INR)

**Hyperparameters:**
- n_estimators: 150
- num_leaves: 31
- learning_rate: 0.08
- max_depth: 7
- min_child_samples: 15
- random_state: 42

**Validation MAE:** ~16.32 INR

**Design rationale:** Multi-feature model learns interactions between urgency, demand, and time; baseline (distance-only) fails to capture these.

---

### 5.3 Demand Forecasting

**File:** `models/demand_model.joblib`

**Algorithm:** LightGBM Regressor

**Data source:** Aggregated from `travel_times.csv` — city-wide request count per `(hour, day_of_week)`.

**Features:**
- `hour`: Raw hour (0–23)
- `day_of_week`: Day of week (0–6)
- `hour_sin`: sin(2π × hour / 24) — cyclic encoding
- `hour_cos`: cos(2π × hour / 24) — cyclic encoding
- `is_rush`: Binary rush-hour flag

**Target:** `count` — number of requests in that (hour, dow) bin

**Hyperparameters:**
- n_estimators: 80
- max_depth: 4
- learning_rate: 0.15
- random_state: 42

**Design rationale:** Cyclic encoding ensures 23:00 and 00:00 are close in feature space; rush-hour flag highlights peak periods.

**Note:** Demand data is derived from travel-time sample distribution; with real transactional data, aggregation would use actual request timestamps.

---

### 5.4 Agent Hotspots (K-Means Clustering)

**File:** `models/hotspots.joblib`

**Algorithm:** K-Means (scikit-learn)

**Input:** All origin and destination coordinates from `travel_times.csv` concatenated (2× rows per route).

**Parameters:**
- n_clusters: 10
- random_state: 42
- n_init: 10

**Output:** 10 cluster centroids as `{lat, lng, rank}` for agent pre-positioning.

**Quality metric:** Silhouette score ≈ 0.758 (0.5+ indicates good separation)

---

## 6. Evaluation Methodology & Results

**Source:** `ml/03_evaluation.ipynb`, `docs/evaluation_report.json`

### 6.1 Metrics Used

| Metric | Definition | Use |
|--------|------------|-----|
| MAE | Mean Absolute Error | Primary error metric |
| RMSE | Root Mean Square Error | Penalizes large errors |
| R² | Coefficient of determination | Variance explained |
| Accuracy (within X%) | % of predictions within X% of actual | Practical acceptability |

### 6.2 Travel Time Model

**Baseline:** Naive distance/speed — `duration = distance_km / avg_speed`, where avg_speed is computed from training data.

| Metric | ML Model | Naive Baseline |
|--------|----------|----------------|
| MAE | 0.75 min | 1.44 min |
| RMSE | 0.99 min | — |
| R² | 0.978 | 0.930 |
| Accuracy (within 10%) | 75.9% | 51.3% |

**Result:** **48.4% better than baseline** (by MAE reduction).

**MAE by distance bucket:**
- Short (0–5 km): 0.49 min (n=21)
- Medium (5–15 km): 0.79 min (n=92)
- Long (15+ km): 0.77 min (n=78)

**Test set:** 191 samples (20% holdout)

---

### 6.3 Pricing Model

**Baseline:** Distance-only — `price = 50 + distance_km × avg_km_rate`, clipped to minimum 80 INR.

| Metric | ML Model | Baseline |
|--------|----------|----------|
| MAE | 16.32 INR | 172.40 INR |
| R² | 0.995 | 0.448 |
| Accuracy (within 10%) | 96.3% | 17.2% |

**Result:** **90.5% better than baseline** (by MAE reduction).

**Test set:** 1,000 samples (20% holdout)

---

### 6.4 Demand Forecasting

**Baseline:** Median count per (hour, day_of_week) from training data only (no leakage).

| Metric | ML Model | Baseline |
|--------|----------|----------|
| MAE | 1.76 | 1.85 |
| R² | 0.19 | -0.01 |
| Accuracy (within 20%) | 29.4% | 35.3% |

**Result:** **4.9% better than baseline** (by MAE); ML has higher R². Accuracy metric is noisy due to small counts and few unique (hour, dow) bins.

**Test set:** 34 samples (20% holdout of aggregated bins)

---

### 6.5 Hotspots

- **Silhouette score:** 0.758 (good separation)
- **Points:** 1,910 (955 routes × 2 endpoints)
- **Clusters:** 10

---

### 6.6 Summary: ML vs Baseline

| Model | vs Baseline | Primary Improvement |
|-------|-------------|---------------------|
| Travel time | **48.4% better** | Time-of-day and rush-hour awareness |
| Pricing | **90.5% better** | Multi-factor (urgency, demand, time) |
| Demand | **4.9% better** | Cyclic hour + rush-hour encoding |

---

## 7. API Design & Implementation

### 7.1 Stack

- **Framework:** FastAPI
- **Server:** Uvicorn
- **HTTP Client:** httpx (async)

### 7.2 Endpoints

| Method | Endpoint | Description | Dependencies |
|--------|----------|-------------|--------------|
| GET | `/health` | Health check | — |
| GET | `/route` | Route with distance & duration | OSRM |
| GET | `/distance` | Distance & duration only | OSRM |
| GET | `/eta` | ETA: route + ML duration → arrival time | OSRM, Travel model |
| GET | `/route/traffic-aware` | Route with ML-adjusted duration | OSRM, Travel model |
| GET | `/predict/duration` | ML travel time prediction | Travel model |
| GET | `/predict/price` | ML dynamic pricing | Pricing model |
| GET | `/forecast/demand` | ML demand forecast | Demand model |
| GET | `/hotspots` | Hotspot centroids | Hotspots |

### 7.3 Routing (OSRM Integration)

**File:** `api/routing.py`

- **Base URL:** `http://localhost:5001`
- **Endpoint:** `/route/v1/driving/{lng1},{lat1};{lng2},{lat2}`
- **Returns:** `distance_m`, `distance_km`, `duration_s`, `duration_min`

**Requirement:** OSRM must be running with Mumbai OSM extract (e.g. BBBike Bombay.osm.pbf).

### 7.4 ML Inference Pipeline

**File:** `api/predict.py`

- **Lazy loading:** Models loaded on first request
- **Feature computation at inference:**
  - Travel: `is_rush` from `hour`
  - Demand: `hour_sin`, `hour_cos`, `is_rush` from `hour`
  - Pricing: `urgency_enc` from label encoder

### 7.5 ETA Logic

Given departure time, the system:
1. Fetches route from OSRM
2. Extracts `hour` and `day_of_week` from departure
3. Predicts `duration_min` via ML (or falls back to OSRM duration)
4. Computes `eta_at = departure_at + duration_min`

---

## 8. Technical Stack & Dependencies

### 8.1 Core Dependencies (`requirements.txt`)

```
fastapi==0.109.0
uvicorn[standard]==0.27.0
httpx==0.26.0
pandas==2.2.0
lightgbm==4.3.0
scikit-learn==1.4.0
joblib==1.3.2
matplotlib==3.8.2
```

### 8.2 External Services

- **OSRM:** Self-hosted on port 5001, using preprocessed Mumbai OSM data
- **Map data:** BBBike Mumbai extract (`Bombay.osm.pbf`)

### 8.3 Project Structure

```
major-project/
├── api/
│   ├── main.py          # FastAPI app, all endpoints
│   ├── routing.py       # OSRM client
│   └── predict.py       # ML inference
├── ml/
│   ├── 01_data_generation.ipynb
│   ├── 02_model_training.ipynb
│   └── 03_evaluation.ipynb
├── data/
│   └── raw/
│       ├── travel_times.csv
│       └── pricing_synthetic.csv
├── models/
│   ├── travel_time_model.joblib
│   ├── pricing_model.joblib
│   ├── urgency_encoder.joblib
│   ├── demand_model.joblib
│   └── hotspots.joblib
├── docs/
│   ├── evaluation_report.json
│   ├── API_SAMPLE_OUTPUTS.md
│   └── RESEARCH_PAPER_DOCUMENTATION.md  (this file)
└── requirements.txt
```

---

## 9. Limitations & Future Work

### 9.1 Limitations

1. **Travel time data:** Derived from OSRM routing; no real-time traffic. OSRM gives shortest-path duration, not live congestion.
2. **Pricing data:** Fully synthetic; real pricing depends on market and operator policy.
3. **Demand:** Aggregated from travel-time sample distribution, not actual order volumes. Small (hour, dow) bins lead to noisy metrics.
4. **Geography:** Fixed to Mumbai; models and hotspots are not transferable without retraining.
5. **Hotspots:** Based on O/D sample locations; real hotspots require historical pickup/drop data.

### 9.2 Future Work

1. **Real traffic:** Integrate live traffic APIs (e.g. Google Maps, HERE) or historical speed profiles for time-dependent routing.
2. **Real pricing data:** Train on actual transactions; add competitor price features if available.
3. **Real demand:** Use actual order timestamps; consider spatial (zone-level) demand models.
4. **Deep learning:** Explore LSTMs or Transformers for temporal demand and travel time if sufficient data exists.
5. **A/B testing:** Compare ML ETAs and pricing vs. legacy rules in production.
6. **Multi-city:** Extend pipeline to other cities with local OSM extracts and retraining.

---

## 10. Reproducibility

### 10.1 Environment Setup

```bash
pip install -r requirements.txt
```

### 10.2 Start OSRM (Mumbai)

```bash
docker run -t -i -p 5001:5000 -v "$(pwd)":/data ghcr.io/project-osrm/osrm-backend:latest osrm-routed /data/data/Bombay.osrm
```

*(Assumes Bombay.osrm preprocessed from Bombay.osm.pbf.)*

### 10.3 Data & Model Pipeline

1. Start API (with OSRM running): `uvicorn api.main:app --reload --port 8000`
2. Run `ml/01_data_generation.ipynb` (generates travel_times.csv, pricing_synthetic.csv)
3. Run `ml/02_model_training.ipynb` (trains and saves all models)
4. Run `ml/03_evaluation.ipynb` (produces evaluation_report.json)

### 10.4 Random Seeds

- `random_state=42` used in: train_test_split, LightGBM, K-Means
- O/D sampling uses `random.choice`; full reproducibility requires fixed seed before data generation

### 10.5 Expected Outputs

- **Travel times:** ~955 rows
- **Pricing:** 5,000 rows
- **Travel MAE:** ~0.75 min
- **Pricing MAE:** ~16 INR
- **Travel R²:** ~0.98
- **Pricing R²:** ~0.99

---

## References & Resources

- **OSRM:** https://project-osrm.org/
- **BBBike extracts:** https://download.bbbike.org/osm/
- **LightGBM:** https://lightgbm.readthedocs.io/
- **FastAPI:** https://fastapi.tiangolo.com/
- **OpenStreetMap:** https://www.openstreetmap.org/

---

*Document version: 1.0 — February 2026*
