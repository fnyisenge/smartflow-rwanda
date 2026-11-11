import { Link, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { ROLE_LABELS, useAuth } from "./auth.jsx";
import LiveMap from "./pages/LiveMap.jsx";
import Login from "./pages/Login.jsx";
import ControlRoom from "./pages/ControlRoom.jsx";
import AuditLog from "./pages/AuditLog.jsx";
import ComingSoon from "./pages/ComingSoon.jsx";

// Which pages each role can open (FR 8.2). The backend enforces the same rules.
const NAV = [
  { to: "/", label: "Live Map", roles: null },
  { to: "/routes", label: "My Routes", roles: ["COMMUTER"] },
  { to: "/emergency", label: "Emergency Routing", roles: ["EMERGENCY"] },
  { to: "/control", label: "Control Room", roles: ["OFFICER", "ADMIN"] },
  { to: "/reports", label: "Reports", roles: ["ANALYST", "ADMIN"] },
  { to: "/audit", label: "Audit Log", roles: ["ADMIN"] },
];

function Protected({ roles, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user, logout } = useAuth();
  const links = NAV.filter((n) => n.roles === null || (user && n.roles.includes(user.role)));

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true" />
          SmartFlow <span className="brand-light">Rwanda</span>
        </Link>
        <nav>
          {links.map((n) => (
            <NavLink key={n.to} to={n.to} end className="navlink">
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="session">
          {user ? (
            <>
              <span className="role-chip">{ROLE_LABELS[user.role]}</span>
              <button className="btn-ghost" onClick={logout}>Log out</button>
            </>
          ) : (
            <Link to="/login" className="btn">Log in</Link>
          )}
        </div>
      </header>

      <main className="content">
        <Routes>
          <Route path="/" element={<LiveMap />} />
          <Route path="/login" element={<Login />} />
          <Route path="/routes" element={<Protected roles={["COMMUTER"]}><ComingSoon title="My Routes & Alerts" day="Day 5" reqs="FR 4, FR 10.1" text="Save your usual trips (e.g. Kimironko → CBD) and get recommended alternative routes plus alerts when congestion is detected or predicted on them." /></Protected>} />
          <Route path="/emergency" element={<Protected roles={["EMERGENCY"]}><ComingSoon title="Emergency Routing" day="Day 5" reqs="FR 6, NFR 5, NFR 7" text="Choose an origin and destination to get the least congested route, its estimated time, and a warning if the traffic data is outdated." /></Protected>} />
          <Route path="/control" element={<Protected roles={["OFFICER", "ADMIN"]}><ControlRoom /></Protected>} />
          <Route path="/reports" element={<Protected roles={["ANALYST", "ADMIN"]}><ComingSoon title="Traffic Reports" day="Day 6" reqs="FR 7.2, NFR 19" text="Congestion trends by corridor and hour, plus how accurate the AI predictions were compared with what actually happened." /></Protected>} />
          <Route path="/audit" element={<Protected roles={["ADMIN"]}><AuditLog /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
