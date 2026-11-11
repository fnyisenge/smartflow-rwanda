import { useState } from "react";
import { api } from "../api.js";
import { usePolling } from "../usePolling.js";
import { SEVERITY } from "./LiveMap.jsx";

// Traffic officer dashboard. Alerts, incidents and signal recommendations are added on Day 6.
export default function ControlRoom() {
  const { data: events } = usePolling("/api/congestion/active", 5000);
  const { data: rejected } = usePolling("/api/readings/rejected?limit=8", 5000);
  const { data: sim } = usePolling("/api/simulator", 5000);
  const [message, setMessage] = useState("");

  async function setHour(hour, label) {
    const body = hour === null ? { clear_hour_override: true } : { hour_override: hour };
    try {
      await api("/api/simulator", { method: "POST", body });
      setMessage(hour === null ? "Simulator now follows real Kigali time." : `Simulating ${label} traffic.`);
    } catch (e) {
      setMessage(e.message);
    }
  }

  return (
    <div className="page">
      <h1>Control Room</h1>
      <div className="grid">
        <section className="card span-2">
          <h2>Active congestion ({events?.length ?? 0})</h2>
          {events?.length ? (
            <table>
              <thead>
                <tr><th>Road</th><th>Severity</th><th>Ongoing</th></tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id}>
                    <td>{e.segment_name}</td>
                    <td>
                      <span className="badge" style={{ background: SEVERITY[e.severity].color }}>
                        {e.severity}
                      </span>
                    </td>
                    <td>{e.minutes_ongoing} min</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No congestion right now.</p>
          )}
        </section>

        <section className="card">
          <h2>Demo controls</h2>
          <p className="muted small">
            Simulated hour: <strong>{sim?.simulated_hour ?? "…"}</strong>
            {sim?.hour_override == null ? " (real Kigali time)" : " (override)"}
          </p>
          <div className="btn-row">
            <button className="btn-ghost" onClick={() => setHour(8, "morning rush (08:00)")}>Morning rush</button>
            <button className="btn-ghost" onClick={() => setHour(13, "midday (13:00)")}>Midday</button>
            <button className="btn-ghost" onClick={() => setHour(17.75, "evening rush (17:45)")}>Evening rush</button>
            <button className="btn-ghost" onClick={() => setHour(23, "night (23:00)")}>Night</button>
            <button className="btn-ghost" onClick={() => setHour(null)}>Real time</button>
          </div>
          {message && <p className="small">{message}</p>}
          <p className="muted small">
            Active simulated incidents: {sim?.active_incidents?.length ? sim.active_incidents.join(", ") : "none"}
          </p>
        </section>

        <section className="card span-3">
          <h2>Rejected readings (data validation, FR 1.2)</h2>
          {rejected?.length ? (
            <table>
              <thead>
                <tr><th>Time</th><th>Reason</th><th>Raw record</th></tr>
              </thead>
              <tbody>
                {rejected.map((r) => (
                  <tr key={r.id}>
                    <td>{new Date(r.timestamp).toLocaleTimeString()}</td>
                    <td>{r.reason}</td>
                    <td><code>{r.raw_data}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No invalid records yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
