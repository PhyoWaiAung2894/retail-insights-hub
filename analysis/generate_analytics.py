#!/usr/bin/env python3
"""
Retail analytics pipeline for the UCI Online Retail dataset.

This script downloads the public UCI Online Retail dataset, cleans it,
computes KPIs (CLV, MRR, RFM, product churn), and writes the JSON
handoff consumed by the dashboard at public/data/analytics.json.

Usage:
    python analysis/generate_analytics.py
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

UCI_XLSX_URL = (
    "https://archive.ics.uci.edu/ml/machine-learning-databases/00352/Online%20Retail.xlsx"
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = PROJECT_ROOT / "analysis" / ".cache"
RAW_DATA_PATH = CACHE_DIR / "raw_online_retail.xlsx"
OUTPUT_JSON_PATH = PROJECT_ROOT / "public" / "data" / "analytics.json"
OUTPUT_CSV_PATH = CACHE_DIR / "online_retail_clean.csv"
OUTPUT_REPORT_PATH = CACHE_DIR / "report.html"

np.random.seed(42)


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------


def download_dataset() -> pd.DataFrame:
    """Download the UCI Online Retail dataset to analysis/ and return it as a DataFrame."""
    RAW_DATA_PATH.parent.mkdir(parents=True, exist_ok=True)

    if not RAW_DATA_PATH.exists():
        print(f"Downloading dataset from {UCI_XLSX_URL} ...")
        response = requests.get(UCI_XLSX_URL, timeout=120)
        response.raise_for_status()
        RAW_DATA_PATH.write_bytes(response.content)
        print(f"Saved raw dataset to {RAW_DATA_PATH}")

    return pd.read_excel(RAW_DATA_PATH, engine="openpyxl")


# ---------------------------------------------------------------------------
# Cleaning
# ---------------------------------------------------------------------------


def clean_data(df: pd.DataFrame) -> pd.DataFrame:
    """Remove nulls, cancellations, negatives, and duplicates."""
    raw_rows = len(df)

    df = df.copy()
    df = df.dropna(subset=["CustomerID", "Description", "InvoiceNo", "Quantity", "UnitPrice"])
    df = df[~df["InvoiceNo"].astype(str).str.startswith("C", na=False)]
    df = df[(df["Quantity"] > 0) & (df["UnitPrice"] > 0)]
    df = df.drop_duplicates()

    df["CustomerID"] = df["CustomerID"].astype(int)
    df["InvoiceDate"] = pd.to_datetime(df["InvoiceDate"])
    df["Revenue"] = df["Quantity"] * df["UnitPrice"]

    clean_rows = len(df)
    return df, raw_rows, clean_rows


# ---------------------------------------------------------------------------
# KPIs
# ---------------------------------------------------------------------------


def compute_kpis(df: pd.DataFrame, raw_rows: int, clean_rows: int) -> dict[str, Any]:
    """Compute portfolio-level KPIs."""
    total_revenue = float(df["Revenue"].sum())
    total_orders = int(df["InvoiceNo"].nunique())
    total_customers = int(df["CustomerID"].nunique())
    total_products = int(df["StockCode"].nunique())
    aov = total_revenue / total_orders if total_orders else 0.0

    customer_summary = (
        df.groupby("CustomerID")
        .agg(Orders=("InvoiceNo", "nunique"), Spend=("Revenue", "sum"))
        .reset_index()
    )
    avg_clv = float(customer_summary["Spend"].mean())
    median_clv = float(customer_summary["Spend"].median())
    avg_orders_per_customer = float(customer_summary["Orders"].mean())

    snapshot_date = df["InvoiceDate"].max()
    churn_threshold = snapshot_date - timedelta(days=90)
    last_purchase = df.groupby("CustomerID")["InvoiceDate"].max()
    churn_rate = float((last_purchase < churn_threshold).mean())

    return {
        "total_revenue": round(total_revenue, 2),
        "total_orders": total_orders,
        "total_customers": total_customers,
        "total_products": total_products,
        "aov": round(aov, 2),
        "avg_orders_per_customer": round(avg_orders_per_customer, 2),
        "avg_clv": round(avg_clv, 2),
        "median_clv": round(median_clv, 2),
        "churn_rate": round(churn_rate, 4),
        "snapshot_date": snapshot_date.strftime("%Y-%m-%d"),
        "raw_rows": raw_rows,
        "clean_rows": clean_rows,
    }


# ---------------------------------------------------------------------------
# Monthly metrics
# ---------------------------------------------------------------------------


def compute_monthly(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Monthly revenue, orders, active customers, and new vs returning split."""
    df = df.copy()
    df["Month"] = df["InvoiceDate"].dt.to_period("M")

    first_purchase = df.groupby("CustomerID")["InvoiceDate"].min().dt.to_period("M")

    monthly = []
    for period, group in df.groupby("Month"):
        customers = set(group["CustomerID"].unique())
        new_customers = sum(1 for c in customers if first_purchase[c] == period)
        returning_customers = len(customers) - new_customers
        monthly.append(
            {
                "month": str(period),
                "revenue": round(float(group["Revenue"].sum()), 2),
                "orders": int(group["InvoiceNo"].nunique()),
                "customers": int(group["CustomerID"].nunique()),
                "new_customers": new_customers,
                "returning_customers": returning_customers,
            }
        )

    return sorted(monthly, key=lambda x: x["month"])


