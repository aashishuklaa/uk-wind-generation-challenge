# UK Wind Generation Challenge

A small full-stack dashboard for comparing Great Britain wind generation with
Elexon's rolling wind generation forecast. A Python data-fetch script downloads
the latest available settlement-day data into CSV files, a FastAPI service
exposes those files as JSON, and a React/Vite dashboard plots actuals and
forecasts and summarizes forecast accuracy.

## Project architecture

```text
Elexon BMRS API
      |
      v
fetch_data.py
  |             |
  v             v
historical_   forecast_
data.csv      data.csv
  |             |
  +------> main.py (FastAPI)
                |                 ^
                | JSON            | Axios
                v                 |
           React/Vite dashboard (frontend/)
```

The CSV files are the local data store. The API reads them when each request
arrives; the frontend does not call Elexon directly.

## Files and directories

| Path | Purpose |
|---|---|
| `fetch_data.py` | Downloads wind actuals (`FUELHH`) and wind forecasts (`WINDFOR`) from Elexon BMRS, aligns them to the latest settlement date, and writes the two CSV files. |
| `main.py` | Defines the FastAPI application and JSON endpoints for historical and forecast records. |
| `historical_data.csv` | Half-hourly actual WIND generation records for the latest settlement date retrieved. |
| `forecast_data.csv` | Hourly rolling WIND forecast records for that same settlement date. |
| `frontend/` | React application built with Vite. Uses Axios to request the API and Recharts to render the interactive chart. |
| `frontend/src/App.jsx` | Dashboard, API requests, actual/forecast alignment, summary calculations, and chart. |
| `frontend/src/App.css`, `frontend/src/index.css` | Dashboard component styling and global styles. |
| `frontend/src/main.jsx` | React application entry point. |
| `frontend/package.json` | Frontend dependencies and development/build/lint scripts. |
| `.gitignore` | Excludes generated dependencies, build output, Python caches, logs, and local environment files. |

## Data sources and refresh

The script uses Elexon's public BMRS API:

- Actual generation: `FUELHH` with `fuelType=WIND` (half-hourly).
- Forecast generation: `WINDFOR` (hourly rolling forecast).

Run `fetch_data.py` to refresh both CSV files. It identifies the latest
settlement date in the actuals response and selects forecasts whose start times
fall within that date. UK settlement days can have 23 or 25 hours when the
clocks change; the script accounts for these dates when selecting forecast
records. The forecast endpoint is a rolling forecast, not an archived forecast
for an arbitrary historical day. Thus, on a later refresh, both CSVs are
replaced with the latest settlement date available from Elexon.

The script prints the API response bodies to help diagnose upstream responses.
It exits with an error if an API request fails, returns empty/non-JSON data, or
does not provide records for the requested dataset.

## CSV columns

### `historical_data.csv`

| Column | Description |
|---|---|
| `dataset` | Elexon dataset identifier; normally `FUELHH`. |
| `publishTime` | UTC timestamp when Elexon published the record. |
| `startTime` | UTC start time of the half-hour settlement period. |
| `settlementDate` | UK settlement date in `YYYY-MM-DD` form. |
| `settlementPeriod` | Settlement period number for that date. Normally 1–48; clock-change days can have 46 or 50 periods. |
| `fuelType` | Fuel category; this project filters for `WIND`. |
| `generation` | Actual generation in megawatts (MW). |

### `forecast_data.csv`

| Column | Description |
|---|---|
| `dataset` | Elexon dataset identifier; `WINDFOR` for the wind forecast. |
| `publishTime` | UTC timestamp when Elexon published the forecast. |
| `startTime` | UTC start time of the forecast hour. |
| `generation` | Forecast generation in megawatts (MW). |
| `settlementDate` | Settlement date shared with the historical data. |
| `settlementPeriod` | Half-hour settlement-period position associated with the forecast start time. Each hourly forecast is assigned the period at the start of its hour (typically periods 1, 3, 5, …). |

The API converts `settlementPeriod` and `generation` to JSON integers. Other
CSV values are returned as strings.

## Requirements

- Python 3.10 or later.
- Node.js and npm (use a current Node.js LTS release).
- Internet access when refreshing data from Elexon.

## Run the application

Open two terminals in the project root.

### 1. Install Python dependencies

Create and activate a virtual environment if desired:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Install the backend and data-fetch dependencies:

```powershell
python -m pip install fastapi uvicorn requests
```

### 2. Fetch or refresh the CSV data

Run this from the project root:

```powershell
python fetch_data.py
```

This creates or replaces `historical_data.csv` and `forecast_data.csv` beside
the script. The backend requires both files to serve their respective routes.

### 3. Start the FastAPI backend

From the project root, run:

```powershell
python -m uvicorn main:app --reload
```

`main:app` means “import the `app` object from `main.py`.” The form
`uvicorn main.py` is not a valid Uvicorn application target.

The API will be available at `http://127.0.0.1:8000`:

- `GET http://127.0.0.1:8000/api/historical` — actual WIND records.
- `GET http://127.0.0.1:8000/api/forecast` — WINDFOR forecast records.
- `http://127.0.0.1:8000/docs` — interactive API documentation.

The backend permits browser requests from the Vite origins
`http://127.0.0.1:5173` and `http://localhost:5173`.

### 4. Install and start the React frontend

In the second terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Open the local URL printed by Vite (typically `http://localhost:5173`). The
dashboard requests both API endpoints and displays historical and forecast
generation on the same chart. Hover over the chart for record values; use the
brush control to zoom the displayed settlement-period range.

To check or build the frontend:

```powershell
npm run lint
npm run build
```

## Forecast comparison

The dashboard reports the actual and forecast averages, mean absolute error
(MAE), and forecast bias. Error calculations match forecast hours to actual
generation by UTC hour. Since actual readings are half-hourly, the comparison
uses the average of the two actual readings in each complete hour; incomplete
hours are excluded.

- **MAE** is the average absolute difference between forecast and actual
  hourly-average generation, in MW.
- **Forecast bias** is the average of `forecast - actual`, in MW. A positive
  bias means the forecast was higher than actual generation on average.

## GitHub Copilot's role

GitHub Copilot was used as an AI development assistant during this project's
implementation. With the developer providing the project goals and reviewing
the changes, Copilot assisted with the data-fetching script, FastAPI routes,
React dashboard, and development troubleshooting. Build, lint, and API checks
were run during development. Copilot is not needed to run the application:
the runtime requirements are Python, the listed Python packages, Node.js, and
npm.
