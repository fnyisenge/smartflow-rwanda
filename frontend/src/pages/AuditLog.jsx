import { usePolling } from "../usePolling.js";

export default function AuditLog() {
  const { data, error } = usePolling("/api/audit?limit=100", 10000);
  return (
    <div className="page">
      <h1>Audit log</h1>
      <p className="muted">Significant actions are recorded for accountability (NFR 12).</p>
      {error && <div className="alert error">{error}</div>}
      <section className="card">
        <table>
          <thead>
            <tr><th>Time</th><th>User ID</th><th>Action</th><th>Details</th></tr>
          </thead>
          <tbody>
            {data?.map((a) => (
              <tr key={a.id}>
                <td>{new Date(a.timestamp).toLocaleString()}</td>
                <td>{a.user_id ?? "—"}</td>
                <td>{a.action}</td>
                <td><code>{a.details}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
