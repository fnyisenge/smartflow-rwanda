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
