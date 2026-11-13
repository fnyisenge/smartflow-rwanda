"""AI congestion prediction (FR 3.2) and accuracy tracking (NFR 19).

A random-forest model is trained on simulated traffic history (SRS assumption 6).
It predicts the speed ratio (speed / speed limit) of a road up to 60 minutes ahead,
using the time of day, how busy the road usually is, and its current speed.
Each stored prediction is later compared with what actually happened.
"""
import math
import random
from datetime import timedelta

import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sqlmodel import Session, select

from . import simulator
from .models import CongestionPrediction, RoadSegment, Severity, TrafficAlert, as_utc, utcnow
from .processing import classify, smoothed_speed

HORIZONS = (15, 30)
MODEL_VERSION = "random-forest-v1"
_model = None
_info: dict = {}


def _features(now_hour: float, busyness: float, ratio_now: float, horizon_min: float) -> list[float]:
    target = (now_hour + horizon_min / 60) % 24
    a = 2 * math.pi * now_hour / 24
    b = 2 * math.pi * target / 24
    return [math.sin(a), math.cos(a), math.sin(b), math.cos(b), busyness, ratio_now, horizon_min / 60]


def train_model() -> None:
    global _model, _info
    rng = random.Random(42)
    X, y = [], []
    for _ in range(8000):
        hour = rng.uniform(0, 24)
        busy = rng.uniform(0.7, 1.5)
        horizon = rng.uniform(0, 60)
        ratio_now = simulator.speed_ratio(hour, busy, rng.gauss(0, 0.05))
        ratio_future = simulator.speed_ratio(hour + horizon / 60, busy, rng.gauss(0, 0.05))
        X.append(_features(hour, busy, ratio_now, horizon))
        y.append(ratio_future)
    X, y = np.array(X), np.array(y)
    split = 7000
    model = RandomForestRegressor(n_estimators=60, max_depth=12, min_samples_leaf=5,
                                  random_state=42, n_jobs=1)
    model.fit(X[:split], y[:split])
    test_mae = float(np.mean(np.abs(model.predict(X[split:]) - y[split:])))
    _model = model
    _info = {"trained_on": split, "test_mae_ratio": round(test_mae, 3), "data": "simulated traffic history"}


def ensure_model():
    if _model is None:
        train_model()
    return _model


def predict_ratios(session: Session, horizon_min: int) -> dict:
    """{segment_id: {"ratio", "speed_kmh", "severity"}} for 'horizon_min' minutes from now."""
    model = ensure_model()
    hour = simulator.current_hour()
    rows, segments = [], []
    for seg in session.exec(select(RoadSegment)).all():
        speed, _ = smoothed_speed(session, seg.id)
        if speed is None:
            continue
        ratio_now = min(1.0, speed / seg.speed_limit_kmh)
        rows.append(_features(hour, seg.busyness, ratio_now, horizon_min))
        segments.append(seg)
    if not rows:
        return {}
    out = {}
    for seg, p in zip(segments, model.predict(np.array(rows))):
        p = float(min(1.0, max(0.05, p)))
        out[seg.id] = {"ratio": p, "speed_kmh": p * seg.speed_limit_kmh, "severity": classify(p)}
    return out


def store_predictions(session: Session) -> None:
    now = utcnow()
    speed_factor = simulator.current_speed()
    for horizon in HORIZONS:
        for seg_id, p in predict_ratios(session, horizon).items():
            session.add(CongestionPrediction(
                segment_id=seg_id, horizon_min=horizon, created_at=now,
                due_at=now + timedelta(seconds=horizon * 60 / speed_factor),
                predicted_ratio=round(p["ratio"], 3), predicted_severity=p["severity"],
            ))
            if horizon == 15 and p["severity"] != Severity.NORMAL:
                _early_warning(session, seg_id, p, now)


def _early_warning(session: Session, seg_id: str, p: dict, now) -> None:
    seg = session.get(RoadSegment, seg_id)
    speed, _ = smoothed_speed(session, seg_id)
    if speed is None or classify(speed / seg.speed_limit_kmh) != Severity.NORMAL:
        return  # only warn when the road is flowing now but expected to slow down
    recent = session.exec(
        select(TrafficAlert).where(TrafficAlert.segment_id == seg_id,
                                   TrafficAlert.kind == "PREDICTED",
                                   TrafficAlert.created_at >= now - timedelta(minutes=15))
    ).first()
    if recent:
        return
    session.add(TrafficAlert(
        kind="PREDICTED", segment_id=seg_id, severity=p["severity"],
        message=f"Congestion predicted on {seg.name} in about 15 min (expected {round(p['speed_kmh'])} km/h)",
    ))


def evaluate_due(session: Session) -> None:
    """Compare predictions whose time has come with what actually happened."""
    due = session.exec(
        select(CongestionPrediction)
        .where(CongestionPrediction.evaluated == False, CongestionPrediction.due_at <= utcnow())  # noqa: E712
        .limit(200)
    ).all()
    segments: dict = {}
    for pred in due:
        seg = segments.get(pred.segment_id) or session.get(RoadSegment, pred.segment_id)
        segments[pred.segment_id] = seg
        speed, _ = smoothed_speed(session, pred.segment_id)
        if speed is None:
            continue
        ratio = min(1.0, speed / seg.speed_limit_kmh)
        severity = classify(ratio)
        pred.actual_ratio = round(ratio, 3)
        pred.actual_severity = severity
        pred.was_accurate = severity == pred.predicted_severity
        pred.evaluated = True
        session.add(pred)


def accuracy_summary(session: Session) -> dict:
    rows = session.exec(
        select(CongestionPrediction).where(CongestionPrediction.evaluated == True)  # noqa: E712
    ).all()

    def stats(items):
        n = len(items)
        if n == 0:
            return {"evaluated": 0, "accuracy_pct": None, "mae_ratio": None}
        accuracy = sum(1 for r in items if r.was_accurate) / n * 100
        mae = sum(abs(r.predicted_ratio - r.actual_ratio) for r in items) / n
        return {"evaluated": n, "accuracy_pct": round(accuracy, 1), "mae_ratio": round(mae, 3)}

    return {
        "model_version": MODEL_VERSION,
        "model_info": _info,
        "overall": stats(rows),
        "by_horizon": [{"horizon_min": h, **stats([r for r in rows if r.horizon_min == h])} for h in HORIZONS],
    }
