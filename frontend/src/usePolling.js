import { useEffect, useState } from "react";
import { api } from "./api.js";

// Fetches `path` now and every `ms` milliseconds (live updates, NFR 1).
export function usePolling(path, ms = 5000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await api(path);
        if (active) {
          setData(result);
          setError(null);
        }
      } catch (e) {
        if (active) setError(e.message);
      }
    }
    load();
    const id = setInterval(load, ms);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [path, ms]);

  return { data, error };
}
