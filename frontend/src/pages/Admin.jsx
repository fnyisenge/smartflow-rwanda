import { useEffect, useState } from "react";
import { api } from "../api.js";
import { ROLE_LABELS, useAuth } from "../auth.jsx";
import { usePolling } from "../usePolling.js";

export default function Admin() {
  const { user: me } = useAuth();
  const users = usePolling("/api/users", 15000);
  const sources = usePolling("/api/sources", 15000);
  const [th, setTh] = useState({ moderate: 60, severe: 35 });
  const [message, setMessage] = useState("");

  useEffect(() => {
    api("/api/config/thresholds")
      .then((t) => setTh({ moderate: Math.round(t.moderate * 100), severe: Math.round(t.severe * 100) }))
      .catch(() => {});
  }, []);

  async function run(path, options, reload, okText) {
    try {
      await api(path, options);
      if (reload) reload();
      setMessage(okText || "");
    } catch (e) {
      setMessage(e.message);
    }
  }

  return (
    <div className="page">
      <h1>Administration</h1>
      {message && <div className="alert warn">{message}</div>}

      <div className="grid">
        <section className="card span-3">
          <h2>Users and roles</h2>
          <table>
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th>Last login</th></tr></thead>
            <tbody>
              {users.data?.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>
                    <select value={u.role} disabled={u.id === me.id}
                      onChange={(e) => run(`/api/users/${u.id}`, { method: "PATCH", body: { role: e.target.value } }, users.reload, "Role updated.")}>
                      {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td>
                    <input type="checkbox" checked={u.is_active} disabled={u.id === me.id}
                      onChange={(e) => run(`/api/users/${u.id}`, { method: "PATCH", body: { is_active: e.target.checked } }, users.reload, "Account updated.")} />
                  </td>
                  <td>{u.last_login ? new Date(u.last_login).toLocaleString() : "never"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card span-2">
          <h2>Data sources</h2>
          <table>
            <thead><tr><th>Source</th><th>Type</th><th>Last data</th><th>Active</th></tr></thead>
            <tbody>
              {sources.data?.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.source_type}</td>
                  <td>{s.last_received ? new Date(s.last_received + (s.last_received.endsWith("Z") || s.last_received.includes("+") ? "" : "Z")).toLocaleTimeString() : "—"}</td>
                  <td>
                    <input type="checkbox" checked={s.is_active}
                      onChange={(e) => run(`/api/sources/${s.id}`, { method: "PATCH", body: { is_active: e.target.checked } }, sources.reload, "Data source updated.")} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">Switch one source off: the others keep the map working (NFR 13).</p>
        </section>

        <section className="card">
          <h2>Congestion thresholds</h2>
          <p className="muted small">A road is congested when its speed falls below this % of its speed limit.</p>
          <label>
            Moderate below (%)
            <input type="number" min="1" max="99" value={th.moderate} onChange={(e) => setTh({ ...th, moderate: Number(e.target.value) })} />
          </label>
          <label>
            Severe below (%)
            <input type="number" min="1" max="99" value={th.severe} onChange={(e) => setTh({ ...th, severe: Number(e.target.value) })} />
          </label>
          <button className="btn"
            onClick={() => run("/api/config/thresholds", { method: "PUT", body: { moderate: th.moderate / 100, severe: th.severe / 100 } }, null, "Thresholds saved.")}>
            Save thresholds
          </button>
        </section>
      </div>
    </div>
  );
}
