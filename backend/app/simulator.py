"""Kigali traffic simulator.

Generates realistic readings (rush hours, incidents, a few broken records) and sends
them through the same ingest() pipeline a real data source would use.
Demo clock: you can jump to any hour and speed time up (60x = 1 real second is 1 simulated minute).
"""
import asyncio
import math
import random
import time
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from .database import engine
from .models import DataSource, RoadSegment, utcnow
from .processing import ingest

TICK_SECONDS = 5
KIGALI_TZ = timezone(timedelta(hours=2))

state = {
    "running": True,
    "mode": "real",        # "real" = Kigali clock, "demo" = chosen hour
    "anchor_real": 0.0,
    "anchor_hour": 0.0,
    "speed": 1.0,          # 1 = real time, 60 = 1 real second is 1 simulated minute
    "incidents": {},       # segment_id -> {"until": datetime, "strength": float}
    "ticks": 0,
}


def current_hour() -> float:
    if state["mode"] == "real":
        now = datetime.now(KIGALI_TZ)
        return now.hour + now.minute / 60 + now.second / 3600
    elapsed_hours = (time.time() - state["anchor_real"]) / 3600 * state["speed"]
    return (state["anchor_hour"] + elapsed_hours) % 24


def current_speed() -> float:
    return 1.0 if state["mode"] == "real" else state["speed"]


def set_clock(hour: float, speed: float = 1.0) -> None:
    state.update(mode="demo", anchor_real=time.time(), anchor_hour=hour, speed=speed)


def use_real_time() -> None:
    state["mode"] = "real"


def demand(hour: float) -> float:
    """0..1 traffic demand: low at night, peaks at ~7:30 and ~17:45."""
    hour = hour % 24
    morning = 0.65 * math.exp(-((hour - 7.5) ** 2) / (2 * 0.8 ** 2))
    evening = 0.70 * math.exp(-((hour - 17.75) ** 2) / (2 * 1.0 ** 2))
    midday = 0.20 * math.exp(-((hour - 13.0) ** 2) / (2 * 2.0 ** 2))
    night_low = 0.08 if 5 <= hour <= 22 else 0.02
    return min(1.0, night_low + morning + evening + midday)


def load_for(hour: float, busyness: float, extra: float = 0.0, noise: float = 0.0) -> float:
    return max(0.0, min(1.2, demand(hour) * busyness + extra + noise))


def speed_ratio(hour: float, busyness: float, noise: float = 0.0, extra: float = 0.0) -> float:
    """Speed as a fraction of the speed limit. Also used to build the AI training data."""
    return max(0.10, 1 - 0.70 * load_for(hour, busyness, extra, noise))


def generate_reading(segment: RoadSegment, source_ids: list[int], now: datetime) -> dict:
    incident = state["incidents"].get(segment.id)
    if incident and incident["until"] < now:
        state["incidents"].pop(segment.id, None)
        incident = None
    if incident is None and random.random() < 0.0015:
        incident = {"until": now + timedelta(minutes=random.randint(3, 8)),
                    "strength": random.uniform(0.4, 0.7)}
        state["incidents"][segment.id] = incident
    extra = incident["strength"] if incident else 0.0

    load = load_for(current_hour(), segment.busyness, extra, random.gauss(0, 0.05))
    speed = segment.speed_limit_kmh * max(0.10, 1 - 0.70 * load)
    density = 15 + 110 * min(load, 1.0)

    reading = {
        "segment_id": segment.id,
        "source_id": random.choice(source_ids),
        "speed_kmh": round(speed, 1),
        "vehicle_density": round(density, 1),
    }
    if random.random() < 0.03:  # ~3% broken records to show validation (FR 1.2)
        fault = random.choice(["missing_speed", "negative_speed", "absurd_density"])
        if fault == "missing_speed":
            reading["speed_kmh"] = None
        elif fault == "negative_speed":
            reading["speed_kmh"] = -12.0
        else:
            reading["vehicle_density"] = 999.0
    return reading


def tick() -> None:
    from . import alerts, prediction  # imported here to avoid circular imports

    now = utcnow()
    with Session(engine) as session:
        segments = session.exec(select(RoadSegment)).all()
        source_ids = [s.id for s in session.exec(select(DataSource).where(DataSource.is_active)).all()]
        if not source_ids:
            return
        for segment in segments:
            ingest(generate_reading(segment, source_ids, now), session)
        session.commit()

        state["ticks"] += 1
        alerts.sync_alerts(session)
        prediction.evaluate_due(session)
        if state["ticks"] % 6 == 1:  # store predictions about every 30 seconds
            prediction.store_predictions(session)
        session.commit()


async def run_forever() -> None:
    while True:
        if state["running"]:
            try:
                await asyncio.to_thread(tick)
            except Exception as exc:  # keep the simulator alive (NFR 13)
                print(f"[simulator] tick failed: {exc}")
        await asyncio.sleep(TICK_SECONDS)
