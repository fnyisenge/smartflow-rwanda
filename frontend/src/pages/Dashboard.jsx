import { Link } from "react-router-dom";
import { MapContainer, Polyline, TileLayer } from "react-leaflet";
import { useAuth } from "../auth.jsx";
import Icon from "../icons.jsx";
import { usePolling } from "../usePolling.js";
import { SEVERITY } from "./LiveMap.jsx";

const LEVELS = ["NORMAL", "MODERATE", "SEVERE"];
const statusOf = (s) => (s.is_stale || !s.severity ? "STALE" : s.severity);

function countLevels(severities) {
  const c = { NORMAL: 0, MODERATE: 0, SEVERE: 0, STALE: 0 };
  severities.forEach((s) => c[s]++);
  return c;
}

// Donut chart of how many roads are at each congestion level right now.
function Donut({ counts, total }) {
  const r = 62;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const parts = [...LEVELS, "STALE"].filter((k) => counts[k] > 0);
  return (
    <svg viewBox="0 0 160 160" className="donut" role="img" aria-label="Roads by congestion level">
      <circle cx="80" cy="80" r={r} fill="none" stroke="var(--line)" strokeWidth="18" />
      {total > 0 &&
        parts.map((k) => {
          const len = (counts[k] / total) * circ;
          const el = (
            <circle key={k} cx="80" cy="80" r={r} fill="none" stroke={SEVERITY[k].color} strokeWidth="18"
              strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-offset} transform="rotate(-90 80 80)" />
          );
          offset += len;
          return el;
        })}
      <text x="80" y="78" textAnchor="middle" className="donut-num">{total}</text>
      <text x="80" y="98" textAnchor="middle" className="donut-label">roads</text>
    </svg>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const live = usePolling("/api/traffic/live", 5000);
  const incidents = usePolling("/api/incidents", 10000);
  const alerts = usePolling("/api/alerts?limit=200", 10000);
  const f15 = usePolling("/api/traffic/predicted?horizon=15", 15000);
  const f30 = usePolling("/api/traffic/predicted?horizon=30", 15000);
  const f45 = usePolling("/api/traffic/predicted?horizon=45", 15000);
  const f60 = usePolling("/api/traffic/predicted?horizon=60", 15000);

  const segments = live.data?.segments ?? [];
  const total = segments.length;
  const now = countLevels(segments.map(statusOf));
  const fresh = segments.filter((s) => !s.is_stale && s.speed_kmh != null);
  const avgRatio = fresh.length
    ? Math.round((fresh.reduce((a, s) => a + s.speed_kmh / s.speed_limit_kmh, 0) / fresh.length) * 100)
    : null;
  const openIncidents = incidents.data?.length ?? 0;
  const alertCount = alerts.data?.length ?? 0;
  const feedLive = total > 0 && fresh.length > 0;

  const forecast = [
    { label: "Now", counts: now },
    ...[["+15", f15], ["+30", f30], ["+45", f45], ["+60", f60]].map(([label, p]) => ({
      label,
      counts: countLevels(Object.values(p.data?.segments ?? {}).map((x) => x.severity)),
    })),
  ];

  const slowest = [...fresh]
    .sort((a, b) => a.speed_kmh / a.speed_limit_kmh - b.speed_kmh / b.speed_limit_kmh)
    .slice(0, 6);

  const firstName = user ? user.name.replace("Demo ", "") : null;

  return (
    <div className="page dash">
      <div className="dash-head">
        <div>
          <h1>{firstName ? `Welcome back, ${firstName}` : "Welcome to SmartFlow Rwanda"}</h1>
          <p className="muted">Kigali pilot corridors · live traffic overview</p>
        </div>
        <div className="btn-row">
          <span className={`live-pill ${feedLive ? "" : "off"}`}>
            <i /> {feedLive ? "Live" : "Data delayed"}
            {live.data ? ` · ${new Date(live.data.generated_at).toLocaleTimeString()}` : ""}
          </span>
          <Link to="/routes" className="btn">Plan a route <Icon name="arrow" size={16} /></Link>
        </div>
      </div>
      {live.error && <div className="alert error">Cannot reach the server: {live.error}</div>}

      <div className="kpi-row">
        <Link to="/map" className="card kpi">
          <span className="kpi-icon"><Icon name="road" /></span>
          <div><div className="kpi-num">{total}</div><div className="kpi-label">Roads monitored</div></div>
        </Link>
        <Link to="/map" className="card kpi">
          <span className="kpi-icon"><Icon name="speed" /></span>
          <div><div className="kpi-num">{avgRatio ?? "–"}<small>%</small></div><div className="kpi-label">Average speed vs limit</div></div>
        </Link>
        <Link to="/map" className="card kpi">
          <span className="kpi-icon warn"><Icon name="alert" /></span>
          <div><div className="kpi-num">{now.SEVERE}<small> / {total}</small></div><div className="kpi-label">Roads with severe congestion</div></div>
        </Link>
        <Link to="/map" className="card kpi">
          <span className="kpi-icon bad"><Icon name="incident" /></span>
          <div><div className="kpi-num">{openIncidents}</div><div className="kpi-label">Open incidents</div></div>
        </Link>
      </div>

      <div className="dash-grid">
        <section className="card status-card">
          <h2>System status</h2>
          <Link to="/map" className="status-row">
            <span className={`dot-live ${feedLive ? "" : "off"}`} />
            <strong>Traffic data feed</strong>
            <span className="muted">{feedLive ? "Active" : "Delayed"}</span>
            <Icon name="arrow" size={16} />
          </Link>
          <Link to="/map" className="status-row">
            <span className={`dot-live ${f30.data ? "" : "off"}`} />
            <strong>AI prediction</strong>
            <span className="muted">{f30.data ? "Active" : "Starting"}</span>
            <Icon name="arrow" size={16} />
          </Link>
          <Link to="/routes" className="status-row">
            <span className="dot-live" />
            <strong>Route planner</strong>
            <span className="muted">Active</span>
            <Icon name="arrow" size={16} />
          </Link>
          <Link to="/map" className="status-row">
            <span className={`dot-live ${alertCount ? "warn" : ""}`} />
            <strong>Alerts today</strong>
            <span className="muted">{alertCount}</span>
            <Icon name="arrow" size={16} />
          </Link>
        </section>

        <section className="card map-card">
          <Link to="/map" className="card-head">
            <h2>Live map</h2>
            <Icon name="arrow" size={16} />
          </Link>
          <div className="mini-map">
            <MapContainer center={[-1.955, 30.09]} zoom={12} zoomControl={false} dragging={false}
              scrollWheelZoom={false} doubleClickZoom={false} attributionControl={false} className="map">
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {segments.map((s) => (
                <Polyline key={s.id} positions={s.coordinates}
                  pathOptions={{ color: SEVERITY[statusOf(s)].color, weight: 5, opacity: 0.95 }} />
              ))}
            </MapContainer>
          </div>
        </section>

        <section className="card donut-card">
          <h2>Traffic right now</h2>
          <div className="donut-wrap">
            <Donut counts={now} total={total} />
            <ul className="donut-legend">
              {[...LEVELS, "STALE"].filter((k) => k !== "STALE" || now.STALE > 0).map((k) => (
                <li key={k}>
                  <i style={{ background: SEVERITY[k].color }} />
                  <span>{SEVERITY[k].label}</span>
                  <strong>{total ? Math.round((now[k] / total) * 100) : 0}%</strong>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="card forecast-card">
          <div className="card-head">
            <h2>AI forecast <span className="muted">next 60 minutes</span></h2>
          </div>
          <div className="stack-chart">
            {forecast.map((col) => {
              const n = LEVELS.reduce((a, k) => a + col.counts[k], 0) || 1;
              return (
                <div key={col.label} className="stack-col">
                  <div className="stack-bar">
                    {[...LEVELS].reverse().map((k) => (
                      <div key={k} title={`${SEVERITY[k].label}: ${col.counts[k]}`}
                        style={{ height: `${(col.counts[k] / n) * 100}%`, background: SEVERITY[k].color }} />
                    ))}
                  </div>
                  <span className="stack-label">{col.label}</span>
                </div>
              );
            })}
          </div>
          <p className="muted small">Share of monitored roads at each congestion level, now and as predicted by the AI model.</p>
        </section>

        <section className="card slow-card">
          <Link to="/map" className="card-head">
            <h2>Slowest roads now</h2>
            <Icon name="arrow" size={16} />
          </Link>
          {slowest.length === 0 ? (
            <p className="muted">Waiting for traffic data…</p>
          ) : (
            <ul className="slow-list">
              {slowest.map((s) => {
                const pct = Math.round((s.speed_kmh / s.speed_limit_kmh) * 100);
                return (
                  <li key={s.id}>
                    <div className="slow-top">
                      <span>{s.name}</span>
                      <strong>{s.speed_kmh} km/h</strong>
                    </div>
                    <div className="bar"><i style={{ width: `${pct}%`, background: SEVERITY[statusOf(s)].color }} /></div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}