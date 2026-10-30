import calendar
import csv
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests

BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
HEADERS = {"Accept": "application/json"}
OUTPUT_DIR = Path(__file__).parent


def fetch_records(dataset: str, params: dict[str, str]) -> list[dict]:
    url = f"{BASE_URL}/{dataset}/stream"
    try:
        response = requests.get(
            url, params=params, headers=HEADERS, timeout=30
        )
        response.raise_for_status()
    except requests.exceptions.RequestException as exc:
        raise SystemExit(f"Failed to fetch {dataset} data from ELEXON: {exc}") from exc

    print(f"Raw {dataset} API response:")
    print(response.text)
    if not response.text.strip():
        raise SystemExit(f"ELEXON returned an empty {dataset} response.")

    try:
        data = response.json()
    except ValueError as exc:
        preview = response.text[:300]
        raise SystemExit(
            f"ELEXON returned a non-JSON {dataset} response "
            f"(HTTP {response.status_code}): {preview}"
        ) from exc

    if not isinstance(data, list):
        raise SystemExit(f"Expected a list of {dataset} records.")
    if not data:
        raise SystemExit(f"ELEXON returned no {dataset} records.")

    return data


def write_csv(path: Path, records: list[dict]) -> None:
    if not records:
        raise SystemExit(f"Refusing to write an empty data file: {path.name}")

    with path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=records[0].keys())
        writer.writeheader()
        writer.writerows(records)


def settlement_day_hours(settlement_date: str) -> int:
    day = date.fromisoformat(settlement_date)

    def last_sunday(month: int) -> date:
        last_day = date(day.year, month, calendar.monthrange(day.year, month)[1])
        return last_day - timedelta(days=(last_day.weekday() + 1) % 7)

    if day == last_sunday(3):
        return 23
    if day == last_sunday(10):
        return 25
    return 24


print("Fetching the latest half-hourly WIND generation...")
historical_data = fetch_records("FUELHH", {"fuelType": "WIND"})
settlement_date = historical_data[0].get("settlementDate")
if not settlement_date:
    raise SystemExit("ELEXON FUELHH records did not include a settlement date.")

historical_data = [
    record
    for record in historical_data
    if record.get("fuelType") == "WIND"
    and record.get("settlementDate") == settlement_date
]
if not historical_data:
    raise SystemExit(f"No WIND generation records found for {settlement_date}.")

day_start_record = min(historical_data, key=lambda record: record["settlementPeriod"])
day_start = datetime.fromisoformat(
    day_start_record["startTime"].replace("Z", "+00:00")
).astimezone(timezone.utc)
day_duration_seconds = settlement_day_hours(settlement_date) * 60 * 60

print(f"Fetching the rolling WIND forecast for {settlement_date}...")
forecast_data = fetch_records("WINDFOR", {})
same_day_forecasts = []
for record in forecast_data:
    try:
        forecast_time = datetime.fromisoformat(
            record["startTime"].replace("Z", "+00:00")
        ).astimezone(timezone.utc)
        generation = int(record["generation"])
    except (KeyError, TypeError, ValueError) as exc:
        raise SystemExit(f"Invalid record in ELEXON WINDFOR response: {record}") from exc

    elapsed_seconds = (forecast_time - day_start).total_seconds()
    if 0 <= elapsed_seconds < day_duration_seconds:
        same_day_forecasts.append(
            {
                **record,
                "settlementDate": settlement_date,
                "settlementPeriod": int(elapsed_seconds // (30 * 60)) + 1,
                "generation": generation,
            }
        )

if not same_day_forecasts:
    raise SystemExit(
        f"No WINDFOR records overlap settlement date {settlement_date}."
    )

historical_path = OUTPUT_DIR / "historical_data.csv"
forecast_path = OUTPUT_DIR / "forecast_data.csv"
write_csv(historical_path, historical_data)
write_csv(forecast_path, same_day_forecasts)

print(
    f"Saved {len(historical_data)} actual WIND records to {historical_path} "
    f"and {len(same_day_forecasts)} forecasts to {forecast_path} "
    f"for {settlement_date}."
)
