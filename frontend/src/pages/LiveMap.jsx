import { useState } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip } from "react-leaflet";
import { usePolling } from "../usePolling.js";

const KIGALI = [-1.955, 30.09];

export const SEVERITY = {
  NORMAL: { color: "#1f9d55", label: "Free flowing" },
  MODERATE: { color: "#e8a317", label: "Moderate congestion" },
  SEVERE: { color: "#d64545", label: "Severe congestion" },
  STALE: { color: "#9aa1ab", label: "Data outdated" },
};

const STEPS = [0, 15, 30, 45, 60];

export default function LiveMap() {
  const [horizon, setHorizon] = useState(0);
  const { data, error } = usePolling("/api/traffic/live", 5000);
  const { data: predicted } = usePolling(horizon > 0 ? `/api/traffic/predicted?horizon=${horizon}` : null, 5000);
  const { data: incidents } = usePolling("/api/incidents", 10000);
  const { data: alerts } = usePolling("/api/alerts?limit=5", 10000);

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

  return (
    <div className="map-layout">
      <aside className="panel">
        <h1>{horizon === 0 ? "Live traffic" : `AI forecast: +${horizon} min`} · Kigali pilot</h1>
        <p className="muted">
          {data ? `Updated ${new Date(data.generated_at).toLocaleTimeString()} · refreshes every 5 s` : "Loading…"}
        </p>
        {error && <div className="alert error">Cannot reach the server: {error}</div>}

        <div className="slider-box">
          <div className="small"><strong>Time travel</strong> — see where congestion is expected</div>
          <input
            type="range" min="0" max="60" step="15" value={horizon}
            onChange={(e) => setHorizon(Number(e.target.value))}
          />
          <div className="slider-labels">
            {STEPS.map((s) => <span key={s}>{s === 0 ? "Now" : `+${s}`}</span>)}
          </div>
        </div>

        <div className="stats">
          {["NORMAL", "MODERATE", "SEVERE"].map((k) => (
            <div key={k} className="stat" style={{ borderTopColor: SEVERITY[k].color }}>
              <div className="stat-num">{counts[k]}</div>
              <div className="stat-label">{SEVERITY[k].label}</div>
            </div>
          ))}
        </div>

        <h2>Roads to avoid</h2>
        {problems.length === 0 ? (
          <p className="muted">All monitored roads are expected to flow normally.</p>
        ) : (
          <ul className="road-list">
            {problems.map(({ seg, v }) => (
              <li key={seg.id}>
                <span className="dot" style={{ background: SEVERITY[v.status].color }} />
                <div>
                  <div className="road-name">{seg.name}</div>
                  <div className="muted small">
                    {v.speed} km/h (limit {seg.speed_limit_kmh}) · about {v.minutes} min
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}

        {alerts?.length > 0 && (
          <>
            <h2>Latest alerts</h2>
            <ul className="road-list">
              {alerts.map((a) => (
                <li key={a.id}>
                  <span className="dot" style={{ background: SEVERITY[a.severity].color }} />
                  <div>
                    <div className="small">{a.message}</div>
                    <div className="muted small">{new Date(a.created_at).toLocaleTimeString()}</div>
                  </div>
                </li>
              ))}
            </ul>
          </>
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
      </aside>

      <div className="map-wrap">
        <MapContainer center={KIGALI} zoom={13} scrollWheelZoom className="map">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {rows.map(({ seg, v }) => (
            <Polyline
              key={seg.id}
              positions={seg.coordinates}
              pathOptions={{ color: SEVERITY[v.status].color, weight: 8, opacity: 0.9, lineCap: "round" }}
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
              pathOptions={{ color: "#6b1212", fillColor: "#d64545", fillOpacity: 0.95, weight: 3 }}
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
      </div>
    </div>
  );
}
