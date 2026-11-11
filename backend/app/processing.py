"""Data validation (FR 1.2) and congestion detection (FR 3.1).

Every incoming reading goes through ingest():
    validate -> store (or log rejection) -> update congestion events
"""
import json
from datetime import datetime

from sqlmodel import Session, desc, select

from .models import (CongestionEvent, DataSource, RejectedReading, RoadSegment,
                     Severity, TrafficReading, as_utc, utcnow)

# Configurable congestion thresholds (ratio of current speed to speed limit).
# Admins will be able to change these in a later sprint.
THRESHOLDS = {"moderate": 0.60, "severe": 0.35}

# Readings older than this are flagged as outdated (NFR 7).
STALE_AFTER_SECONDS = 30

SMOOTHING_WINDOW = 3  # average the last N readings so colours don't flicker


def validate(raw: dict, session: Session) -> tuple[bool, str]:
    required = ("segment_id", "source_id", "speed_kmh", "vehicle_density")
    for key in required:
        if raw.get(key) is None:
            return False, f"Missing field: {key}"
    if not session.get(RoadSegment, raw["segment_id"]):
        return False, f"Unknown road segment: {raw['segment_id']}"
    if not session.get(DataSource, raw["source_id"]):
        return False, f"Unknown data source: {raw['source_id']}"
    speed, density = raw["speed_kmh"], raw["vehicle_density"]
    if not isinstance(speed, (int, float)) or not 0 <= speed <= 150:
        return False, f"Speed out of range: {speed}"
    if not isinstance(density, (int, float)) or not 0 <= density <= 300:
        return False, f"Vehicle density out of range: {density}"
    return True, ""


def classify(ratio: float) -> Severity:
    if ratio < THRESHOLDS["severe"]:
        return Severity.SEVERE
    if ratio < THRESHOLDS["moderate"]:
        return Severity.MODERATE
    return Severity.NORMAL


def smoothed_speed(session: Session, segment_id: str) -> tuple[float | None, datetime | None]:
    rows = session.exec(
        select(TrafficReading)
        .where(TrafficReading.segment_id == segment_id)
        .order_by(desc(TrafficReading.timestamp))
        .limit(SMOOTHING_WINDOW)
    ).all()
    if not rows:
        return None, None
    return sum(r.speed_kmh for r in rows) / len(rows), as_utc(rows[0].timestamp)


def update_congestion(session: Session, segment: RoadSegment) -> None:
    speed, _ = smoothed_speed(session, segment.id)
    if speed is None:
        return
    severity = classify(speed / segment.speed_limit_kmh)
    open_event = session.exec(
        select(CongestionEvent)
        .where(CongestionEvent.segment_id == segment.id, CongestionEvent.end_time == None)  # noqa: E711
    ).first()

    if severity == Severity.NORMAL:
        if open_event:
            open_event.end_time = utcnow()  # congestion cleared
            session.add(open_event)
    elif open_event is None:
        threshold = THRESHOLDS["severe" if severity == Severity.SEVERE else "moderate"]
        session.add(CongestionEvent(segment_id=segment.id, severity=severity,
                                    threshold_used=threshold))
    elif open_event.severity != severity:
        open_event.severity = severity
        session.add(open_event)


def ingest(raw: dict, session: Session) -> bool:
    ok, reason = validate(raw, session)
    if not ok:
        session.add(RejectedReading(raw_data=json.dumps(raw, default=str), reason=reason))
        return False

    session.add(TrafficReading(
        segment_id=raw["segment_id"], source_id=raw["source_id"],
        speed_kmh=float(raw["speed_kmh"]), vehicle_density=float(raw["vehicle_density"]),
    ))
    source = session.get(DataSource, raw["source_id"])
    source.last_received = utcnow()
    session.add(source)
    session.flush()  # so the new reading is visible to the smoothing query
    update_congestion(session, session.get(RoadSegment, raw["segment_id"]))
    return True
