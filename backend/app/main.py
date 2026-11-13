"""SmartFlow Rwanda API.

Run from the backend folder:  python -m uvicorn app.main:app --reload
Interactive API docs:          http://localhost:8000/docs
"""
import asyncio
from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import Session, desc, select

from . import prediction, routing, simulator
from .auth import create_token, get_current_user, require_roles, verify_password
from .database import engine, get_session, init_db
from .models import (AuditLog, CongestionEvent, DataSource, EmergencyRequest, Incident,
                     IncidentStatus, ManagementAction, RejectedReading, ReviewStatus, RoadNode,
                     RoadSegment, RoleType, Severity, SignalRecommendation, TrafficAlert,
                     TrafficReading, User, as_utc, utcnow)
from .processing import STALE_AFTER_SECONDS, THRESHOLDS, classify, smoothed_speed
from .seed import seed

STAFF = (RoleType.OFFICER, RoleType.ADMIN)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with Session(engine) as session:
        seed(session)
    prediction.train_model()
    for _ in range(3):
        simulator.tick()  # warm up so the map has data immediately
    task = asyncio.create_task(simulator.run_forever())
    yield
    task.cancel()


app = FastAPI(title="SmartFlow Rwanda API", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- helpers ----------
def iso(dt):
    return as_utc(dt).isoformat() if dt else None


def audit(session: Session, user: User | None, action: str, details: str = "") -> None:
    session.add(AuditLog(user_id=user.id if user else None, action=action, details=details))


def log_action(session: Session, user: User, action_type: str, notes: str, segment_id: str | None = None) -> None:
    """Record an officer action (FR 5.2) and mirror it in the audit log (NFR 12)."""
    session.add(ManagementAction(user_id=user.id, action_type=action_type, notes=notes, segment_id=segment_id))
    audit(session, user, action_type, notes)


def network(session: Session):
    nodes = {n.id: n for n in session.exec(select(RoadNode)).all()}
    segs = {s.id: s for s in session.exec(select(RoadSegment)).all()}
    return nodes, segs


# ---------- Health & auth (FR 8) ----------
@app.get("/api/health")
def health():
    return {"status": "ok", "simulator_running": simulator.state["running"]}


class LoginRequest(BaseModel):
    email: str
    password: str


@app.post("/api/auth/login")
def login(body: LoginRequest, session: Session = Depends(get_session)):
    user = session.exec(select(User).where(User.email == body.email.lower().strip())).first()
    if not user or not verify_password(body.password, user.password_hash):
        audit(session, None, "LOGIN_FAILED", body.email)
        session.commit()
        raise HTTPException(401, "Wrong email or password")
    if not user.is_active:
        raise HTTPException(403, "This account has been deactivated")
    user.last_login = utcnow()
    audit(session, user, "LOGIN", user.email)
    session.add(user)
    session.commit()
    return {"token": create_token(user),
            "user": {"id": user.id, "name": user.name, "email": user.email, "role": user.role}}


@app.get("/api/auth/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "name": user.name, "email": user.email, "role": user.role}


# ---------- Live traffic (FR 2, FR 3.1, NFR 7) ----------
@app.get("/api/nodes")
def list_nodes(session: Session = Depends(get_session)):
    return [{"id": n.id, "name": n.name, "lat": n.lat, "lng": n.lng}
            for n in session.exec(select(RoadNode).order_by(RoadNode.name)).all()]


@app.get("/api/traffic/live")
def live_traffic(session: Session = Depends(get_session)):
    nodes, segs = network(session)
    now = utcnow()
    result = []
    for seg in segs.values():
        speed, last_ts = smoothed_speed(session, seg.id)
        age = (now - last_ts).total_seconds() if last_ts else None
        a, b = nodes[seg.from_node], nodes[seg.to_node]
        result.append({
            "id": seg.id, "name": seg.name, "corridor": seg.corridor,
            "coordinates": [[a.lat, a.lng], [b.lat, b.lng]],
            "length_km": seg.length_km, "speed_limit_kmh": seg.speed_limit_kmh,
            "speed_kmh": round(speed, 1) if speed is not None else None,
            "severity": classify(speed / seg.speed_limit_kmh) if speed is not None else None,
            "travel_time_min": round(seg.length_km / max(speed, 1) * 60, 1) if speed else None,
            "data_age_seconds": round(age) if age is not None else None,
            "is_stale": age is None or age > STALE_AFTER_SECONDS,
        })
    return {"generated_at": now.isoformat(), "thresholds": THRESHOLDS, "segments": result}


@app.get("/api/traffic/predicted")
def predicted_traffic(horizon: int = Query(15, ge=0, le=60), session: Session = Depends(get_session)):
    """AI forecast for every road, 'horizon' minutes ahead (FR 3.2)."""
    _, segs = network(session)
    preds = prediction.predict_ratios(session, horizon)
    return {
        "horizon_min": horizon,
        "model_version": prediction.MODEL_VERSION,
        "segments": {
            sid: {"speed_kmh": round(p["speed_kmh"], 1), "severity": p["severity"],
                  "travel_time_min": round(segs[sid].length_km / max(p["speed_kmh"], 1) * 60, 1)}
            for sid, p in preds.items()
        },
    }


@app.get("/api/congestion/active")
def active_congestion(session: Session = Depends(get_session)):
    events = session.exec(
        select(CongestionEvent, RoadSegment)
        .join(RoadSegment, RoadSegment.id == CongestionEvent.segment_id)
        .where(CongestionEvent.end_time == None)  # noqa: E711
        .order_by(desc(CongestionEvent.start_time))
    ).all()
    now = utcnow()
    return [{
        "id": e.id, "segment_id": e.segment_id, "segment_name": s.name,
        "severity": e.severity, "start_time": iso(e.start_time),
        "minutes_ongoing": round((now - as_utc(e.start_time)).total_seconds() / 60, 1),
    } for e, s in events]


# ---------- Routes (FR 4) ----------
@app.get("/api/routes")
def get_routes(origin: str, destination: str, horizon: int = Query(0, ge=0, le=60),
               session: Session = Depends(get_session)):
    try:
        return routing.find_routes(session, origin, destination, horizon)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ---------- Alerts (FR 5.1, FR 10) ----------
@app.get("/api/alerts")
def list_alerts(limit: int = Query(40, ge=1, le=200), session: Session = Depends(get_session)):
    rows = session.exec(
        select(TrafficAlert, RoadSegment)
        .join(RoadSegment, RoadSegment.id == TrafficAlert.segment_id)
        .order_by(desc(TrafficAlert.created_at)).limit(limit)
    ).all()
    return [{
        "id": a.id, "kind": a.kind, "segment_id": a.segment_id, "segment_name": s.name,
        "severity": a.severity, "message": a.message, "created_at": iso(a.created_at),
        "acknowledged": a.acknowledged_at is not None,
    } for a, s in rows]


@app.post("/api/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: int, session: Session = Depends(get_session),
                      user: User = Depends(require_roles(*STAFF))):
    alert = session.get(TrafficAlert, alert_id)
    if not alert:
        raise HTTPException(404, "Alert not found")
    if alert.acknowledged_at is None:
        alert.acknowledged_by = user.id
        alert.acknowledged_at = utcnow()
        session.add(alert)
        log_action(session, user, "ALERT_ACKNOWLEDGED", alert.message, alert.segment_id)
        session.commit()
    return {"ok": True}


# ---------- Incidents (FR 9) ----------
class IncidentIn(BaseModel):
    segment_id: str
    type: str
    description: str = ""


class IncidentStatusIn(BaseModel):
    status: IncidentStatus


def incident_view(i: Incident, segs: dict, nodes: dict) -> dict:
    s = segs[i.segment_id]
    a, b = nodes[s.from_node], nodes[s.to_node]
    return {"id": i.id, "segment_id": i.segment_id, "segment_name": s.name, "type": i.type,
            "description": i.description, "status": i.status, "reported_at": iso(i.reported_at),
            "resolved_at": iso(i.resolved_at), "lat": (a.lat + b.lat) / 2, "lng": (a.lng + b.lng) / 2}


@app.get("/api/incidents")
def list_incidents(include_resolved: bool = False, session: Session = Depends(get_session)):
    query = select(Incident)
    if not include_resolved:
        query = query.where(Incident.status != IncidentStatus.RESOLVED)
    rows = session.exec(query.order_by(desc(Incident.reported_at)).limit(50)).all()
    nodes, segs = network(session)
    return [incident_view(i, segs, nodes) for i in rows]


@app.post("/api/incidents")
def create_incident(body: IncidentIn, session: Session = Depends(get_session),
                    user: User = Depends(require_roles(*STAFF))):
    if not session.get(RoadSegment, body.segment_id):
        raise HTTPException(400, "Unknown road segment")
    incident = Incident(segment_id=body.segment_id, type=body.type, description=body.description,
                        reported_by=user.id)
    session.add(incident)
    # Make the simulator slow traffic on this road, so the effect is visible in the demo
    simulator.state["incidents"][body.segment_id] = {"until": utcnow() + timedelta(minutes=15), "strength": 0.6}
    log_action(session, user, "INCIDENT_RECORDED", f"{body.type}: {body.description}", body.segment_id)
    session.commit()
    return {"id": incident.id}


@app.patch("/api/incidents/{incident_id}")
def update_incident(incident_id: int, body: IncidentStatusIn, session: Session = Depends(get_session),
                    user: User = Depends(require_roles(*STAFF))):
    incident = session.get(Incident, incident_id)
    if not incident:
        raise HTTPException(404, "Incident not found")
    incident.status = body.status
    if body.status == IncidentStatus.RESOLVED:
        incident.resolved_at = utcnow()
        simulator.state["incidents"].pop(incident.segment_id, None)
    session.add(incident)
    log_action(session, user, "INCIDENT_STATUS", f"Incident {incident.id} set to {body.status.value}",
               incident.segment_id)
    session.commit()
    return {"ok": True}


# ---------- Signal recommendations (FR 5, NFR 6) ----------
class ReviewIn(BaseModel):
    approve: bool
    notes: str = ""


@app.get("/api/signals")
def list_signals(session: Session = Depends(get_session), user: User = Depends(require_roles(*STAFF))):
    nodes, segs = network(session)
    rows = session.exec(select(SignalRecommendation).order_by(desc(SignalRecommendation.created_at)).limit(20)).all()
    out = []
    for r in rows:
        event = session.get(CongestionEvent, r.event_id)
        out.append({
            "id": r.id, "segment_name": segs[r.segment_id].name, "intersection": nodes[r.node_id].name,
            "suggested_plan": r.suggested_plan, "reason": r.reason, "status": r.status,
            "requires_authorization": r.requires_authorization,
            "event_active": bool(event and event.end_time is None), "created_at": iso(r.created_at),
        })
    out.sort(key=lambda x: x["status"] != ReviewStatus.PENDING)
    return out


@app.post("/api/signals/{rec_id}/review")
def review_signal(rec_id: int, body: ReviewIn, session: Session = Depends(get_session),
                  user: User = Depends(require_roles(*STAFF))):
    rec = session.get(SignalRecommendation, rec_id)
    if not rec:
        raise HTTPException(404, "Recommendation not found")
    if rec.status != ReviewStatus.PENDING:
        raise HTTPException(400, "Already reviewed")
    rec.status = ReviewStatus.APPROVED if body.approve else ReviewStatus.REJECTED
    rec.reviewed_by = user.id
    rec.reviewed_at = utcnow()
    session.add(rec)
    verdict = "SIGNAL_APPROVED" if body.approve else "SIGNAL_REJECTED"
    log_action(session, user, verdict, f"{rec.suggested_plan}. {body.notes}".strip(), rec.segment_id)
    session.commit()
    return {"status": rec.status,
            "note": "SmartFlow never changes signals automatically. Apply approved plans through the authorised traffic-control system."}


# ---------- Management actions (FR 5.2) ----------
@app.get("/api/actions")
def list_actions(session: Session = Depends(get_session), user: User = Depends(require_roles(*STAFF))):
    names = {u.id: u.name for u in session.exec(select(User)).all()}
    rows = session.exec(select(ManagementAction).order_by(desc(ManagementAction.taken_at)).limit(15)).all()
    return [{"id": a.id, "user": names.get(a.user_id, "?"), "action_type": a.action_type,
             "notes": a.notes, "taken_at": iso(a.taken_at)} for a in rows]


# ---------- Emergency routing (FR 6) ----------
class EmergencyIn(BaseModel):
    origin: str
    destination: str
    description: str = ""


@app.post("/api/emergency/request")
def emergency_request(body: EmergencyIn, session: Session = Depends(get_session),
                      user: User = Depends(require_roles(RoleType.EMERGENCY, *STAFF))):
    try:
        result = routing.find_routes(session, body.origin, body.destination, 0, max_routes=2)
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not result["routes"]:
        raise HTTPException(404, "No route found")
    best = result["routes"][0]
    req = EmergencyRequest(user_id=user.id, origin_node=body.origin, destination_node=body.destination,
                           description=body.description, estimated_minutes=best["minutes"],
                           data_fresh=not best["stale"])
    session.add(req)
    session.add(TrafficAlert(
        kind="EMERGENCY", segment_id=best["segment_ids"][0], severity=Severity.NORMAL,
        message=(f"Emergency route requested by {user.name}: {result['origin_name']} to "
                 f"{result['destination_name']}, ETA {best['minutes']} min"),
    ))
    audit(session, user, "EMERGENCY_REQUEST", f"{body.origin} -> {body.destination}")
    session.commit()
    session.refresh(req)
    return {**result, "request_id": req.id, "notified": True}


@app.get("/api/emergency/requests")
def list_emergency_requests(session: Session = Depends(get_session),
                            user: User = Depends(require_roles(RoleType.EMERGENCY, *STAFF))):
    nodes, _ = network(session)
    users = {u.id: u.name for u in session.exec(select(User)).all()}
    rows = session.exec(select(EmergencyRequest).order_by(desc(EmergencyRequest.requested_at)).limit(15)).all()
    return [{
        "id": r.id, "by": users.get(r.user_id, "?"), "origin": nodes[r.origin_node].name,
        "destination": nodes[r.destination_node].name, "description": r.description,
        "estimated_minutes": r.estimated_minutes, "data_fresh": r.data_fresh,
        "requested_at": iso(r.requested_at),
    } for r in rows]


# ---------- Reports (FR 7.2, NFR 19) ----------
@app.get("/api/reports/summary")
def report_summary(hours: int = Query(24, ge=1, le=720), session: Session = Depends(get_session),
                   user: User = Depends(require_roles(RoleType.ANALYST, *STAFF))):
    now = utcnow()
    since = now - timedelta(hours=hours)
    _, segs = network(session)

    events = session.exec(select(CongestionEvent).where(CongestionEvent.start_time >= since)).all()
    corridors: dict = {}
    for e in events:
        end = as_utc(e.end_time) or now
        minutes = (end - as_utc(e.start_time)).total_seconds() / 60
        corridor = segs[e.segment_id].corridor
        c = corridors.setdefault(corridor, {"corridor": corridor, "events": 0, "severe": 0, "total_minutes": 0.0})
        c["events"] += 1
        c["severe"] += 1 if e.severity == Severity.SEVERE else 0
        c["total_minutes"] += minutes
    corridor_rows = sorted(corridors.values(), key=lambda c: c["total_minutes"], reverse=True)
    for c in corridor_rows:
        c["total_minutes"] = round(c["total_minutes"], 1)

    avg_rows = session.exec(
        select(TrafficReading.segment_id, func.avg(TrafficReading.speed_kmh))
        .where(TrafficReading.timestamp >= since).group_by(TrafficReading.segment_id)
    ).all()
    segment_rows = sorted([{
        "id": sid, "name": segs[sid].name, "avg_speed_kmh": round(avg, 1),
        "speed_limit_kmh": segs[sid].speed_limit_kmh, "avg_ratio": round(avg / segs[sid].speed_limit_kmh, 2),
    } for sid, avg in avg_rows], key=lambda r: r["avg_ratio"])

    def count(model, column):
        return session.exec(select(func.count()).select_from(model).where(column >= since)).one()

    return {
        "period_hours": hours,
        "totals": {
            "readings": count(TrafficReading, TrafficReading.timestamp),
            "rejected": count(RejectedReading, RejectedReading.timestamp),
            "congestion_events": len(events),
            "severe_events": sum(1 for e in events if e.severity == Severity.SEVERE),
            "incidents": count(Incident, Incident.reported_at),
        },
        "corridors": corridor_rows,
        "segments": segment_rows,
        "prediction": prediction.accuracy_summary(session),
    }


# ---------- Administration (FR 8) ----------
class UserUpdate(BaseModel):
    role: RoleType | None = None
    is_active: bool | None = None


class ThresholdsIn(BaseModel):
    moderate: float
    severe: float


class SourceUpdate(BaseModel):
    is_active: bool


@app.get("/api/users")
def list_users(session: Session = Depends(get_session), user: User = Depends(require_roles(RoleType.ADMIN))):
    return [{"id": u.id, "name": u.name, "email": u.email, "role": u.role, "is_active": u.is_active,
             "last_login": iso(u.last_login)} for u in session.exec(select(User).order_by(User.id)).all()]


@app.patch("/api/users/{user_id}")
def update_user(user_id: int, body: UserUpdate, session: Session = Depends(get_session),
                admin: User = Depends(require_roles(RoleType.ADMIN))):
    target = session.get(User, user_id)
    if not target:
        raise HTTPException(404, "User not found")
    if target.id == admin.id and (body.is_active is False or (body.role and body.role != admin.role)):
        raise HTTPException(400, "You cannot deactivate or change the role of your own account")
    changes = []
    if body.role is not None:
        target.role = body.role
        changes.append(f"role={body.role.value}")
    if body.is_active is not None:
        target.is_active = body.is_active
        changes.append(f"active={body.is_active}")
    session.add(target)
    audit(session, admin, "USER_UPDATED", f"{target.email}: {', '.join(changes)}")
    session.commit()
    return {"ok": True}


@app.get("/api/config/thresholds")
def get_thresholds():
    return THRESHOLDS


@app.put("/api/config/thresholds")
def set_thresholds(body: ThresholdsIn, session: Session = Depends(get_session),
                   admin: User = Depends(require_roles(RoleType.ADMIN))):
    if not 0 < body.severe < body.moderate < 1:
        raise HTTPException(400, "Values must satisfy 0 < severe < moderate < 100%")
    THRESHOLDS["moderate"] = body.moderate
    THRESHOLDS["severe"] = body.severe
    audit(session, admin, "THRESHOLDS_CHANGED", f"moderate={body.moderate}, severe={body.severe}")
    session.commit()
    return THRESHOLDS


@app.get("/api/sources")
def data_sources(session: Session = Depends(get_session), user: User = Depends(require_roles(*STAFF))):
    return session.exec(select(DataSource)).all()


@app.patch("/api/sources/{source_id}")
def update_source(source_id: int, body: SourceUpdate, session: Session = Depends(get_session),
                  admin: User = Depends(require_roles(RoleType.ADMIN))):
    source = session.get(DataSource, source_id)
    if not source:
        raise HTTPException(404, "Data source not found")
    source.is_active = body.is_active
    session.add(source)
    audit(session, admin, "SOURCE_UPDATED", f"{source.name}: active={body.is_active}")
    session.commit()
    return {"ok": True}


@app.get("/api/readings/rejected")
def rejected_readings(limit: int = 50, session: Session = Depends(get_session),
                      user: User = Depends(require_roles(*STAFF))):
    return session.exec(select(RejectedReading).order_by(desc(RejectedReading.timestamp)).limit(limit)).all()


@app.get("/api/audit")
def audit_log(limit: int = 100, session: Session = Depends(get_session),
              user: User = Depends(require_roles(RoleType.ADMIN))):
    return session.exec(select(AuditLog).order_by(desc(AuditLog.timestamp)).limit(limit)).all()


# ---------- Simulator controls (for demos) ----------
class SimulatorSettings(BaseModel):
    running: bool | None = None
    hour: float | None = Field(default=None, ge=0, lt=24)
    speed: float = Field(default=1.0, ge=1, le=120)
    real_time: bool = False


@app.get("/api/simulator")
def get_simulator():
    return {"running": simulator.state["running"], "mode": simulator.state["mode"],
            "speed": simulator.current_speed(), "simulated_hour": round(simulator.current_hour(), 2),
            "active_incidents": list(simulator.state["incidents"].keys())}


@app.post("/api/simulator")
def set_simulator(body: SimulatorSettings, session: Session = Depends(get_session),
                  user: User = Depends(require_roles(*STAFF))):
    if body.running is not None:
        simulator.state["running"] = body.running
    if body.real_time:
        simulator.use_real_time()
    elif body.hour is not None:
        simulator.set_clock(body.hour, body.speed)
    audit(session, user, "SIMULATOR_SETTINGS", body.model_dump_json())
    session.commit()
    return get_simulator()
