import { useCallback, useEffect, useState } from "react";
import { api } from "./api.js";

// Fetches `path` now and every `ms` milliseconds. Pass null to skip. Call reload() to refresh right away.
export function usePolling(path, ms = 5000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!path) {
      setData(null);
      return undefined;
    }
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
  }, [path, ms, version]);

  return { data, error, reload };
}
