"""Kigali traffic simulator.

Real-time traffic feeds for Kigali are limited, so the prototype generates
realistic readings instead: morning and evening rush hours, busier roads,
random incidents, and the occasional broken record (to test validation).
It sends data through the same ingest() pipeline a real source would use.
"""
import asyncio
import math
import random
from datetime import datetime, timedelta, timezone

from sqlmodel import Session, select

from .database import engine
from .models import DataSource, RoadSegment
from .processing import ingest

TICK_SECONDS = 5
KIGALI_TZ = timezone(timedelta(hours=2))

state = {
    "running": True,
    "hour_override": None,   # set e.g. 8 to demo morning rush at any time of day
    "incidents": {},         # segment_id -> {"until": datetime, "strength": float}
}


def current_hour() -> float:
    if state["hour_override"] is not None:
        return float(state["hour_override"])
    now = datetime.now(KIGALI_TZ)
    return now.hour + now.minute / 60


def demand(hour: float) -> float:
    """0..1 traffic demand: low at night, peaks at ~7:30 and ~17:45."""
    morning = 0.65 * math.exp(-((hour - 7.5) ** 2) / (2 * 0.8 ** 2))
    evening = 0.70 * math.exp(-((hour - 17.75) ** 2) / (2 * 1.0 ** 2))
    midday = 0.20 * math.exp(-((hour - 13.0) ** 2) / (2 * 2.0 ** 2))
    night_low = 0.08 if 5 <= hour <= 22 else 0.02
    return min(1.0, night_low + morning + evening + midday)


def generate_reading(segment: RoadSegment, source_ids: list[int], now: datetime) -> dict:
    d = demand(current_hour()) * segment.busyness

    incident = state["incidents"].get(segment.id)
    if incident and incident["until"] < now:
        state["incidents"].pop(segment.id)
        incident = None
    if incident is None and random.random() < 0.0015:
        incident = {"until": now + timedelta(minutes=random.randint(3, 8)),
                    "strength": random.uniform(0.4, 0.7)}
        state["incidents"][segment.id] = incident
    if incident:
        d += incident["strength"]

    load = max(0.0, min(1.2, d + random.gauss(0, 0.05)))
    speed = segment.speed_limit_kmh * max(0.10, 1 - 0.70 * load)
    density = 15 + 110 * min(load, 1.0)

    reading = {
        "segment_id": segment.id,
        "source_id": random.choice(source_ids),
        "speed_kmh": round(speed, 1),
        "vehicle_density": round(density, 1),
    }

    # ~3% of records are broken, to show validation working (FR 1.2)
    if random.random() < 0.03:
        fault = random.choice(["missing_speed", "negative_speed", "absurd_density"])
        if fault == "missing_speed":
            reading["speed_kmh"] = None
        elif fault == "negative_speed":
            reading["speed_kmh"] = -12.0
        else:
            reading["vehicle_density"] = 999.0
    return reading


def tick() -> None:
    now = datetime.now(timezone.utc)
    with Session(engine) as session:
        segments = session.exec(select(RoadSegment)).all()
        source_ids = [s.id for s in session.exec(select(DataSource).where(DataSource.is_active)).all()]
        if not source_ids:
            return
        for segment in segments:
            ingest(generate_reading(segment, source_ids, now), session)
        session.commit()


async def run_forever() -> None:
    while True:
        if state["running"]:
            try:
                await asyncio.to_thread(tick)
            except Exception as exc:  # keep the simulator alive (NFR 13)
                print(f"[simulator] tick failed: {exc}")
        await asyncio.sleep(TICK_SECONDS)
