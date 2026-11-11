"""Seed data: Kigali pilot road network, data sources and demo users.

Coordinates are approximate points for well-known Kigali areas, joined by
straight lines. That is enough for the prototype; real road shapes can be
added later from OpenStreetMap.
"""
import math

from sqlmodel import Session, select

from .auth import hash_password
from .models import DataSource, RoadNode, RoadSegment, RoleType, SourceType, User

NODES = [
    ("nyabugogo", "Nyabugogo Bus Park", -1.9390, 30.0445),
    ("city_centre", "City Centre (CBD)", -1.9441, 30.0605),
    ("kiyovu", "Kiyovu", -1.9520, 30.0640),
    ("kimicanga", "Kimicanga", -1.9445, 30.0780),
    ("kacyiru", "Kacyiru", -1.9380, 30.0880),
    ("kcc", "Kigali Convention Centre", -1.9545, 30.0930),
    ("remera", "Remera (Giporoso)", -1.9600, 30.1150),
    ("kimironko", "Kimironko", -1.9496, 30.1260),
    ("sonatubes", "Sonatubes", -1.9670, 30.1000),
    ("kicukiro", "Kicukiro Centre", -1.9790, 30.1030),
    ("gikondo", "Gikondo", -1.9700, 30.0760),
    ("airport", "Kigali International Airport (Kanombe)", -1.9670, 30.1370),
]

# (id, from, to, corridor, speed limit km/h, peak busyness)
SEGMENTS = [
    ("S01", "nyabugogo", "city_centre", "Nyabugogo - CBD", 40, 1.45),
    ("S02", "city_centre", "kimicanga", "CBD - Kacyiru", 50, 1.25),
    ("S03", "kimicanga", "kacyiru", "CBD - Kacyiru", 50, 1.0),
    ("S04", "kimicanga", "kcc", "CBD - Remera", 50, 1.15),
    ("S05", "kcc", "remera", "CBD - Remera", 60, 1.3),
    ("S06", "remera", "kimironko", "Remera - Kimironko", 50, 1.2),
    ("S07", "kacyiru", "kimironko", "Kacyiru - Kimironko", 60, 0.9),
    ("S08", "kcc", "sonatubes", "Kicukiro corridor", 60, 1.1),
    ("S09", "remera", "airport", "Airport Road", 60, 1.0),
    ("S10", "sonatubes", "remera", "Airport Road", 60, 1.2),
    ("S11", "sonatubes", "kicukiro", "Kicukiro corridor", 50, 1.1),
    ("S12", "city_centre", "kiyovu", "CBD - Kiyovu", 40, 0.8),
    ("S13", "kiyovu", "gikondo", "Gikondo corridor", 50, 0.9),
    ("S14", "gikondo", "sonatubes", "Gikondo corridor", 50, 1.0),
    ("S15", "kiyovu", "kcc", "Kiyovu - KCC", 50, 0.8),
]

DEMO_PASSWORD = "SmartFlow2026!"
USERS = [
    ("Demo Commuter", "commuter@smartflow.rw", RoleType.COMMUTER),
    ("Demo Emergency Unit", "emergency@smartflow.rw", RoleType.EMERGENCY),
    ("Demo Traffic Officer", "officer@smartflow.rw", RoleType.OFFICER),
    ("Demo Urban Planner", "analyst@smartflow.rw", RoleType.ANALYST),
    ("Demo Administrator", "admin@smartflow.rw", RoleType.ADMIN),
]


def haversine_km(lat1, lng1, lat2, lng2) -> float:
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def seed(session: Session) -> None:
    if session.exec(select(RoadNode)).first():
        return  # already seeded

    nodes = {}
    for node_id, name, lat, lng in NODES:
        node = RoadNode(id=node_id, name=name, lat=lat, lng=lng)
        nodes[node_id] = node
        session.add(node)

    for seg_id, a, b, corridor, limit, busy in SEGMENTS:
        na, nb = nodes[a], nodes[b]
        # Roads in hilly Kigali wind, so straight-line distance x 1.3
        length = round(haversine_km(na.lat, na.lng, nb.lat, nb.lng) * 1.3, 2)
        session.add(RoadSegment(
            id=seg_id, name=f"{na.name} - {nb.name}", corridor=corridor,
            from_node=a, to_node=b, length_km=length,
            speed_limit_kmh=limit, busyness=busy,
        ))

    session.add(DataSource(name="Simulated GPS probes", source_type=SourceType.GPS))
    session.add(DataSource(name="Simulated road sensors", source_type=SourceType.SENSOR))
    session.add(DataSource(name="Simulated traffic cameras", source_type=SourceType.CAMERA))

    for name, email, role in USERS:
        session.add(User(name=name, email=email, role=role,
                         password_hash=hash_password(DEMO_PASSWORD)))

    session.commit()
