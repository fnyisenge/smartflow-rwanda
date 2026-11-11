"""SmartFlow Rwanda API.

Run from the backend folder:  uvicorn app.main:app --reload
Interactive API docs:          http://localhost:8000/docs
"""
import asyncio
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlmodel import Session, desc, select

from . import simulator
from .auth import create_token, get_current_user, require_roles, verify_password
from .database import engine, get_session, init_db
from .models import (AuditLog, CongestionEvent, DataSource, RejectedReading, RoadNode,
                     RoadSegment, RoleType, User, as_utc, utcnow)
from .processing import STALE_AFTER_SECONDS, THRESHOLDS, classify, smoothed_speed
from .seed import seed


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    with Session(engine) as session:
        seed(session)
    for _ in range(3):
        simulator.tick()  # warm up so the map has data immediately
    task = asyncio.create_task(simulator.run_forever())
    yield
    task.cancel()


app = FastAPI(title="SmartFlow Rwanda API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def audit(session: Session, user: User | None, action: str, details: str = "") -> None:
    session.add(AuditLog(user_id=user.id if user else None, action=action, details=details))


# ---------- Health ----------
@app.get("/api/health")
def health():
    return {"status": "ok", "simulator_running": simulator.state["running"]}


# ---------- Auth (FR 8) ----------
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
@app.get("/api/traffic/live")
def live_traffic(session: Session = Depends(get_session)):
    """Current conditions for every monitored road. Public, so commuters need no account."""
    nodes = {n.id: n for n in session.exec(select(RoadNode)).all()}
    now = utcnow()
    result = []
    for seg in session.exec(select(RoadSegment)).all():
        speed, last_ts = smoothed_speed(session, seg.id)
        age = (now - last_ts).total_seconds() if last_ts else None
        a, b = nodes[seg.from_node], nodes[seg.to_node]
        result.append({
            "id": seg.id,
            "name": seg.name,
            "corridor": seg.corridor,
            "coordinates": [[a.lat, a.lng], [b.lat, b.lng]],
            "length_km": seg.length_km,
            "speed_limit_kmh": seg.speed_limit_kmh,
            "speed_kmh": round(speed, 1) if speed is not None else None,
            "severity": classify(speed / seg.speed_limit_kmh) if speed is not None else None,
            "travel_time_min": round(seg.length_km / max(speed, 1) * 60, 1) if speed else None,
            "data_age_seconds": round(age) if age is not None else None,
            "is_stale": age is None or age > STALE_AFTER_SECONDS,
        })
    return {"generated_at": now.isoformat(), "thresholds": THRESHOLDS, "segments": result}


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
        "severity": e.severity, "start_time": as_utc(e.start_time).isoformat(),
        "minutes_ongoing": round((now - as_utc(e.start_time)).total_seconds() / 60, 1),
    } for e, s in events]


# ---------- Officer / admin views ----------
STAFF = (RoleType.OFFICER, RoleType.ADMIN)


@app.get("/api/readings/rejected")
def rejected_readings(limit: int = 50, session: Session = Depends(get_session),
                      user: User = Depends(require_roles(*STAFF))):
    rows = session.exec(select(RejectedReading).order_by(desc(RejectedReading.timestamp)).limit(limit)).all()
    return rows


@app.get("/api/sources")
def data_sources(session: Session = Depends(get_session),
                 user: User = Depends(require_roles(*STAFF))):
    return session.exec(select(DataSource)).all()


@app.get("/api/audit")
def audit_log(limit: int = 100, session: Session = Depends(get_session),
              user: User = Depends(require_roles(RoleType.ADMIN))):
    return session.exec(select(AuditLog).order_by(desc(AuditLog.timestamp)).limit(limit)).all()


# ---------- Simulator controls (for demos) ----------
class SimulatorSettings(BaseModel):
    running: bool | None = None
    hour_override: float | None = Field(default=None, ge=0, lt=24)
    clear_hour_override: bool = False


@app.get("/api/simulator")
def get_simulator():
    return {"running": simulator.state["running"],
            "hour_override": simulator.state["hour_override"],
            "simulated_hour": round(simulator.current_hour(), 2),
            "active_incidents": list(simulator.state["incidents"].keys())}


@app.post("/api/simulator")
def set_simulator(body: SimulatorSettings, session: Session = Depends(get_session),
                  user: User = Depends(require_roles(*STAFF))):
    if body.running is not None:
        simulator.state["running"] = body.running
    if body.clear_hour_override:
        simulator.state["hour_override"] = None
    elif body.hour_override is not None:
        simulator.state["hour_override"] = body.hour_override
    audit(session, user, "SIMULATOR_SETTINGS", body.model_dump_json())
    session.commit()
    return get_simulator()
