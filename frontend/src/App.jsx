import { Link, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { ROLE_LABELS, useAuth } from "./auth.jsx";
import LiveMap from "./pages/LiveMap.jsx";
import Login from "./pages/Login.jsx";
import RoutePlanner from "./pages/RoutePlanner.jsx";
import ControlRoom from "./pages/ControlRoom.jsx";
import Reports from "./pages/Reports.jsx";
import Admin from "./pages/Admin.jsx";
import AuditLog from "./pages/AuditLog.jsx";

// Which pages each role can open (FR 8.2). The backend enforces the same rules.
const NAV = [
  { to: "/", label: "Live Map", roles: null },
  { to: "/routes", label: "Route Planner", roles: null },
  { to: "/emergency", label: "Emergency Routing", roles: ["EMERGENCY", "OFFICER", "ADMIN"] },
  { to: "/control", label: "Control Room", roles: ["OFFICER", "ADMIN"] },
  { to: "/reports", label: "Reports", roles: ["ANALYST", "OFFICER", "ADMIN"] },
  { to: "/admin", label: "Admin", roles: ["ADMIN"] },
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
          <Route path="/routes" element={<RoutePlanner />} />
          <Route path="/emergency" element={<Protected roles={["EMERGENCY", "OFFICER", "ADMIN"]}><RoutePlanner key="emergency" emergency /></Protected>} />
          <Route path="/control" element={<Protected roles={["OFFICER", "ADMIN"]}><ControlRoom /></Protected>} />
          <Route path="/reports" element={<Protected roles={["ANALYST", "OFFICER", "ADMIN"]}><Reports /></Protected>} />
          <Route path="/admin" element={<Protected roles={["ADMIN"]}><Admin /></Protected>} />
          <Route path="/audit" element={<Protected roles={["ADMIN"]}><AuditLog /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
