import { useState } from "react";
import { api } from "../api.js";
import { usePolling } from "../usePolling.js";
import { SEVERITY } from "./LiveMap.jsx";

const INCIDENT_TYPES = ["Accident", "Road blockage", "Breakdown", "Flooding", "Event / crowd", "Other"];
const SCENARIOS = [
  ["Morning rush", 8],
  ["Midday", 13],
  ["Evening rush", 17.75],
  ["Night", 23],
];
const time = (iso) => new Date(iso).toLocaleTimeString();
const fmtHour = (h) =>
  `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;

export default function ControlRoom() {
  const alerts = usePolling("/api/alerts?limit=10", 5000);
  const events = usePolling("/api/congestion/active", 5000);
  const signals = usePolling("/api/signals", 5000);
  const incidents = usePolling("/api/incidents?include_resolved=true", 5000);
  const emergencies = usePolling("/api/emergency/requests", 5000);
  const actions = usePolling("/api/actions", 8000);
  const rejected = usePolling("/api/readings/rejected?limit=6", 8000);
  const sim = usePolling("/api/simulator", 4000);
  const live = usePolling("/api/traffic/live", 60000);

  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ segment_id: "", type: INCIDENT_TYPES[0], description: "" });
  const [speed, setSpeed] = useState(1);

  async function run(path, options, ...reloads) {
    try {
      await api(path, options);
      reloads.forEach((r) => r());
      setMessage("");
    } catch (e) {
      setMessage(e.message);
    }
  }

  function addIncident(e) {
    e.preventDefault();
    if (!form.segment_id) {
      setMessage("Choose the road where the incident happened.");
      return;
    }
    run("/api/incidents", { method: "POST", body: form }, incidents.reload, actions.reload);
    setForm({ ...form, description: "" });
  }

  const unack = alerts.data?.filter((a) => !a.acknowledged).length ?? 0;

  return (
    <div className="page">
      <h1>Control Room</h1>
      {message && <div className="alert error">{message}</div>}

      <div className="grid">
        <section className="card span-2">
          <h2>Alerts ({unack} unacknowledged)</h2>
          {alerts.data?.length ? (
            <table>
              <thead><tr><th>Time</th><th>Type</th><th>Alert</th><th></th></tr></thead>
              <tbody>
                {alerts.data.map((a) => (
                  <tr key={a.id}>
                    <td>{time(a.created_at)}</td>
                    <td><span className="badge" style={{ background: SEVERITY[a.severity].color }}>{a.kind}</span></td>
                    <td>{a.message}</td>
                    <td>
                      {a.acknowledged ? <span className="muted small">acknowledged</span> : (
                        <button className="btn-ghost btn-sm" onClick={() => run(`/api/alerts/${a.id}/acknowledge`, { method: "POST" }, alerts.reload, actions.reload)}>
                          Acknowledge
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No alerts yet.</p>}
        </section>

        <section className="card">
          <h2>Demo controls</h2>
          <p className="muted small">
            Simulated time: <strong>{sim.data ? fmtHour(sim.data.simulated_hour) : "…"}</strong>{" "}
            ({sim.data?.mode === "real" ? "real Kigali time" : `demo, ${sim.data?.speed}x`}
            {sim.data && !sim.data.running ? ", PAUSED" : ""})
          </p>
          <label>
            Clock speed
            <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              <option value={1}>Normal (1x)</option>
              <option value={10}>Fast (10x)</option>
              <option value={60}>Very fast (60x): see prediction accuracy quickly</option>
            </select>
          </label>
          <div className="btn-row">
            {SCENARIOS.map(([label, hour]) => (
              <button key={label} className="btn-ghost" onClick={() => run("/api/simulator", { method: "POST", body: { hour, speed } }, sim.reload)}>
                {label}
              </button>
            ))}
            <button className="btn-ghost" onClick={() => run("/api/simulator", { method: "POST", body: { real_time: true } }, sim.reload)}>Real time</button>
            <button className="btn-ghost" onClick={() => run("/api/simulator", { method: "POST", body: { running: !sim.data?.running } }, sim.reload)}>
              {sim.data?.running === false ? "Resume data" : "Pause data"}
            </button>
          </div>
          <p className="muted small">Pause the data for ~40 s to see roads turn grey ("data outdated").</p>
        </section>

        <section className="card span-2">
          <h2>Signal recommendations</h2>
          <p className="muted small">
            Advisory only. SmartFlow never changes traffic signals by itself; approved plans must be applied through the authorised traffic-control system.
          </p>
          {signals.data?.length ? (
            <table>
              <thead><tr><th>Where</th><th>Suggested plan</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {signals.data.map((s) => (
                  <tr key={s.id}>
                    <td><strong>{s.intersection}</strong><div className="muted small">{s.segment_name}</div></td>
                    <td>{s.suggested_plan}<div className="muted small">{s.reason}</div></td>
                    <td>
                      <span className="badge" style={{ background: s.status === "APPROVED" ? "#1f9d55" : s.status === "REJECTED" ? "#9aa1ab" : "#e8a317" }}>{s.status}</span>
                      {s.status === "PENDING" && !s.event_active && <div className="muted small">congestion cleared</div>}
                    </td>
                    <td>
                      {s.status === "PENDING" && (
                        <div className="btn-row">
                          <button className="btn btn-sm" onClick={() => run(`/api/signals/${s.id}/review`, { method: "POST", body: { approve: true } }, signals.reload, actions.reload)}>Approve</button>
                          <button className="btn-ghost btn-sm" onClick={() => run(`/api/signals/${s.id}/review`, { method: "POST", body: { approve: false } }, signals.reload, actions.reload)}>Reject</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No recommendations yet. They appear when severe congestion is detected.</p>}
        </section>

        <section className="card">
          <h2>Record an incident</h2>
          <form onSubmit={addIncident}>
            <label>
              Road
              <select value={form.segment_id} onChange={(e) => setForm({ ...form, segment_id: e.target.value })}>
                <option value="">Choose…</option>
                {live.data?.segments.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>
              Type
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {INCIDENT_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </label>
            <label>
              Description
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </label>
            <button className="btn">Record incident</button>
          </form>
        </section>

        <section className="card span-3">
          <h2>Incidents</h2>
          {incidents.data?.length ? (
            <table>
              <thead><tr><th>Reported</th><th>Road</th><th>Type</th><th>Description</th><th>Status</th></tr></thead>
              <tbody>
                {incidents.data.map((i) => (
                  <tr key={i.id}>
                    <td>{time(i.reported_at)}</td>
                    <td>{i.segment_name}</td>
                    <td>{i.type}</td>
                    <td>{i.description}</td>
                    <td>
                      <select value={i.status} onChange={(e) => run(`/api/incidents/${i.id}`, { method: "PATCH", body: { status: e.target.value } }, incidents.reload, actions.reload)}>
                        <option value="REPORTED">REPORTED</option>
                        <option value="IN_PROGRESS">IN_PROGRESS</option>
                        <option value="RESOLVED">RESOLVED</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No incidents recorded.</p>}
        </section>

        <section className="card span-2">
          <h2>Emergency requests</h2>
          {emergencies.data?.length ? (
            <table>
              <thead><tr><th>Time</th><th>From → To</th><th>By</th><th>ETA</th><th>Data</th></tr></thead>
              <tbody>
                {emergencies.data.map((r) => (
                  <tr key={r.id}>
                    <td>{time(r.requested_at)}</td>
                    <td>{r.origin} → {r.destination}<div className="muted small">{r.description}</div></td>
                    <td>{r.by}</td>
                    <td>{r.estimated_minutes} min</td>
                    <td>{r.data_fresh ? "fresh" : "outdated"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No emergency requests yet.</p>}
        </section>

        <section className="card">
          <h2>Active congestion ({events.data?.length ?? 0})</h2>
          {events.data?.length ? (
            <table>
              <tbody>
                {events.data.slice(0, 8).map((e) => (
                  <tr key={e.id}>
                    <td>{e.segment_name}</td>
                    <td><span className="badge" style={{ background: SEVERITY[e.severity].color }}>{e.severity}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No congestion right now.</p>}
        </section>

        <section className="card span-2">
          <h2>Management actions log</h2>
          {actions.data?.length ? (
            <table>
              <thead><tr><th>Time</th><th>Officer</th><th>Action</th><th>Notes</th></tr></thead>
              <tbody>
                {actions.data.map((a) => (
                  <tr key={a.id}><td>{time(a.taken_at)}</td><td>{a.user}</td><td>{a.action_type}</td><td>{a.notes}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No actions recorded yet.</p>}
        </section>

        <section className="card">
          <h2>Rejected readings</h2>
          {rejected.data?.length ? (
            <table>
              <tbody>
                {rejected.data.map((r) => (
                  <tr key={r.id}><td>{time(r.timestamp)}</td><td>{r.reason}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No invalid records yet.</p>}
        </section>
      </div>
    </div>
  );
}
