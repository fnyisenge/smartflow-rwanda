import { useState } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, ZoomControl } from "react-leaflet";
import Icon from "../icons.jsx";
import { usePolling } from "../usePolling.js";

const KIGALI = [-1.955, 30.09];

export const SEVERITY = {
  NORMAL: { color: "#22c55e", label: "Free flowing" },
  MODERATE: { color: "#f59e0b", label: "Moderate congestion" },
  SEVERE: { color: "#ef4444", label: "Severe congestion" },
  STALE: { color: "#6b7280", label: "Data outdated" },
};

const HORIZONS = [
  [0, "Now"],
  [15, "+15 min"],
  [30, "+30 min"],
  [60, "+60 min"],
];

// How each alert is labelled in the alert feed
const PRIORITY = {
  SEVERE: { label: "Critical", cls: "critical" },
  MODERATE: { label: "High", cls: "high" },
  NORMAL: { label: "Info", cls: "info" },
};

export default function LiveMap() {
  const [horizon, setHorizon] = useState(0);
  const [showAlerts, setShowAlerts] = useState(true);
  const [showStats, setShowStats] = useState(true);
  const { data, error } = usePolling("/api/traffic/live", 5000);
  const { data: predicted } = usePolling(horizon > 0 ? `/api/traffic/predicted?horizon=${horizon}` : null, 5000);
  const { data: incidents } = usePolling("/api/incidents", 10000);
  const { data: alerts } = usePolling("/api/alerts?limit=20", 10000);

  const segments = data?.segments ?? [];
  const forecast = horizon > 0 && predicted?.horizon_min === horizon ? predicted.segments : null;

  function view(seg) {
    if (forecast && forecast[seg.id]) {
      const p = forecast[seg.id];
      return { status: p.severity, speed: p.speed_kmh, minutes: p.travel_time_min };
    }
    return { status: seg.is_stale || !seg.severity ? "STALE" : seg.severity, speed: seg.speed_kmh, minutes: seg.travel_time_min };
  }

  const rows = segments.map((s) => ({ seg: s, v: view(s) }));
  const counts = { NORMAL: 0, MODERATE: 0, SEVERE: 0, STALE: 0 };
  rows.forEach((r) => counts[r.v.status]++);
  const rank = { SEVERE: 0, MODERATE: 1, STALE: 2, NORMAL: 3 };
  const problems = rows.filter((r) => r.v.status !== "NORMAL").sort((a, b) => rank[a.v.status] - rank[b.v.status]);
  const total = segments.length;
  const isNew = (iso) => Date.now() - new Date(iso).getTime() < 2 * 60 * 1000;

  return (
    <div className="map-full">
      <MapContainer center={KIGALI} zoom={13} scrollWheelZoom zoomControl={false} className="map">
        <ZoomControl position="bottomright" />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {rows.map(({ seg, v }) => (
          <Polyline
            key={seg.id}
            positions={seg.coordinates}
            pathOptions={{ color: SEVERITY[v.status].color, weight: 8, opacity: 0.95, lineCap: "round" }}
          >
            <Tooltip sticky>{seg.name}</Tooltip>
            <Popup>
              <strong>{seg.name}</strong><br />
              {SEVERITY[v.status].label}{horizon > 0 ? ` (forecast +${horizon} min)` : ""}<br />
              Speed: {v.speed} km/h (limit {seg.speed_limit_kmh})<br />
              Est. travel time: {v.minutes} min for {seg.length_km} km<br />
              <span className={seg.is_stale ? "stale" : "fresh"}>
                Live data {seg.data_age_seconds}s old{seg.is_stale ? " — outdated" : ""}
              </span>
            </Popup>
          </Polyline>
        ))}
        {(incidents ?? []).map((i) => (
          <CircleMarker
            key={i.id} center={[i.lat, i.lng]} radius={11}
            pathOptions={{ color: "#fff", fillColor: "#ef4444", fillOpacity: 1, weight: 3 }}
          >
            <Popup>
              <strong>{i.type}</strong><br />
              {i.segment_name}<br />
              Status: {i.status}<br />
              {i.description}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>

      {/* Left panel: city stats + AI forecast tabs */}
      <section className={`float-panel stats-panel ${showStats ? "" : "collapsed"}`}>
        <button className="panel-head" onClick={() => setShowStats(!showStats)}>
          <span>
            <strong>Kigali pilot</strong>
            <small>{horizon === 0 ? "Live traffic" : `AI forecast · +${horizon} min`}</small>
          </span>
          <span className={`chev ${showStats ? "up" : ""}`}>⌃</span>
        </button>

        {showStats && (
          <>
            <div className="seg-tabs" role="tablist" aria-label="Time">
              {HORIZONS.map(([h, label]) => (
                <button key={h} role="tab" aria-selected={horizon === h}
                  className={horizon === h ? "on" : ""} onClick={() => setHorizon(h)}>
                  {label}
                </button>
              ))}
            </div>
            {error && <div className="alert error">Cannot reach the server: {error}</div>}

            <div className="tile-grid">
              <div className="tile"><b style={{ color: SEVERITY.NORMAL.color }}>{counts.NORMAL}</b><span>/ {total}</span><p>Roads flowing freely</p></div>
              <div className="tile"><b style={{ color: SEVERITY.MODERATE.color }}>{counts.MODERATE}</b><span>/ {total}</span><p>Moderate congestion</p></div>
              <div className="tile"><b style={{ color: SEVERITY.SEVERE.color }}>{counts.SEVERE}</b><span>/ {total}</span><p>Severe congestion</p></div>
              <div className="tile"><b>{incidents?.length ?? 0}</b><p>Open incidents</p></div>
            </div>

            <h3>Roads to avoid</h3>
            {problems.length === 0 ? (
              <p className="muted small">All monitored roads are expected to flow normally.</p>
            ) : (
              <ul className="road-list">
                {problems.slice(0, 6).map(({ seg, v }) => (
                  <li key={seg.id}>
                    <span className="dot" style={{ background: SEVERITY[v.status].color }} />
                    <div>
                      <div className="road-name">{seg.name}</div>
                      <div className="muted small">{v.speed} km/h (limit {seg.speed_limit_kmh}) · about {v.minutes} min</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="legend">
              {Object.entries(SEVERITY).map(([k, v]) => (
                <span key={k}><i style={{ background: v.color }} />{v.label}</span>
              ))}
            </div>
            <p className="advisory">
              Travel times and forecasts are estimates and advisory only. Always follow instructions from
              traffic officers and emergency personnel.
            </p>
          </>
        )}
      </section>

      {/* Right panel: alert feed */}
      {showAlerts ? (
        <section className="float-panel alerts-panel">
          <div className="panel-title">
            <div>
              <strong>Alerts</strong>
              <small>{alerts?.length ?? 0} today</small>
            </div>
            <button className="icon-btn" onClick={() => setShowAlerts(false)} aria-label="Hide alerts">✕</button>
          </div>
          <div className="alert-feed">
            {(alerts ?? []).length === 0 && <p className="muted small">No alerts yet today.</p>}
            {(alerts ?? []).map((a) => {
              const p = a.kind === "EMERGENCY" ? { label: "Emergency", cls: "critical" } : PRIORITY[a.severity];
              return (
                <article key={a.id} className="feed-item">
                  <div className="feed-top">
                    {isNew(a.created_at) && <span className="new-tag">New</span>}
                    <span className="muted small">№{a.id} · {new Date(a.created_at).toLocaleTimeString()}</span>
                    <span className={`prio ${p.cls}`}>{p.label}</span>
                  </div>
                  <div className="feed-title">
                    {a.kind === "PREDICTED" ? "Predicted congestion" : a.kind === "EMERGENCY" ? "Emergency route" : "Congestion detected"}
                  </div>
                  <div className="muted small">{a.message}</div>
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <button className="float-panel bell" onClick={() => setShowAlerts(true)} aria-label="Show alerts">
          <Icon name="alert" /> {alerts?.length ?? 0}
        </button>
      )}

      <div className="float-panel status-strip">
        {data ? `Updated ${new Date(data.generated_at).toLocaleTimeString()} · refreshes every 5 s` : "Loading…"}
      </div>
    </div>
  );
}