# ---------------------------------------------------------------------------
# RFM segmentation
# ---------------------------------------------------------------------------


def rfm_segment(score_r: int, score_f: int, score_m: int) -> str:
    """Map RFM quintiles to a business segment."""
    # Champions: high R, F, M
    if score_r >= 4 and score_f >= 4 and score_m >= 4:
        return "Champions"
    # Loyal: high F and M but not necessarily very recent
    if score_f >= 4 and score_m >= 3:
        return "Loyal"
    # Potential: recent but low frequency/monetary
    if score_r >= 4 and (score_f <= 2 or score_m <= 2):
        return "Potential"
    # At Risk: were valuable but not recent
    if (score_f >= 3 or score_m >= 3) and score_r <= 2:
        return "At Risk"
    # Lost: low across the board
    return "Lost"


def compute_segments(df: pd.DataFrame, snapshot_date: datetime) -> list[dict[str, Any]]:
    """Compute RFM segments with customer counts and revenue."""
    rfm = (
        df.groupby("CustomerID")
        .agg(
            LastPurchase=("InvoiceDate", "max"),
            Orders=("InvoiceNo", "nunique"),
            Spend=("Revenue", "sum"),
        )
        .reset_index()
    )

    rfm["RecencyDays"] = (snapshot_date - rfm["LastPurchase"]).dt.days
    rfm["R"] = pd.qcut(rfm["RecencyDays"].rank(method="first"), 5, labels=[5, 4, 3, 2, 1]).astype(int)
    rfm["F"] = pd.qcut(rfm["Orders"].rank(method="first"), 5, labels=[1, 2, 3, 4, 5]).astype(int)
    rfm["M"] = pd.qcut(rfm["Spend"].rank(method="first"), 5, labels=[1, 2, 3, 4, 5]).astype(int)
    rfm["Segment"] = rfm.apply(lambda r: rfm_segment(r["R"], r["F"], r["M"]), axis=1)

    segments = (
        rfm.groupby("Segment")
        .agg(Customers=("CustomerID", "count"), Revenue=("Spend", "sum"))
        .reset_index()
    )
    segments = segments.sort_values("Revenue", ascending=False)
    return [
        {
            "segment": row["Segment"],
            "customers": int(row["Customers"]),
            "revenue": round(float(row["Revenue"]), 2),
        }
        for _, row in segments.iterrows()
    ]


# ---------------------------------------------------------------------------
# Top / declining / growing products
# ---------------------------------------------------------------------------


