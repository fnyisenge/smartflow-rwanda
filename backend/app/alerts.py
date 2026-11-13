"""Alerts (FR 5.1, FR 10) and signal recommendations (FR 5, NFR 6)."""
from sqlmodel import Session, select

from .models import (CongestionEvent, RoadNode, RoadSegment, Severity, SignalRecommendation,
                     TrafficAlert)
from .processing import THRESHOLDS


def sync_alerts(session: Session) -> None:
    open_events = session.exec(
        select(CongestionEvent).where(CongestionEvent.end_time == None)  # noqa: E711
    ).all()
    for ev in open_events:
        seg = session.get(RoadSegment, ev.segment_id)
        if not session.exec(select(TrafficAlert).where(TrafficAlert.event_id == ev.id)).first():
            session.add(TrafficAlert(
                kind="DETECTED", segment_id=ev.segment_id, severity=ev.severity, event_id=ev.id,
                message=f"{ev.severity.value.title()} congestion on {seg.name}",
            ))
        if ev.severity == Severity.SEVERE:
            if not session.exec(select(SignalRecommendation).where(SignalRecommendation.event_id == ev.id)).first():
                node = session.get(RoadNode, seg.to_node)
                session.add(SignalRecommendation(
                    event_id=ev.id, segment_id=seg.id, node_id=node.id,
                    suggested_plan=f"Extend the green phase for traffic heading to {node.name} by about 15 seconds",
                    reason=(f"Severe congestion on {seg.name}: average speed below "
                            f"{round(THRESHOLDS['severe'] * 100)}% of the speed limit"),
                ))
