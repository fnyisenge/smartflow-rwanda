"""Route recommendation (FR 4) and emergency routing (FR 6).

Dijkstra on the Kigali road graph, where each road's cost is its travel time under
current (or AI-predicted) traffic. Alternatives come from penalising roads already used.
"""
import heapq

from sqlmodel import Session, select

from . import prediction
from .models import RoadNode, RoadSegment, utcnow
from .processing import STALE_AFTER_SECONDS, classify, smoothed_speed

RANK = {"NORMAL": 0, "MODERATE": 1, "SEVERE": 2}


def load_network(session: Session):
    nodes = {n.id: n for n in session.exec(select(RoadNode)).all()}
    segs = {s.id: s for s in session.exec(select(RoadSegment)).all()}
    return nodes, segs


def speeds_for(session: Session, segs: dict, horizon: int) -> dict:
    now = utcnow()
    info = {}
    for s in segs.values():
        speed, ts = smoothed_speed(session, s.id)
        age = (now - ts).total_seconds() if ts else None
        info[s.id] = {"speed": speed if speed else s.speed_limit_kmh * 0.5, "age": age}
    if horizon > 0:
        for sid, p in prediction.predict_ratios(session, horizon).items():
            info[sid]["speed"] = p["speed_kmh"]
    return info


def _dijkstra(adj: dict, start: str, goal: str, penalty: dict):
    dist = {start: 0.0}
    prev: dict = {}
    heap = [(0.0, start)]
    while heap:
        d, u = heapq.heappop(heap)
        if u == goal:
            break
        if d > dist.get(u, float("inf")):
            continue
        for v, sid, cost in adj.get(u, []):
            nd = d + cost * penalty.get(sid, 1.0)
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                prev[v] = (u, sid)
                heapq.heappush(heap, (nd, v))
    if goal not in dist:
        return None
    path, seg_ids = [goal], []
    while path[-1] != start:
        u, sid = prev[path[-1]]
        seg_ids.append(sid)
        path.append(u)
    path.reverse()
    seg_ids.reverse()
    return path, seg_ids


def _describe(path, seg_ids, nodes, segs, info) -> dict:
    minutes = free_flow = km = 0.0
    worst, stale, legs = "NORMAL", False, []
    for sid in seg_ids:
        s = segs[sid]
        speed = max(info[sid]["speed"], 3.0)
        m = s.length_km / speed * 60
        minutes += m
        free_flow += s.length_km / s.speed_limit_kmh * 60
        km += s.length_km
        sev = classify(min(1.0, speed / s.speed_limit_kmh)).value
        if RANK[sev] > RANK[worst]:
            worst = sev
        age = info[sid]["age"]
        if age is None or age > STALE_AFTER_SECONDS:
            stale = True
        legs.append({"segment_id": sid, "name": s.name, "severity": sev, "minutes": round(m, 1)})
    return {
        "minutes": round(minutes, 1),
        "distance_km": round(km, 1),
        "delay_min": round(max(0.0, minutes - free_flow), 1),
        "worst_severity": worst,
        "stale": stale,
        "via": [nodes[n].name for n in path],
        "segment_ids": seg_ids,
        "legs": legs,
        "coordinates": [[nodes[n].lat, nodes[n].lng] for n in path],
    }


def find_routes(session: Session, origin: str, destination: str, horizon: int = 0, max_routes: int = 3) -> dict:
    nodes, segs = load_network(session)
    if origin not in nodes or destination not in nodes:
        raise ValueError("Unknown location")
    if origin == destination:
        raise ValueError("Start and destination are the same")
    info = speeds_for(session, segs, horizon)

    adj: dict = {}
    for s in segs.values():
        minutes = s.length_km / max(info[s.id]["speed"], 3.0) * 60
        adj.setdefault(s.from_node, []).append((s.to_node, s.id, minutes))
        adj.setdefault(s.to_node, []).append((s.from_node, s.id, minutes))

    routes, seen, penalty = [], set(), {}
    for _ in range(6):
        found = _dijkstra(adj, origin, destination, penalty)
        if not found:
            break
        path, seg_ids = found
        if tuple(seg_ids) not in seen:
            seen.add(tuple(seg_ids))
            routes.append(_describe(path, seg_ids, nodes, segs, info))
        for sid in seg_ids:
            penalty[sid] = penalty.get(sid, 1.0) * 1.8
        if len(routes) >= max_routes:
            break

    routes.sort(key=lambda r: r["minutes"])
    if routes:
        routes = [r for r in routes if r["minutes"] <= routes[0]["minutes"] * 2.5]
    for i, r in enumerate(routes):
        r["label"] = "Fastest" if i == 0 else f"Alternative {i}"

    return {
        "origin_name": nodes[origin].name,
        "destination_name": nodes[destination].name,
        "horizon_min": horizon,
        "data_stale": any(r["stale"] for r in routes),
        "advisory": "Route times are estimates, not guarantees. Always follow instructions from traffic officers and emergency personnel.",
        "routes": routes,
    }
