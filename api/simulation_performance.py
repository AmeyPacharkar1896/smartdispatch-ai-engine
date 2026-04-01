"""
Batch Monte-Carlo evaluation: random Mumbai O/D pairs, compare ML vs baselines.
Persists JSON under simulation_performance/ and mirrors notebook metrics shape.
"""
from __future__ import annotations

import json
import math
import random
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

from . import predict
from .routing import get_distance_duration, is_in_mumbai

REPO_ROOT = Path(__file__).resolve().parent.parent
SIM_PERF_DIR = REPO_ROOT / "simulation_performance"
EVAL_REPORT_PATH = REPO_ROOT / "docs" / "evaluation_report.json"

# Same POIs as simulation/Cart frontend (Greater Mumbai)
MUMBA_POIS: list[dict] = [
    {"id": "bandra", "name": "Bandra", "lat": 19.0596, "lng": 72.8341},
    {"id": "andheri", "name": "Andheri", "lat": 19.1136, "lng": 72.8491},
    {"id": "dadar", "name": "Dadar", "lat": 19.076, "lng": 72.8777},
    {"id": "colaba", "name": "Colaba", "lat": 18.9388, "lng": 72.8354},
    {"id": "mahalaxmi", "name": "Mahalaxmi", "lat": 19.0176, "lng": 72.8562},
    {"id": "parel", "name": "Parel", "lat": 19.0825, "lng": 72.8821},
    {"id": "bhandup", "name": "Bhandup", "lat": 19.1334, "lng": 72.913},
    {"id": "borivali", "name": "Borivali", "lat": 19.1998, "lng": 72.8414},
    {"id": "lower-parel", "name": "Lower Parel", "lat": 19.0703, "lng": 72.8692},
    {"id": "malabar-hill", "name": "Malabar Hill", "lat": 18.9926, "lng": 72.8291},
    {"id": "grant-road", "name": "Grant Road", "lat": 19.0215, "lng": 72.8424},
    {"id": "currey-road", "name": "Currey Road", "lat": 19.0896, "lng": 72.8656},
    {"id": "juhu", "name": "Juhu", "lat": 19.0027, "lng": 72.8025},
    {"id": "kandivali", "name": "Kandivali", "lat": 19.1688, "lng": 72.8591},
    {"id": "dahisar", "name": "Dahisar", "lat": 19.2193, "lng": 72.8378},
    {"id": "cuffe-parade", "name": "Cuffe Parade", "lat": 18.9447, "lng": 72.8274},
    {"id": "byculla", "name": "Byculla", "lat": 19.0748, "lng": 72.8826},
    {"id": "vile-parle", "name": "Vile Parle", "lat": 19.0021, "lng": 72.819},
]

PARCEL_TIERS = [
    {"id": "envelope", "weight_kg": 0.15, "volume_l": 0.4, "handling": 0.0, "dist_mult": 1.0},
    {"id": "small", "weight_kg": 1.2, "volume_l": 4.0, "handling": 18.0, "dist_mult": 1.1},
    {"id": "standard", "weight_kg": 4.0, "volume_l": 18.0, "handling": 42.0, "dist_mult": 1.28},
    {"id": "large", "weight_kg": 12.0, "volume_l": 55.0, "handling": 78.0, "dist_mult": 1.52},
    {"id": "oversized", "weight_kg": 28.0, "volume_l": 140.0, "handling": 165.0, "dist_mult": 1.88},
]

# Must match ml/01_data_generation.ipynb synthetic `price` (noise omitted for deterministic eval).
URGENCY_MULT_TRAINING = {"normal": 1.0, "express": 1.4, "same_day": 1.8}
SYN_BASE_INR = 50.0
SYN_PER_KM = 12.0
SYN_WEIGHT_PER_KG = 2.0
SYN_VOLUME_PER_L = 0.5


def _naive_duration_min(distance_km: float) -> float:
    """Baseline travel time: fixed 25 km/h (same spirit as notebook naive)."""
    return round((distance_km / 25.0) * 60.0, 4)


