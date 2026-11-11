"""Database tables, based on the SmartFlow Rwanda UML class diagram.

Classes added in later sprints (CongestionPrediction, RouteRecommendation,
SignalRecommendation, Incident, EmergencyRequest, Report) will go here too.
"""
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from sqlmodel import Field, SQLModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(dt: datetime | None) -> datetime | None:
    """SQLite gives back timestamps without a timezone; treat them as UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


# ---------- Enumerations (from the class diagram) ----------
class RoleType(str, Enum):
    COMMUTER = "COMMUTER"
    EMERGENCY = "EMERGENCY"
    OFFICER = "OFFICER"
    ANALYST = "ANALYST"
    ADMIN = "ADMIN"


class Severity(str, Enum):
    NORMAL = "NORMAL"
    MODERATE = "MODERATE"
    SEVERE = "SEVERE"


class SourceType(str, Enum):
    GPS = "GPS"
    SENSOR = "SENSOR"
    CAMERA = "CAMERA"
    API = "API"


# ---------- Users (FR 8) ----------
class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    email: str = Field(index=True, unique=True)
    password_hash: str
    role: RoleType
    is_active: bool = True
    last_login: Optional[datetime] = None


# ---------- Road network ----------
class RoadNode(SQLModel, table=True):
    """A junction or landmark. Road segments connect two nodes (used for routing)."""
    id: str = Field(primary_key=True)
    name: str
    lat: float
    lng: float


class RoadSegment(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    corridor: str
    from_node: str = Field(foreign_key="roadnode.id")
    to_node: str = Field(foreign_key="roadnode.id")
    length_km: float
    speed_limit_kmh: float
    busyness: float = 1.0  # how busy this road gets at peak (simulator only)


# ---------- Data sources and readings (FR 1) ----------
class DataSource(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    source_type: SourceType
    endpoint_url: Optional[str] = None
    is_active: bool = True
    last_received: Optional[datetime] = None


class TrafficReading(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    segment_id: str = Field(foreign_key="roadsegment.id", index=True)
    source_id: int = Field(foreign_key="datasource.id")
    speed_kmh: float
    vehicle_density: float  # vehicles per km
    timestamp: datetime = Field(default_factory=utcnow, index=True)


class RejectedReading(SQLModel, table=True):
    """Invalid records are logged, never used for analysis (FR 1.2)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    raw_data: str
    reason: str
    timestamp: datetime = Field(default_factory=utcnow)


# ---------- Congestion (FR 3.1) ----------
class CongestionEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    segment_id: str = Field(foreign_key="roadsegment.id", index=True)
    severity: Severity
    start_time: datetime = Field(default_factory=utcnow)
    end_time: Optional[datetime] = None
    threshold_used: float


# ---------- Audit (NFR 12) ----------
class AuditLog(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    action: str
    details: str = ""
    timestamp: datetime = Field(default_factory=utcnow)