def compute_top_products(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Top products by total revenue."""
    products = (
        df.groupby(["StockCode", "Description"])
        .agg(Revenue=("Revenue", "sum"), Quantity=("Quantity", "sum"), Orders=("InvoiceNo", "nunique"))
        .reset_index()
        .sort_values("Revenue", ascending=False)
        .head(15)
    )
    return [
        {
            "code": row["StockCode"],
            "description": row["Description"],
            "revenue": round(float(row["Revenue"]), 2),
            "quantity": int(row["Quantity"]),
            "orders": int(row["Orders"]),
        }
        for _, row in products.iterrows()
    ]


def compute_product_changes(df: pd.DataFrame) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Compute month-over-month product growth/decline using the last 2 vs prior 2 months."""
    df = df.copy()
    df["Month"] = df["InvoiceDate"].dt.to_period("M")
    months = sorted(df["Month"].unique())
    if len(months) < 4:
        return [], []

    recent_months = months[-2:]
    prior_months = months[-4:-2]

    recent = df[df["Month"].isin(recent_months)]
    prior = df[df["Month"].isin(prior_months)]

    def revenue_by_product(data: pd.DataFrame) -> pd.Series:
        return data.groupby(["StockCode", "Description"])["Revenue"].sum()

    recent_rev = revenue_by_product(recent)
    prior_rev = revenue_by_product(prior)

    combined = pd.concat({"recent": recent_rev, "prior": prior_rev}, axis=1).fillna(0)
    combined = combined[combined["prior"] > 0]
    combined["change_pct"] = ((combined["recent"] - combined["prior"]) / combined["prior"]) * 100
    combined = combined.reset_index()

    declining = (
        combined.sort_values("change_pct", ascending=True)
        .head(10)
        .rename(columns={"prior": "prior_revenue", "recent": "recent_revenue"})
    )
    growing = (
        combined.sort_values("change_pct", ascending=False)
        .head(10)
        .rename(columns={"prior": "prior_revenue", "recent": "recent_revenue"})
    )

    def to_rows(frame: pd.DataFrame) -> list[dict[str, Any]]:
        return [
            {
                "code": row["StockCode"],
                "description": row["Description"],
                "change_pct": round(float(row["change_pct"]), 2),
                "prior_revenue": round(float(row["prior_revenue"]), 2),
            }
            for _, row in frame.iterrows()
        ]

    return to_rows(declining), to_rows(growing)


# ---------------------------------------------------------------------------
# Countries & CLV distribution
# ---------------------------------------------------------------------------


def compute_countries(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Top countries by revenue."""
    countries = (
        df.groupby("Country")
        .agg(Revenue=("Revenue", "sum"), Customers=("CustomerID", "nunique"), Orders=("InvoiceNo", "nunique"))
        .reset_index()
        .sort_values("Revenue", ascending=False)
        .head(10)
    )
    return [
        {
            "country": row["Country"],
            "revenue": round(float(row["Revenue"]), 2),
            "customers": int(row["Customers"]),
            "orders": int(row["Orders"]),
        }
        for _, row in countries.iterrows()
    ]


def compute_clv_distribution(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Histogram of customer lifetime values."""
    clv = df.groupby("CustomerID")["Revenue"].sum()
    bins = [0, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, float("inf")]
    labels = [
        "<£100",
        "£100-250",
        "£250-500",
        "£500-1k",
        "£1k-2.5k",
        "£2.5k-5k",
        "£5k-10k",
        "£10k-25k",
        ">£25k",
    ]
    counts = pd.cut(clv, bins=bins, labels=labels, right=False).value_counts().sort_index()
    return [{"bucket": str(bucket), "count": int(count)} for bucket, count in counts.items()]


# ---------------------------------------------------------------------------
# HTML report export
# ---------------------------------------------------------------------------


def build_report(data: dict[str, Any]) -> str:
    """Build a simple standalone HTML report from the analytics JSON."""
    k = data["kpis"]
    rows = [
        ("Total Revenue", f"£{k['total_revenue']:,.2f}"),
        ("Total Orders", f"{k['total_orders']:,}"),
        ("Total Customers", f"{k['total_customers']:,}"),
        ("Average Order Value", f"£{k['aov']:,.2f}"),
        ("Average CLV", f"£{k['avg_clv']:,.2f}"),
        ("Median CLV", f"£{k['median_clv']:,.2f}"),
        ("90-day Churn Rate", f"{k['churn_rate'] * 100:.1f}%"),
        ("Raw → Clean Rows", f"{k['raw_rows']:,} → {k['clean_rows']:,}"),
    ]
    rows_html = "".join(f"<tr><td>{label}</td><td>{value}</td></tr>" for label, value in rows)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Retail Analytics Report</title>
  <style>
    body {{ font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }}
    table {{ border-collapse: collapse; width: 100%; margin: 1rem 0; }}
    th, td {{ border: 1px solid #ddd; padding: 0.5rem; text-align: left; }}
    th {{ background: #f4f4f4; }}
    h1 {{ font-size: 1.5rem; }}
    small {{ color: #666; }}
  </style>
</head>
<body>
  <h1>Retail Analytics Report</h1>
  <p><small>UCI Online Retail · snapshot {k['snapshot_date']}</small></p>
  <table>
    <thead><tr><th>Metric</th><th>Value</th></tr></thead>
    <tbody>{rows_html}</tbody>
  </table>
  <p>Generated by <code>analysis/generate_analytics.py</code>.</p>
</body>
</html>"""


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    print("Loading UCI Online Retail dataset...")
    df = download_dataset()

    print("Cleaning data...")
    df, raw_rows, clean_rows = clean_data(df)

    print("Computing KPIs...")
    kpis = compute_kpis(df, raw_rows, clean_rows)
    snapshot_date = pd.to_datetime(kpis["snapshot_date"])

    print("Computing monthly, RFM, product, and country metrics...")
    monthly = compute_monthly(df)
    segments = compute_segments(df, snapshot_date)
    top_products = compute_top_products(df)
    declining_products, growing_products = compute_product_changes(df)
    countries = compute_countries(df)
    clv_distribution = compute_clv_distribution(df)

    analytics = {
        "kpis": kpis,
        "monthly": monthly,
        "segments": segments,
        "top_products": top_products,
        "declining_products": declining_products,
        "growing_products": growing_products,
        "countries": countries,
        "clv_distribution": clv_distribution,
    }

    OUTPUT_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_JSON_PATH.open("w", encoding="utf-8") as f:
        json.dump(analytics, f, indent=2)
    print(f"Wrote dashboard data to {OUTPUT_JSON_PATH}")

    OUTPUT_CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUTPUT_CSV_PATH, index=False)
    print(f"Wrote cleaned CSV to {OUTPUT_CSV_PATH}")

    with OUTPUT_REPORT_PATH.open("w", encoding="utf-8") as f:
        f.write(build_report(analytics))
    print(f"Wrote HTML report to {OUTPUT_REPORT_PATH}")


if __name__ == "__main__":
    main()
