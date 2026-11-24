// Small helper for calling the backend. Adds the login token automatically.
const BASE = import.meta.env.VITE_API_URL || "";

export async function api(path, { method = "GET", body } = {}) {
  const token = localStorage.getItem("smartflow_token");
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  // Session expired (or the server restarted with a new key): log out and go to the login page.
  if (res.status === 401 && token && !path.startsWith("/api/auth/login")) {
    localStorage.removeItem("smartflow_token");
    localStorage.removeItem("smartflow_user");
    if (!window.location.pathname.startsWith("/login")) {
      window.location.assign("/login?expired=1");
    }
    throw new Error("Your session has expired. Please log in again.");
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      message = (await res.json()).detail || message;
    } catch {
      /* response had no JSON body */
    }
    throw new Error(message);
  }
  return res.json();
}