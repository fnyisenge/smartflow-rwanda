import { MapContainer, Polyline, Popup, TileLayer, Tooltip } from "react-leaflet";
import { usePolling } from "../usePolling.js";

const KIGALI = [-1.955, 30.09];

export const SEVERITY = {
  NORMAL: { color: "#1f9d55", label: "Free flowing" },
  MODERATE: { color: "#e8a317", label: "Moderate congestion" },
  SEVERE: { color: "#d64545", label: "Severe congestion" },
  STALE: { color: "#9aa1ab", label: "Data outdated" },
};

function statusOf(seg) {
  return seg.is_stale ? "STALE" : seg.severity;
}

export default function LiveMap() {
  const { data, error } = usePolling("/api/traffic/live", 5000);
  const segments = data?.segments ?? [];

  const counts = { NORMAL: 0, MODERATE: 0, SEVERE: 0, STALE: 0 };
  segments.forEach((s) => counts[statusOf(s)]++);
  const rank = { SEVERE: 0, MODERATE: 1, STALE: 2, NORMAL: 3 };
  const problems = segments
    .filter((s) => statusOf(s) !== "NORMAL")
    .sort((a, b) => rank[statusOf(a)] - rank[statusOf(b)]);

  return (
    <div className="map-layout">
      <aside className="panel">
        <h1>Live traffic · Kigali pilot</h1>
        <p className="muted">
          {data ? `Updated ${new Date(data.generated_at).toLocaleTimeString()} · refreshes every 5 s` : "Loading…"}
        </p>
        {error && <div className="alert error">Cannot reach the server: {error}</div>}

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
          <p className="muted">All monitored roads are flowing normally.</p>
        ) : (
          <ul className="road-list">
            {problems.map((s) => (
              <li key={s.id}>
                <span className="dot" style={{ background: SEVERITY[statusOf(s)].color }} />
                <div>
                  <div className="road-name">{s.name}</div>
                  <div className="muted small">
                    {s.speed_kmh} km/h (limit {s.speed_limit_kmh}) · about {s.travel_time_min} min
                  </div>
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
          Travel times are estimates based on available data and are advisory only. Always follow
          instructions from traffic officers and emergency personnel.
        </p>
      </aside>

      <div className="map-wrap">
        <MapContainer center={KIGALI} zoom={13} scrollWheelZoom className="map">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {segments.map((s) => (
            <Polyline
              key={s.id}
              positions={s.coordinates}
              pathOptions={{ color: SEVERITY[statusOf(s)].color, weight: 8, opacity: 0.9, lineCap: "round" }}
            >
              <Tooltip sticky>{s.name}</Tooltip>
              <Popup>
                <strong>{s.name}</strong>
                <br />
                {SEVERITY[statusOf(s)].label}
                <br />
                Speed: {s.speed_kmh} km/h (limit {s.speed_limit_kmh})
                <br />
                Est. travel time: {s.travel_time_min} min for {s.length_km} km
                <br />
                <span className={s.is_stale ? "stale" : "fresh"}>
                  Data {s.data_age_seconds}s old{s.is_stale ? " — outdated" : ""}
                </span>
              </Popup>
            </Polyline>
          ))}
        </MapContainer>
      </div>
    </div>
  );
}
