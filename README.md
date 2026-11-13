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

## Features

| Feature | Requirements |
|---|---|
| Simulated traffic data from GPS, sensor and camera sources every 5 seconds | FR 1, FR 1.1 |
| Validation: broken records are rejected and logged, never used | FR 1.2 |
| Live map of 15 Kigali road segments coloured by congestion, auto-refresh | FR 2, NFR 1 |
| Congestion detection with admin-configurable thresholds | FR 3.1 |
| AI congestion prediction (random forest) with a +15/+30/+45/+60 min timeline slider | FR 3.2 |
| Prediction accuracy tracked against what actually happened | NFR 19 |
| Fastest and alternative routes, now or using the AI forecast; saved routes with alerts | FR 4, FR 10 |
| Emergency routing with ETA; officers are notified | FR 6 |
| Alerts for detected and predicted congestion; officers acknowledge them | FR 5.1, FR 10 |
| Signal-timing recommendations that an officer must approve or reject | FR 5.2, NFR 6 |
| Incident recording and status updates, shown on the map | FR 9 |
| Reports by corridor and road, CSV download, print to PDF | FR 7 |
| Login for 5 roles; pages and API restricted by role; admin user management | FR 8, NFR 8, NFR 9 |
| Audit log and management-actions log | NFR 12 |
| "Data outdated" warnings on the map and on routes | NFR 7 |
| Advisory notices on travel times and routes | NFR 5 |

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
python -m uvicorn app.main:app --reload
```

The API runs at http://localhost:8000. Interactive API docs: http://localhost:8000/docs

### 2. Frontend (terminal 2)

```bash
cd frontend
npm install      # on Windows PowerShell: npm.cmd install
npm run dev      # on Windows PowerShell: npm.cmd run dev
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
Choose clock speed **Very fast (60x)** to fill the AI accuracy table in Reports within a few minutes.

## Project structure

```
backend/app/
  main.py         API routes
  prediction.py   AI congestion prediction + accuracy tracking
  routing.py      fastest/alternative/emergency routes (Dijkstra)
  alerts.py       alerts + signal recommendations
  models.py       database tables (from the UML class diagram)
  auth.py         passwords, JWT tokens, role checks
  processing.py   validation + congestion detection
  simulator.py    Kigali traffic simulator
  seed.py         road network, data sources, demo users
frontend/src/
  App.jsx         navigation + role-protected routes
  pages/          LiveMap, RoutePlanner, ControlRoom, Reports, Admin, AuditLog, Login
```

## Notes

- Road positions are approximate points for well-known Kigali areas joined by straight lines.
- To reset all data, stop the backend and delete `backend/smartflow.db`.
