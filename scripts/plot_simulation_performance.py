#!/usr/bin/env python3
"""
Generate matplotlib charts from simulation_performance/run_*.json, styled like ml/03_evaluation.ipynb.

Outputs under docs/charts/simulation/:
  - sim_travel_osrm_vs_ml_and_baseline.png — OSRM vs ML, OSRM vs naive, ML residuals
  - sim_pricing_reference_vs_ml_and_baseline.png — synthetic training formula vs ML / vs distance baseline, residuals
  - sim_batch_mae_travel_pricing.png — batch MAE bars (ML vs baselines)
  - sim_notebook_vs_batch_context.png — MAE comparison (4 bars) + improvement % where available

Usage:
  python scripts/plot_simulation_performance.py
  python scripts/plot_simulation_performance.py simulation_performance/run_20260325_084425.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CHARTS_DIR = REPO / "docs" / "charts" / "simulation"
SIM_DIR = REPO / "simulation_performance"
LATEST_SUMMARY = SIM_DIR / "latest_summary.json"


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def resolve_run_path(arg: str | None) -> Path:
    if arg:
        p = Path(arg)
        if not p.is_absolute():
            p = REPO / p
        if not p.exists():
            sys.exit(f"Run file not found: {p}")
        return p
    if not LATEST_SUMMARY.exists():
        sys.exit(f"No {LATEST_SUMMARY} — run a batch evaluation first.")
    summary = _load_json(LATEST_SUMMARY)
    rel = summary.get("run_file")
    if not rel:
        sys.exit("latest_summary.json has no run_file")
    p = REPO / rel
    if not p.exists():
        sys.exit(f"Run file missing: {p}")
    return p


def plot_travel(rows: list[dict], out: Path) -> None:
    import matplotlib.pyplot as plt
    import numpy as np

    ys, ml, nv = [], [], []
    for r in rows:
        if r.get("duration_ml_min") is None:
            continue
        ys.append(float(r["duration_osrm_min"]))
        ml.append(float(r["duration_ml_min"]))
        nv.append(float(r["duration_naive_min"]))
    if len(ys) < 2:
        print("Skipping travel charts: not enough ML rows.")
        return

    fig, axes = plt.subplots(1, 3, figsize=(12, 3.8))
    mx = max(max(ys), max(ml), max(nv)) * 1.05

    axes[0].scatter(ys, ml, alpha=0.55, s=14, c="#2ecc71", edgecolors="none")
    axes[0].plot([0, mx], [0, mx], "k--", linewidth=1, label="Perfect")
    axes[0].set_xlabel("OSRM duration (min)")
    axes[0].set_ylabel("ML predicted (min)")
    axes[0].set_title("Simulation travel: OSRM vs ML")
    axes[0].legend(loc="upper left", fontsize=8)
    axes[0].set_aspect("equal", adjustable="box")

    axes[1].scatter(ys, nv, alpha=0.55, s=14, c="#e74c3c", edgecolors="none")
    axes[1].plot([0, mx], [0, mx], "k--", linewidth=1)
    axes[1].set_xlabel("OSRM duration (min)")
    axes[1].set_ylabel("Naive baseline 25 km/h (min)")
    axes[1].set_title("Simulation travel: OSRM vs baseline")

    res = np.array(ml) - np.array(ys)
    axes[2].hist(res, bins=min(30, max(10, len(ys) // 5)), edgecolor="black", alpha=0.75, color="#2ecc71")
    axes[2].axvline(0, color="red", linestyle="--", linewidth=1)
    axes[2].set_xlabel("Residual: ML − OSRM (min)")
    axes[2].set_title("ML residuals vs OSRM")

    plt.suptitle("Batch simulation — travel (truth = OSRM route duration)", fontsize=11, y=1.02)
    plt.tight_layout()
    plt.savefig(out / "sim_travel_osrm_vs_ml_and_baseline.png", dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Wrote {out / 'sim_travel_osrm_vs_ml_and_baseline.png'}")


def plot_pricing(rows: list[dict], out: Path) -> None:
    import matplotlib.pyplot as plt
    import numpy as np

    ref, ml_p, base = [], [], []
    for r in rows:
        if r.get("price_ml_inr") is None:
            continue
        ref.append(float(r["price_reference_inr"]))
        ml_p.append(float(r["price_ml_inr"]))
        base.append(float(r["price_baseline_dist_inr"]))
    if len(ref) < 2:
        print("Skipping pricing charts: not enough ML price rows.")
        return

    fig, axes = plt.subplots(1, 3, figsize=(12, 3.8))
    mx = max(max(ref), max(ml_p), max(base)) * 1.05

    axes[0].scatter(ref, ml_p, alpha=0.45, s=12, c="#2ecc71", edgecolors="none")
    axes[0].plot([0, mx], [0, mx], "k--", linewidth=1)
    axes[0].set_xlabel("Synthetic reference (INR)")
    axes[0].set_ylabel("ML price (INR)")
    axes[0].set_title("Simulation pricing: ref vs ML")

    axes[1].scatter(ref, base, alpha=0.45, s=12, c="#e74c3c", edgecolors="none")
    axes[1].plot([0, mx], [0, mx], "k--", linewidth=1)
    axes[1].set_xlabel("Synthetic reference (INR)")
    axes[1].set_ylabel("Distance-only baseline (INR)")
    axes[1].set_title("Simulation pricing: ref vs baseline")

    res = np.array(ml_p) - np.array(ref)
    axes[2].hist(res, bins=min(35, max(10, len(ref) // 4)), edgecolor="black", alpha=0.75, color="#2ecc71")
    axes[2].axvline(0, color="red", linestyle="--", linewidth=1)
    axes[2].set_xlabel("Residual: ML − reference (INR)")
    axes[2].set_title("ML residuals vs reference")

    plt.suptitle(
        "Batch simulation — pricing (reference = training synthetic formula)",
        fontsize=11,
        y=1.02,
    )
    plt.tight_layout()
    plt.savefig(out / "sim_pricing_reference_vs_ml_and_baseline.png", dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Wrote {out / 'sim_pricing_reference_vs_ml_and_baseline.png'}")


def plot_batch_mae_bars(data: dict, out: Path) -> None:
    import matplotlib.pyplot as plt

    tt = data.get("travel_time") or {}
    pr = data.get("pricing") or {}

    fig, axes = plt.subplots(1, 2, figsize=(10, 4))

    m_ml = tt.get("mae_ml_vs_osrm")
    m_nv = tt.get("mae_naive_vs_osrm")
    if m_ml is not None and m_nv is not None:
        bars = axes[0].bar(["ML vs OSRM", "Naive vs OSRM"], [m_ml, m_nv], color=["#2ecc71", "#e74c3c"], edgecolor="black")
        axes[0].set_ylabel("MAE (minutes)")
        axes[0].set_title("Simulation batch — travel MAE")
        for b in bars:
            h = b.get_height()
            axes[0].text(b.get_x() + b.get_width() / 2, h + 0.05 * max(m_ml, m_nv), f"{h:.2f}", ha="center", fontsize=10)

    p_ml = pr.get("mae_ml_vs_reference")
    p_bs = pr.get("mae_distance_baseline_vs_reference")
    if p_ml is not None and p_bs is not None:
        bars2 = axes[1].bar(
            ["ML vs ref", "Dist baseline vs ref"],
            [p_ml, p_bs],
            color=["#2ecc71", "#e74c3c"],
            edgecolor="black",
        )
        axes[1].set_ylabel("MAE (INR)")
        axes[1].set_title("Simulation batch — pricing MAE")
        mxp = max(p_ml, p_bs)
        for b in bars2:
            h = b.get_height()
            axes[1].text(b.get_x() + b.get_width() / 2, h + 0.02 * mxp, f"{h:.1f}", ha="center", fontsize=10)

    plt.tight_layout()
    plt.savefig(out / "sim_batch_mae_travel_pricing.png", dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Wrote {out / 'sim_batch_mae_travel_pricing.png'}")


def plot_notebook_vs_batch(data: dict, out: Path) -> None:
    import matplotlib.pyplot as plt
    import numpy as np

    comp = data.get("comparison") or {}
    nb_ml_t = comp.get("notebook_travel_mae_ml")
    nb_bs_t = comp.get("notebook_travel_mae_baseline")
    sim_ml_t = comp.get("this_batch_travel_mae_ml")
    sim_nv_t = comp.get("this_batch_travel_mae_naive_vs_osrm")

    nb_ml_p = comp.get("notebook_pricing_mae_ml")
    nb_bs_p = comp.get("notebook_pricing_mae_baseline")
    sim_ml_p = comp.get("this_batch_price_mae_ml")
    sim_bs_p = comp.get("this_batch_price_mae_dist_baseline")

    fig, axes = plt.subplots(1, 2, figsize=(11, 4.2))
    x = np.arange(4)
    w = 0.38

    travel_vals = [nb_ml_t, nb_bs_t, sim_ml_t, sim_nv_t]
    travel_labels = ["Notebook\nML", "Notebook\nnaive†", "Sim\nML", "Sim\nnaive‡"]
    if all(v is not None for v in travel_vals):
        colors = ["#3498db", "#3498db", "#e67e22", "#e67e22"]
        bars = axes[0].bar(x, travel_vals, color=colors, edgecolor="black", width=0.65)
        axes[0].set_xticks(x)
        axes[0].set_xticklabels(travel_labels, fontsize=8)
        axes[0].set_ylabel("MAE (minutes)")
        axes[0].set_title("Travel — notebook vs simulation batch")
        for b, v in zip(bars, travel_vals):
            axes[0].text(b.get_x() + b.get_width() / 2, v + max(travel_vals) * 0.02, f"{v:.2f}", ha="center", fontsize=9)
        axes[0].text(
            0.5,
            -0.22,
            "† Notebook: naive vs CSV labels. ‡ Sim: 25 km/h vs OSRM.",
            transform=axes[0].transAxes,
            fontsize=7,
            color="#555",
            ha="center",
        )

    price_vals = [nb_ml_p, nb_bs_p, sim_ml_p, sim_bs_p]
    price_labels = ["Notebook\nML", "Notebook\ndist base", "Sim\nML", "Sim\ndist base"]
    if all(v is not None for v in price_vals):
        colors_p = ["#3498db", "#3498db", "#e67e22", "#e67e22"]
        bars_p = axes[1].bar(x, price_vals, color=colors_p, edgecolor="black", width=0.65)
        axes[1].set_xticks(x)
        axes[1].set_xticklabels(price_labels, fontsize=8)
        axes[1].set_ylabel("MAE (INR)")
        axes[1].set_title("Pricing — notebook vs simulation batch")
        mxp = max(price_vals)
        for b, v in zip(bars_p, price_vals):
            axes[1].text(b.get_x() + b.get_width() / 2, v + 0.02 * mxp, f"{v:.1f}", ha="center", fontsize=8)
        axes[1].text(
            0.5,
            -0.2,
            "Notebook: vs CSV. Sim: vs synthetic formula (ml/01_data_generation).",
            transform=axes[1].transAxes,
            fontsize=7,
            color="#555",
            ha="center",
        )

    plt.suptitle("MAE context: scales differ by evaluation target (see subtitles)", fontsize=10, y=1.03)
    plt.tight_layout()
    plt.savefig(out / "sim_notebook_vs_batch_mae.png", dpi=150, bbox_inches="tight")
    plt.close()
    print(f"Wrote {out / 'sim_notebook_vs_batch_mae.png'}")

    # Improvement % (batch travel vs naive; notebook from snapshot)
    snap = data.get("notebook_evaluation_snapshot") or {}
    tt_snap = snap.get("travel_time") or {}
    tt_batch = data.get("travel_time") or {}
    pr_snap = snap.get("pricing") or {}
    pr_batch = data.get("pricing") or {}

    imp_nb_t = tt_snap.get("improvement_pct")
    imp_sim_t = tt_batch.get("improvement_vs_naive_pct")
    imp_nb_p = pr_snap.get("improvement_pct")
    imp_sim_p = pr_batch.get("improvement_vs_distance_baseline_pct")

    if imp_nb_t is not None and imp_sim_t is not None:
        fig2, ax = plt.subplots(figsize=(6.5, 4))
        cats = ["Travel\n(% vs baseline)"]
        nb_vals = [imp_nb_t]
        sim_vals = [imp_sim_t]
        if imp_nb_p is not None and imp_sim_p is not None:
            cats.append("Pricing\n(% vs baseline)")
            nb_vals.append(imp_nb_p)
            sim_vals.append(imp_sim_p)
        x2 = np.arange(len(cats))
        ax.bar(x2 - 0.2, nb_vals, 0.4, label="Notebook eval", color="#3498db", edgecolor="black")
        ax.bar(x2 + 0.2, sim_vals, 0.4, label="Simulation batch", color="#e67e22", edgecolor="black")
        ax.axhline(0, color="black", linewidth=0.8)
        ax.set_xticks(x2)
        ax.set_xticklabels(cats, fontsize=9)
        ax.set_ylabel("Improvement vs baseline (%)")
        ax.legend()
        ax.set_title("ML improvement vs baseline (separate labels per pipeline)")
        plt.tight_layout()
        plt.savefig(out / "sim_improvement_notebook_vs_batch.png", dpi=150, bbox_inches="tight")
        plt.close()
        print(f"Wrote {out / 'sim_improvement_notebook_vs_batch.png'}")


def main() -> None:
    try:
        import matplotlib  # noqa: F401
    except ImportError:
        sys.exit("matplotlib is required (pip install -r requirements.txt)")

    parser = argparse.ArgumentParser(description="Plot simulation batch results (like docs/charts from 03_evaluation).")
    parser.add_argument(
        "run_json",
        nargs="?",
        default=None,
        help="Path to simulation_performance/run_*.json (default: latest from latest_summary.json)",
    )
    args = parser.parse_args()

    run_path = resolve_run_path(args.run_json)
    data = _load_json(run_path)
    rows = data.get("rows") or []

    CHARTS_DIR.mkdir(parents=True, exist_ok=True)

    plot_travel(rows, CHARTS_DIR)
    plot_pricing(rows, CHARTS_DIR)
    plot_batch_mae_bars(data, CHARTS_DIR)
    plot_notebook_vs_batch(data, CHARTS_DIR)


if __name__ == "__main__":
    main()
