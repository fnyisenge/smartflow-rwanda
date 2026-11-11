# SmartFlow Rwanda — AI-Powered Intelligent Traffic Management (Prototype)

SmartFlow Rwanda monitors traffic on selected Kigali corridors, detects congestion,
and (in upcoming sprints) predicts congestion with AI, recommends alternative and
emergency routes, and supports traffic officers' decisions.

**Author:** Nyisenge Heureuse Faustine — African Leadership University

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, React Router, Leaflet + OpenStreetMap |
| Backend | Python, FastAPI, SQLModel |
| Database | SQLite (prototype) — can switch to PostgreSQL via `DATABASE_URL` |
| Auth | JWT tokens with role-based access control |
| Data | Built-in Kigali traffic simulator (rush hours, incidents, faulty records) |

## Features so far (Sprint 1)

| Feature | Requirements |
|---|---|
| Simulated traffic data from GPS, sensor and camera sources every 5 seconds | FR 1, FR 1.1 |
| Validation: broken records are rejected and logged, never used | FR 1.2 |
| Live map of 15 road segments coloured by congestion, auto-refresh | FR 2, NFR 1 |
| Congestion detection with configurable thresholds; congestion events opened/closed | FR 3.1 |
| Historical readings stored | FR 7.1 |
| Login for 5 roles; pages and API restricted by role | FR 8, NFR 8, NFR 9 |
| Audit log of logins and control actions | NFR 12 |
| "Data outdated" warnings when readings are more than 30 s old | NFR 7 |
| Advisory notice on travel times | NFR 5 |

## How to run it

You need **Python 3.10+** and **Node.js 18+**. Check with `python --version` and `node --version`.

### 1. Backend (terminal 1)

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Mac/Linux:
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --reload
```

The API runs at http://localhost:8000. Interactive API docs: http://localhost:8000/docs

### 2. Frontend (terminal 2)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173

### Demo accounts

All use the password `SmartFlow2026!` (the login page has one-click buttons).

| Role | Email |
|---|---|
| Commuter / Driver | commuter@smartflow.rw |
| Emergency Services | emergency@smartflow.rw |
| Traffic Officer | officer@smartflow.rw |
| Urban Planner | analyst@smartflow.rw |
| Administrator | admin@smartflow.rw |

### Demo tip

Log in as the Traffic Officer, open **Control Room**, and click **Morning rush** or
**Evening rush** to see congestion build up on the map, whatever the real time is.

## Project structure

```
backend/app/
  main.py         API routes
  models.py       database tables (from the UML class diagram)
  auth.py         passwords, JWT tokens, role checks
  processing.py   validation + congestion detection
  simulator.py    Kigali traffic simulator
  seed.py         road network, data sources, demo users
frontend/src/
  App.jsx         navigation + role-protected routes
  pages/          LiveMap, Login, ControlRoom, AuditLog, ComingSoon
```

## Notes

- Road positions are approximate points for well-known Kigali areas joined by straight lines.
- To reset all data, stop the backend and delete `backend/smartflow.db`.

## Roadmap

- Day 4: AI congestion prediction (+15 / +30 min) and accuracy tracking (FR 3.2, NFR 19)
- Day 5: Alternative and emergency route recommendations (FR 4, FR 6)
- Day 6: Alerts, incident management, signal recommendations with officer approval, reports (FR 5, FR 7.2, FR 9, FR 10, NFR 6)
- Day 7: Polish, deploy, demo
