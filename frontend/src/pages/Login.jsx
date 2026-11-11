import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ROLE_LABELS, useAuth } from "../auth.jsx";

const DEMO_PASSWORD = "SmartFlow2026!";
const DEMO_ACCOUNTS = [
  ["COMMUTER", "commuter@smartflow.rw"],
  ["EMERGENCY", "emergency@smartflow.rw"],
  ["OFFICER", "officer@smartflow.rw"],
  ["ANALYST", "analyst@smartflow.rw"],
  ["ADMIN", "admin@smartflow.rw"],
];

const HOME_FOR_ROLE = {
  COMMUTER: "/",
  EMERGENCY: "/emergency",
  OFFICER: "/control",
  ANALYST: "/reports",
  ADMIN: "/control",
};

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const user = await login(email, password);
      navigate(HOME_FOR_ROLE[user.role] || "/");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit}>
        <h1>Log in</h1>
        <p className="muted">Commuters can view the live map without an account.</p>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <div className="alert error">{error}</div>}
        <button className="btn" disabled={busy}>{busy ? "Logging in…" : "Log in"}</button>

        <div className="demo-box">
          <div className="small muted">Demo accounts (prototype only) — click to fill in:</div>
          {DEMO_ACCOUNTS.map(([role, mail]) => (
            <button
              type="button"
              key={role}
              className="demo-btn"
              onClick={() => {
                setEmail(mail);
                setPassword(DEMO_PASSWORD);
              }}
            >
              {ROLE_LABELS[role]}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
