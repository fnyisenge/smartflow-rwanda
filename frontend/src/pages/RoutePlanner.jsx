import { Fragment, useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { api } from "../api.js";
import { formatDistance, getDirections } from "../directions.js";
import { usePolling } from "../usePolling.js";
import { SEVERITY } from "./LiveMap.jsx";

const SAVED_KEY = "smartflow_saved_routes";

function FitTo({ points }) {
  const map = useMap();
  useEffect(() => {
    if (points && points.length > 1) map.fitBounds(points, { padding: [50, 50] });
  }, [points, map]);
  return null;
}

export default function RoutePlanner({ emergency = false }) {
  const [nodes, setNodes] = useState([]);
  const [origin, setOrigin] = useState("");
  const [destination, setDestination] = useState("");
  const [horizon, setHorizon] = useState(0);
  const [description, setDescription] = useState("");
  const [result, setResult] = useState(null);
  const [picked, setPicked] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [roads, setRoads] = useState({}); // road path + turn-by-turn directions per route
  const [saved, setSaved] = useState(() => JSON.parse(localStorage.getItem(SAVED_KEY) || "[]"));
  const { data: alerts } = usePolling(emergency ? null : "/api/alerts?limit=40", 10000);

  useEffect(() => {
    api("/api/nodes").then(setNodes).catch((e) => setError(e.message));
  }, []);

  // When routes arrive, fetch the real road path and directions for each one (one at a time).
  useEffect(() => {
    setRoads({});
    if (!result?.routes?.length) return undefined;
    let active = true;
    (async () => {
      for (let i = 0; i < result.routes.length; i++) {
        const dir = await getDirections(result.routes[i]);
        if (!active) return;
        setRoads((prev) => ({ ...prev, [i]: dir }));
      }
    })();
    return () => {
      active = false;
    };
  }, [result]);

  async function submit(e) {
    e.preventDefault();
    if (!origin || !destination) {
      setError("Choose a start and a destination.");
      return;
    }
    setBusy(true);
    setError("");
    setPicked(0);
    try {
      const data = emergency
        ? await api("/api/emergency/request", { method: "POST", body: { origin, destination, description } })
        : await api(`/api/routes?origin=${origin}&destination=${destination}&horizon=${horizon}`);
      setResult(data);
    } catch (err) {
      setError(err.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  function persist(next) {
    setSaved(next);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
  }

  function saveRoute() {
    if (!result?.routes?.length) return;
    const entry = {
      id: Date.now(),
      name: `${result.origin_name} → ${result.destination_name}`,
      segment_ids: result.routes[0].segment_ids,
    };
    persist([entry, ...saved].slice(0, 5));
  }

  const savedSegments = useMemo(() => new Set(saved.flatMap((s) => s.segment_ids)), [saved]);
  const myAlerts = (alerts || []).filter(
    (a) => savedSegments.has(a.segment_id) && Date.now() - new Date(a.created_at).getTime() < 3600 * 1000
  );

  const route = result?.routes?.[picked];
  const lineFor = (r, i) => roads[i]?.line ?? r.coordinates;
  const fitPoints = route ? lineFor(route, picked) : undefined;
  const directions = roads[picked];
  const directionsBox = route && (
    <div className="directions-box">
      <h2>Directions · {route.label}</h2>
      {!directions ? (
        <p className="muted small">Loading turn-by-turn directions…</p>
      ) : (
        <>
          <p className="muted small">
            {formatDistance(directions.distance_m)} by road · about {route.minutes} min in current traffic
            {directions.source === "straight" && " · street-level directions are unavailable right now, showing the main places to pass"}
          </p>
          <ol className="directions">
            {directions.steps.map((st, k) => (
              <li key={k} className={st.waypoint ? "waypoint" : ""}>
                <span className="dir-icon">{st.icon}</span>
                <span className="dir-text">{st.text}</span>
                {st.distance > 0 && <span className="dir-dist">{formatDistance(st.distance)}</span>}
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );

  return (
    <div className="map-layout">
      <aside className="panel">
        <h1>{emergency ? "Emergency routing" : "Route planner"}</h1>
        <p className="muted">
          {emergency
            ? "Get the least congested route for an emergency journey. Traffic officers are notified."
            : "Find the fastest route and alternatives that avoid congestion."}
        </p>

        <form onSubmit={submit}>
          <label>
            From
            <select value={origin} onChange={(e) => setOrigin(e.target.value)}>
              <option value="">Choose a place…</option>
              {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </label>
          <label>
            To
            <select value={destination} onChange={(e) => setDestination(e.target.value)}>
              <option value="">Choose a place…</option>
              {nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
            </select>
          </label>
          {emergency ? (
            <label>
              Details (optional)
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. ambulance, patient transfer" />
            </label>
          ) : (
            <label>
              When
              <select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
                <option value={0}>Leaving now (current traffic)</option>
                <option value={15}>In 15 min (AI forecast)</option>
                <option value={30}>In 30 min (AI forecast)</option>
                <option value={60}>In 60 min (AI forecast)</option>
              </select>
            </label>
          )}
          <button className={emergency ? "btn btn-danger" : "btn"} disabled={busy}>
            {busy ? "Finding routes…" : emergency ? "Request emergency route" : "Find routes"}
          </button>
        </form>

        {error && <div className="alert error">{error}</div>}

        {result && (
          <>
            {emergency && result.request_id && (
              <div className="alert ok">Request #{result.request_id} sent. Traffic officers have been notified.</div>
            )}
            {result.data_stale && (
              <div className="alert warn">
                Some traffic data on these routes is outdated, so the times may be less reliable.
              </div>
            )}
            <h2>{result.origin_name} → {result.destination_name}</h2>
            {result.routes.map((r, i) => (
              <Fragment key={r.label}>
                <div className={`route-card ${i === picked ? "active" : ""}`} onClick={() => setPicked(i)}>
                <div className="route-top">
                  <strong>{r.label}</strong>
                  <span className="route-time">{r.minutes} min</span>
                </div>
                <div className="muted small">
                  {roads[i] ? formatDistance(roads[i].distance_m) : `${r.distance_km} km`} · {r.delay_min > 0 ? `${r.delay_min} min delay from traffic` : "no traffic delay"}
                </div>
                <div className="route-badges">
                  <span className="badge" style={{ background: SEVERITY[r.worst_severity].color }}>
                    {SEVERITY[r.worst_severity].label}
                  </span>
                  <span className="badge" style={{ background: r.stale ? "#9aa1ab" : "#1f9d55" }}>
                    {r.stale ? "Data outdated" : "Data fresh"}
                  </span>
                </div>
                <div className="muted small">via {r.via.join(" → ")}</div>
              </div>
              {i === picked && directionsBox}
              </Fragment>
            ))}
            {result.routes.length === 0 && <p className="muted">No route found.</p>}
            {!emergency && result.routes.length > 0 && (
              <button className="btn-ghost" onClick={saveRoute}>Save this route for alerts</button>
            )}
            <p className="advisory">{result.advisory}</p>
          </>
        )}

        {!emergency && (
          <>
            <h2>My saved routes</h2>
            {saved.length === 0 ? (
              <p className="muted small">Save a route to get alerts when congestion affects it.</p>
            ) : (
              <ul className="road-list">
                {saved.map((s) => (
                  <li key={s.id}>
                    <div className="road-name">{s.name}</div>
                    <button className="link-btn" onClick={() => persist(saved.filter((x) => x.id !== s.id))}>remove</button>
                  </li>
                ))}
              </ul>
            )}
            {saved.length > 0 && (
              <>
                <h2>Alerts on my routes</h2>
                {myAlerts.length === 0 ? (
                  <p className="muted small">No alerts in the last hour. Your saved routes look clear.</p>
                ) : (
                  <ul className="road-list">
                    {myAlerts.map((a) => (
                      <li key={a.id}>
                        <span className="dot" style={{ background: SEVERITY[a.severity].color }} />
                        <div>
                          <div className="small">{a.message}</div>
                          <div className="muted small">{new Date(a.created_at).toLocaleTimeString()}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </aside>

      <div className="map-wrap">
        <MapContainer center={[-1.955, 30.09]} zoom={13} scrollWheelZoom className="map">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitTo points={fitPoints} />
          {result?.routes?.map((r, i) => (
            <Polyline
              key={`${r.label}-${i === picked}-${roads[i] ? "road" : "line"}`}
              positions={lineFor(r, i)}
              eventHandlers={{ click: () => setPicked(i) }}
              pathOptions={i === picked
                ? { color: "#1b5fd6", weight: 9, opacity: 0.95 }
                : { color: "#8a94a3", weight: 5, opacity: 0.6, dashArray: "8 8" }}
            >
              <Tooltip sticky>{r.label}: {r.minutes} min</Tooltip>
            </Polyline>
          ))}
          {route && (
            <>
              <CircleMarker center={fitPoints[0]} radius={9} pathOptions={{ color: "#0b6e4f", fillColor: "#0b6e4f", fillOpacity: 1 }}>
                <Tooltip permanent direction="top">Start</Tooltip>
              </CircleMarker>
              <CircleMarker center={fitPoints[fitPoints.length - 1]} radius={9} pathOptions={{ color: "#d64545", fillColor: "#d64545", fillOpacity: 1 }}>
                <Tooltip permanent direction="top">End</Tooltip>
              </CircleMarker>
            </>
          )}
        </MapContainer>
      </div>
    </div>
  );
}