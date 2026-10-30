import csv
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_methods=["GET"],
    allow_headers=["*"],
)

DATA_DIR = Path(__file__).parent
HISTORICAL_DATA_PATH = DATA_DIR / "historical_data.csv"
FORECAST_DATA_PATH = DATA_DIR / "forecast_data.csv"


def read_csv_records(path: Path, dataset_name: str) -> list[dict[str, str]]:
    if not path.is_file():
        raise HTTPException(
            status_code=404, detail=f"{dataset_name} data file not found."
        )

    try:
        with path.open(newline="", encoding="utf-8") as csv_file:
            return list(csv.DictReader(csv_file))
    except (OSError, csv.Error) as exc:
        raise HTTPException(
            status_code=500, detail=f"Could not read {dataset_name} data file."
        ) from exc


@app.get("/api/historical")
def get_historical_data() -> list[dict[str, str | int]]:
    try:
        return [
            {
                **row,
                "settlementPeriod": int(row["settlementPeriod"]),
                "generation": int(row["generation"]),
            }
            for row in read_csv_records(HISTORICAL_DATA_PATH, "Historical")
            if row.get("fuelType") == "WIND"
        ]
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=500, detail="Historical data contains invalid records."
        ) from exc


@app.get("/api/forecast")
def get_forecast_data() -> list[dict[str, str | int]]:
    try:
        return [
            {
                **row,
                "settlementPeriod": int(row["settlementPeriod"]),
                "generation": int(row["generation"]),
            }
            for row in read_csv_records(FORECAST_DATA_PATH, "Forecast")
        ]
    except (KeyError, ValueError) as exc:
        raise HTTPException(
            status_code=500, detail="Forecast data contains invalid records."
        ) from exc
