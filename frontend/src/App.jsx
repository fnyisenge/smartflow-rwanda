import { Link, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { ROLE_LABELS, useAuth } from "./auth.jsx";
import Icon from "./icons.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import LiveMap from "./pages/LiveMap.jsx";
import Login from "./pages/Login.jsx";
import RoutePlanner from "./pages/RoutePlanner.jsx";
import ControlRoom from "./pages/ControlRoom.jsx";
import Reports from "./pages/Reports.jsx";
import Admin from "./pages/Admin.jsx";
import AuditLog from "./pages/AuditLog.jsx";

// Which pages each role can open (FR 8.2). The backend enforces the same rules.
const NAV = [
  { to: "/", label: "Dashboard", icon: "dashboard", roles: null },
  { to: "/map", label: "Live Map", icon: "map", roles: null },
  { to: "/routes", label: "Route Planner", icon: "route", roles: null },
  { to: "/emergency", label: "Emergency Routing", icon: "emergency", roles: ["EMERGENCY", "OFFICER", "ADMIN"] },
  { to: "/control", label: "Control Room", icon: "control", roles: ["OFFICER", "ADMIN"] },
  { to: "/reports", label: "Reports", icon: "reports", roles: ["ANALYST", "OFFICER", "ADMIN"] },
  { to: "/admin", label: "Admin", icon: "admin", roles: ["ADMIN"] },
  { to: "/audit", label: "Audit Log", icon: "audit", roles: ["ADMIN"] },
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
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="side-brand">
          <span className="side-logo" aria-hidden="true">
            <Icon name="road" size={22} />
          </span>
          <span>
            SmartFlow<small>Rwanda</small>
          </span>
        </Link>

        <nav className="side-nav">
          {links.map((n) => (
            <NavLink key={n.to} to={n.to} end className="side-link">
              <Icon name={n.icon} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="side-footer">
          {user ? (
            <>
              <div className="side-user">
                <span className="avatar">{user.name.split(" ").pop().charAt(0)}</span>
                <span>
                  <strong>{user.name.replace("Demo ", "")}</strong>
                  <small>{ROLE_LABELS[user.role]}</small>
                </span>
              </div>
              <button className="side-link side-button" onClick={logout}>
                <Icon name="logout" />
                <span>Log out</span>
              </button>
            </>
          ) : (
            <NavLink to="/login" className="side-link">
              <Icon name="login" />
              <span>Log in</span>
            </NavLink>
          )}
        </div>
      </aside>

      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/map" element={<LiveMap />} />
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