def _distance_only_price_inr(distance_km: float) -> float:
    """Simple distance-only tariff for baseline price comparisons."""
    return round(40.0 + 20.0 * distance_km, 2)


def _reference_price_training_inr(
    distance_km: float,
    weight_kg: float,
    volume_l: float,
    urgency: str,
    demand_score: float,
) -> float:
    """Label consistent with pricing_synthetic.csv / ml/01_data_generation (no ±5% label noise)."""
    core = (
        SYN_BASE_INR
        + distance_km * SYN_PER_KM
        + weight_kg * SYN_WEIGHT_PER_KG
        + volume_l * SYN_VOLUME_PER_L
    )
    mult = URGENCY_MULT_TRAINING.get(urgency, 1.0)
    pre = core * mult * demand_score
    return round(max(80.0, pre), 2)


def _mae(y_true: list[float], y_pred: list[float]) -> float:
    if not y_true:
        return 0.0
    return sum(abs(a - b) for a, b in zip(y_true, y_pred)) / len(y_true)


def _rmse(y_true: list[float], y_pred: list[float]) -> float:
    if not y_true:
        return 0.0
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(y_true, y_pred)) / len(y_true))


def _r2(y_true: list[float], y_pred: list[float]) -> float | None:
    if len(y_true) < 2:
        return None
    mean_y = sum(y_true) / len(y_true)
    ss_tot = sum((t - mean_y) ** 2 for t in y_true)
    if ss_tot == 0:
        return None
    ss_res = sum((t - p) ** 2 for t, p in zip(y_true, y_pred))
    return round(1.0 - ss_res / ss_tot, 6)


def _acc_within_pct(y_true: list[float], y_pred: list[float], pct: float) -> float:
    if not y_true:
        return 0.0
    tol = pct / 100.0
    ok = sum(1 for t, p in zip(y_true, y_pred) if abs(p - t) <= max(1e-6, abs(t) * tol))
    return round(100.0 * ok / len(y_true), 3)


def _run_simulation_charts(run_path: Path) -> tuple[bool, str | None]:
    """Generate docs/charts/simulation/*.png via scripts/plot_simulation_performance.py."""
    script = REPO_ROOT / "scripts" / "plot_simulation_performance.py"
    if not script.is_file():
        return False, "scripts/plot_simulation_performance.py not found"
    try:
        r = subprocess.run(
            [sys.executable, str(script), str(run_path)],
            cwd=str(REPO_ROOT),
            timeout=180,
            capture_output=True,
            text=True,
        )
        if r.returncode != 0:
            err = (r.stderr or r.stdout or "unknown error")[:800]
            return False, err
        return True, None
    except Exception as e:
        return False, str(e)[:800]


