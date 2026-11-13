import { useState } from "react";
import { usePolling } from "../usePolling.js";

function downloadCsv(name, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Reports() {
  const [hours, setHours] = useState(24);
  const { data, error } = usePolling(`/api/reports/summary?hours=${hours}`, 15000);

  if (error) return <div className="page"><div className="alert error">{error}</div></div>;
  if (!data) return <div className="page"><p className="muted">Loading report…</p></div>;

  const t = data.totals;
  const maxMinutes = Math.max(1, ...data.corridors.map((c) => c.total_minutes));
  const pred = data.prediction;

  return (
    <div className="page">
      <div className="row">
        <h1>Traffic report</h1>
        <div className="btn-row">
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} style={{ width: "auto" }}>
            <option value={1}>Last hour</option>
            <option value={6}>Last 6 hours</option>
            <option value={24}>Last 24 hours</option>
            <option value={168}>Last 7 days</option>
          </select>
          <button className="btn-ghost" onClick={() => window.print()}>Print / save as PDF</button>
        </div>
      </div>

      <div className="stat-row">
        {[
          ["Readings stored", t.readings],
          ["Invalid readings rejected", t.rejected],
          ["Congestion events", t.congestion_events],
          ["Severe events", t.severe_events],
          ["Incidents", t.incidents],
        ].map(([label, value]) => (
          <div key={label} className="card stat-card">
            <div className="stat-num">{value}</div>
            <div className="stat-label">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid">
        <section className="card span-2">
          <div className="row">
            <h2>Congestion by corridor</h2>
            <button className="btn-ghost btn-sm" onClick={() => downloadCsv("congestion-by-corridor.csv", [["Corridor", "Events", "Severe events", "Total minutes"], ...data.corridors.map((c) => [c.corridor, c.events, c.severe, c.total_minutes])])}>
              Download CSV
            </button>
          </div>
          {data.corridors.length ? (
            <table>
              <thead><tr><th>Corridor</th><th>Events</th><th>Severe</th><th>Congested minutes</th></tr></thead>
              <tbody>
                {data.corridors.map((c) => (
                  <tr key={c.corridor}>
                    <td>{c.corridor}</td>
                    <td>{c.events}</td>
                    <td>{c.severe}</td>
                    <td>
                      <div className="bar"><i style={{ width: `${(c.total_minutes / maxMinutes) * 100}%` }} /></div>
                      <span className="small">{c.total_minutes} min</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No congestion in this period.</p>}
        </section>

        <section className="card">
          <h2>AI prediction accuracy</h2>
          <p className="muted small">
            Model: {pred.model_version}. Offline test error on simulated data: {pred.model_info?.test_mae_ratio ?? "…"} (share of speed limit).
          </p>
          <table>
            <thead><tr><th>Horizon</th><th>Checked</th><th>Accuracy</th><th>Avg error</th></tr></thead>
            <tbody>
              {pred.by_horizon.map((h) => (
                <tr key={h.horizon_min}>
                  <td>+{h.horizon_min} min</td>
                  <td>{h.evaluated}</td>
                  <td>{h.accuracy_pct === null ? "—" : `${h.accuracy_pct}%`}</td>
                  <td>{h.mae_ratio === null ? "—" : h.mae_ratio}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            Accuracy = predicted congestion level matched the actual level once the time arrived. "Avg error" is the speed difference as a share of the speed limit.
          </p>
        </section>

        <section className="card span-3">
          <div className="row">
            <h2>Average speed by road (slowest first)</h2>
            <button className="btn-ghost btn-sm" onClick={() => downloadCsv("average-speed-by-road.csv", [["Road", "Avg speed km/h", "Speed limit km/h", "Ratio"], ...data.segments.map((s) => [s.name, s.avg_speed_kmh, s.speed_limit_kmh, s.avg_ratio])])}>
              Download CSV
            </button>
          </div>
          <table>
            <thead><tr><th>Road</th><th>Avg speed</th><th>Limit</th><th>% of limit</th></tr></thead>
            <tbody>
              {data.segments.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.avg_speed_kmh} km/h</td>
                  <td>{s.speed_limit_kmh} km/h</td>
                  <td>
                    <div className="bar"><i style={{ width: `${Math.min(100, s.avg_ratio * 100)}%` }} /></div>
                    <span className="small">{Math.round(s.avg_ratio * 100)}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
