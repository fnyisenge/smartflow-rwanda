import { createContext, useContext, useState } from "react";
import { api } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("smartflow_user");
    return saved ? JSON.parse(saved) : null;
  });

  async function login(email, password) {
    const data = await api("/api/auth/login", { method: "POST", body: { email, password } });
    localStorage.setItem("smartflow_token", data.token);
    localStorage.setItem("smartflow_user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }

  function logout() {
    localStorage.removeItem("smartflow_token");
    localStorage.removeItem("smartflow_user");
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, login, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

export const ROLE_LABELS = {
  COMMUTER: "Commuter / Driver",
  EMERGENCY: "Emergency Services",
  OFFICER: "Traffic Officer",
  ANALYST: "Urban Planner",
  ADMIN: "Administrator",
};
