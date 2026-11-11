import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// During development, calls to /api are forwarded to the FastAPI backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