def _load_notebook_reference() -> dict | None:
    if not EVAL_REPORT_PATH.exists():
        return None
    try:
        return json.loads(EVAL_REPORT_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None


async def run_batch_eval(n: int, seed: int | None) -> dict:
    rng = random.Random(seed)
    SIM_PERF_DIR.mkdir(parents=True, exist_ok=True)

    rows: list[dict] = []
    skipped = 0
    urgencies = list(URGENCY_MULT_TRAINING.keys())

    for _ in range(n):
        i, j = rng.randrange(len(MUMBA_POIS)), rng.randrange(len(MUMBA_POIS))
        if i == j:
            j = (j + 1) % len(MUMBA_POIS)
        a, b = MUMBA_POIS[i], MUMBA_POIS[j]
        o_lat, o_lng = a["lat"], a["lng"]
        d_lat, d_lng = b["lat"], b["lng"]

        if not is_in_mumbai(o_lat, o_lng) or not is_in_mumbai(d_lat, d_lng):
            skipped += 1
            continue

        route = await get_distance_duration(o_lat, o_lng, d_lat, d_lng)
        if route is None:
            skipped += 1
            continue

        dist = float(route["distance_km"])
        dur_osrm = float(route["duration_min"])

        hour = rng.randint(0, 23)
        dow = rng.randint(0, 6)
        tier = rng.choice(PARCEL_TIERS)
        urgency = rng.choice(urgencies)
        demand = round(rng.uniform(0.5, 1.5), 2)  # same range as ml/01_data_generation.ipynb

        dur_naive = _naive_duration_min(dist)
        dur_ml = predict.predict_duration(dist, hour, dow)
        price_ml = predict.predict_price(
            dist, tier["weight_kg"], tier["volume_l"], urgency, hour, dow, demand
        )
        price_base_dist = _distance_only_price_inr(dist)
        price_ref = _reference_price_training_inr(
            dist, float(tier["weight_kg"]), float(tier["volume_l"]), urgency, demand
        )

        row = {
            "pickup_id": a["id"],
            "pickup_name": a["name"],
            "dest_id": b["id"],
            "dest_name": b["name"],
            "distance_km": round(dist, 4),
            "duration_osrm_min": round(dur_osrm, 4),
            "duration_naive_min": dur_naive,
            "duration_ml_min": dur_ml,
            "hour": hour,
            "day_of_week": dow,
            "parcel_tier": tier["id"],
            "urgency": urgency,
            "demand_score": demand,
            "price_reference_inr": price_ref,
            "price_baseline_dist_inr": price_base_dist,
            "price_ml_inr": price_ml,
        }
        rows.append(row)

    # Travel: truth = OSRM duration; naive baseline always defined
    yt_all = [r["duration_osrm_min"] for r in rows]
    yp_nv_all = [r["duration_naive_min"] for r in rows]
    tr_ml = [r for r in rows if r["duration_ml_min"] is not None]
    yt_tr = [r["duration_osrm_min"] for r in tr_ml]
    yp_ml_tr = [r["duration_ml_min"] for r in tr_ml]
    yp_nv_tr = [r["duration_naive_min"] for r in tr_ml]

    travel_summary: dict = {"n": 0, "note": "No successful route rows"}
    if yt_all:
        mae_nv = _mae(yt_all, yp_nv_all)
        travel_summary = {
            "n": len(yt_all),
            "unit": "min",
            "truth_label": "OSRM route duration_min",
            "mae_naive_vs_osrm": round(mae_nv, 6),
            "rmse_naive": round(_rmse(yt_all, yp_nv_all), 6),
            "r2_naive": _r2(yt_all, yp_nv_all),
            "accuracy_within_10pct_naive": _acc_within_pct(yt_all, yp_nv_all, 10),
            "mae_ml_vs_osrm": None,
            "rmse_ml": None,
            "r2_ml": None,
            "accuracy_within_10pct_ml": None,
            "improvement_vs_naive_pct": None,
        }
        if yt_tr:
            m_ml = _mae(yt_tr, yp_ml_tr)
            travel_summary["mae_ml_vs_osrm"] = round(m_ml, 6)
            travel_summary["rmse_ml"] = round(_rmse(yt_tr, yp_ml_tr), 6)
            travel_summary["r2_ml"] = _r2(yt_tr, yp_ml_tr)
            travel_summary["accuracy_within_10pct_ml"] = _acc_within_pct(yt_tr, yp_ml_tr, 10)
            travel_summary["improvement_vs_naive_pct"] = (
                round((1 - m_ml / mae_nv) * 100, 3) if mae_nv > 1e-9 else None
            )
        else:
            travel_summary["note"] = "ML travel model missing — naive vs OSRM only"

    # Price: truth = training-data pricing formula (synthetic); compare ML vs distance-only baseline
    yt_pr = [r["price_reference_inr"] for r in rows if r["price_ml_inr"] is not None]
    yp_ml_pr = [r["price_ml_inr"] for r in rows if r["price_ml_inr"] is not None]
    yp_bs_pr = [r["price_baseline_dist_inr"] for r in rows if r["price_ml_inr"] is not None]

    price_summary: dict = {"n": 0, "note": "ML pricing model missing or no successful rows"}
    if yt_pr:
        mae_ml_p = _mae(yt_pr, yp_ml_pr)
        mae_bs_p = _mae(yt_pr, yp_bs_pr)
        price_summary = {
            "n": len(yt_pr),
            "unit": "INR",
            "truth_label": (
                "Training-aligned synthetic price (ml/01_data_generation: base+dist+weight+volume, "
                "× urgency × demand; no label jitter)"
            ),
            "mae_ml_vs_reference": round(mae_ml_p, 6),
            "mae_distance_baseline_vs_reference": round(mae_bs_p, 6),
            "rmse_ml": round(_rmse(yt_pr, yp_ml_pr), 6),
            "r2_ml": _r2(yt_pr, yp_ml_pr),
            "r2_baseline": _r2(yt_pr, yp_bs_pr),
            "accuracy_within_10pct_ml": _acc_within_pct(yt_pr, yp_ml_pr, 10),
            "accuracy_within_10pct_baseline": _acc_within_pct(yt_pr, yp_bs_pr, 10),
            "improvement_vs_distance_baseline_pct": round((1 - mae_ml_p / mae_bs_p) * 100, 3)
            if mae_bs_p > 1e-9
            else None,
        }

    notebook_ref = _load_notebook_reference()
    comparison_block = {
        "notebook_evaluation_file": str(EVAL_REPORT_PATH.relative_to(REPO_ROOT))
        if EVAL_REPORT_PATH.exists()
        else None,
        "notebook_travel_mae_ml": notebook_ref.get("travel_time", {}).get("mae_ml") if notebook_ref else None,
        "notebook_travel_mae_baseline": notebook_ref.get("travel_time", {}).get("mae_baseline") if notebook_ref else None,
        "notebook_pricing_mae_ml": notebook_ref.get("pricing", {}).get("mae_ml") if notebook_ref else None,
        "notebook_pricing_mae_baseline": notebook_ref.get("pricing", {}).get("mae_baseline") if notebook_ref else None,
        "this_batch_travel_mae_ml": travel_summary.get("mae_ml_vs_osrm"),
        "this_batch_travel_mae_naive_vs_osrm": travel_summary.get("mae_naive_vs_osrm"),
        "this_batch_price_mae_ml": price_summary.get("mae_ml_vs_reference"),
        "this_batch_price_mae_dist_baseline": price_summary.get("mae_distance_baseline_vs_reference"),
        "note": (
            "Notebook metrics use held-out CSV labels; batch uses OSRM as travel truth and the "
            "same synthetic pricing formula as ml/01_data_generation (deterministic) for price. "
            "Pricing batch is now comparable in spirit to notebook pricing metrics."
        ),
    }

    created = datetime.now(timezone.utc).isoformat()
    out = {
        "created_at": created,
        "n_requested": n,
        "n_completed": len(rows),
        "n_skipped": skipped,
        "seed": seed,
        "travel_time": travel_summary,
        "pricing": price_summary,
        "comparison": comparison_block,
        "notebook_evaluation_snapshot": notebook_ref,
        "rows": rows,
    }

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    out_path = SIM_PERF_DIR / f"run_{ts}.json"
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    out["saved_to"] = str(out_path.relative_to(REPO_ROOT))

    charts_ok, charts_err = _run_simulation_charts(out_path)
    out["charts_generated"] = charts_ok
    out["charts_directory"] = "docs/charts/simulation"
    if not charts_ok and charts_err:
        out["charts_error"] = charts_err

    summary_only = {k: v for k, v in out.items() if k != "rows"}
    summary_only["run_file"] = str(out_path.relative_to(REPO_ROOT))
    (SIM_PERF_DIR / "latest_summary.json").write_text(json.dumps(summary_only, indent=2), encoding="utf-8")

    return out
