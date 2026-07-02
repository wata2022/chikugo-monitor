"""Fetch Chikugo Ozeki upstream/downstream water levels and create outputs."""

from __future__ import annotations

import datetime as dt
import re
import sys
import time
from pathlib import Path

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
import pandas as pd
import requests
from bs4 import BeautifulSoup


DOWNSTREAM_WATER_LEVEL_URL = "https://ckgoozeki.jp/mobile2-6.htm"
UPSTREAM_WATER_LEVEL_URL = "https://ckgoozeki.jp/mobile2-5.htm"
HTTP_TIMEOUT_SECONDS = 15
HTTP_RETRY_ATTEMPTS = 3
HTTP_RETRY_DELAY_SECONDS = 10
WATER_LEVEL_CSV_PATH = Path("water_level.csv")
WATER_LEVEL_PNG_PATH = Path("water_level.png")

UPDATE_RE = re.compile(r"(\d{2})/(\d{2})/(\d{2})\s+(\d{2}):(\d{2})")
WATER_ROW_RE = re.compile(
    r"(\d{2})/(\d{2})\s+(\d{2}):(\d{2})\s+([+-]?\d+(?:\.\d+)?)"
)


def normalize_datetime(
    year: int,
    month: int,
    day: int,
    hour: int,
    minute: int,
) -> dt.datetime:
    """Returns a datetime, treating 24:00 as the following day's 00:00."""
    if hour == 24:
        if minute != 0:
            raise ValueError("24:00 notation must use minute 00.")
        return dt.datetime(year, month, day) + dt.timedelta(days=1)
    if hour < 0 or hour > 23:
        raise ValueError(f"Invalid hour: {hour}")
    if minute < 0 or minute > 59:
        raise ValueError(f"Invalid minute: {minute}")
    return dt.datetime(year, month, day, hour, minute)


def get_with_retries(
    url: str,
    *,
    attempts: int = HTTP_RETRY_ATTEMPTS,
    delay_seconds: int = HTTP_RETRY_DELAY_SECONDS,
    **kwargs: object,
) -> requests.Response:
    """Fetches a URL, retrying transient request failures."""
    last_error: requests.RequestException | None = None
    for attempt in range(1, attempts + 1):
        try:
            response = requests.get(url, **kwargs)
            response.raise_for_status()
            return response
        except requests.RequestException as error:
            last_error = error
            if attempt == attempts:
                break
            print(
                f"Request failed ({attempt}/{attempts}); retrying in "
                f"{delay_seconds}s: {url}: {error}",
                file=sys.stderr,
            )
            time.sleep(delay_seconds)
    if last_error is None:
        raise requests.RequestException(f"Request failed without an error: {url}")
    raise last_error


def fetch_source_html(url: str = DOWNSTREAM_WATER_LEVEL_URL) -> str:
    """Fetches a source page as Shift_JIS text."""
    response = get_with_retries(
        url,
        headers={"User-Agent": "ChikugoWaterLevelGraph/1.0"},
        timeout=HTTP_TIMEOUT_SECONDS,
    )
    response.encoding = "shift_jis"
    return response.text


def parse_update_year(page_text: str) -> int:
    """Extracts the year from the source page update timestamp."""
    match = UPDATE_RE.search(page_text)
    if match is None:
        raise ValueError("Could not find the page update timestamp.")
    return 2000 + int(match.group(1))


def parse_update_datetime(page_text: str) -> dt.datetime:
    """Extracts the source page update timestamp."""
    match = UPDATE_RE.search(page_text)
    if match is None:
        raise ValueError("Could not find the page update timestamp.")
    return normalize_datetime(
        2000 + int(match.group(1)),
        int(match.group(2)),
        int(match.group(3)),
        int(match.group(4)),
        int(match.group(5)),
    )


def parse_water_level(
    page_text: str,
    value_column: str = "water_level_tpm",
    label_column: str = "source_label",
    updated_at_column: str = "source_updated_at",
) -> pd.DataFrame:
    """Parses water-level rows from a source page."""
    updated_at = parse_update_datetime(page_text)
    year = updated_at.year
    soup = BeautifulSoup(page_text, "html.parser")
    plain_text = soup.get_text(" ", strip=True)

    rows: list[dict[str, object]] = []
    for match in WATER_ROW_RE.finditer(plain_text):
        month = int(match.group(1))
        day = int(match.group(2))
        hour = int(match.group(3))
        minute = int(match.group(4))
        observed_at = normalize_datetime(year, month, day, hour, minute)
        rows.append(
            {
                "datetime": observed_at,
                value_column: float(match.group(5)),
                label_column: f"{month:02d}/{day:02d} {hour:02d}:{minute:02d}",
                updated_at_column: updated_at,
            }
        )

    if not rows:
        raise ValueError("Could not find water-level rows.")
    return pd.DataFrame(rows).sort_values("datetime").reset_index(drop=True)


def fetch_water_level(
    url: str,
    value_column: str,
    label_column: str,
    updated_at_column: str,
) -> pd.DataFrame:
    """Fetches and parses one water-level page."""
    return parse_water_level(
        fetch_source_html(url),
        value_column,
        label_column,
        updated_at_column,
    )


def fetch_all_water_levels() -> pd.DataFrame:
    """Fetches upstream and downstream water levels and joins them by datetime."""
    downstream = fetch_water_level(
        DOWNSTREAM_WATER_LEVEL_URL,
        "downstream_water_level_tpm",
        "downstream_source_label",
        "downstream_updated_at",
    )
    upstream = fetch_water_level(
        UPSTREAM_WATER_LEVEL_URL,
        "upstream_water_level_tpm",
        "upstream_source_label",
        "upstream_updated_at",
    )
    return pd.merge(downstream, upstream, on="datetime", how="outer").sort_values(
        "datetime"
    ).reset_index(drop=True)


def write_water_level_graph(water_level: pd.DataFrame, output_path: Path) -> None:
    """Writes an upstream/downstream water-level line graph."""
    required_columns = ("downstream_water_level_tpm", "upstream_water_level_tpm")
    if water_level.empty or all(water_level[column].isna().all() for column in required_columns):
        raise ValueError("No water-level rows are available for plotting.")

    fig, axis = plt.subplots(figsize=(13, 6), layout="constrained")
    axis.plot(
        water_level["datetime"],
        water_level["downstream_water_level_tpm"],
        color="#1f77b4",
        marker="o",
        markersize=3.5,
        linewidth=2.0,
        label="Downstream water level (TPm)",
    )
    axis.plot(
        water_level["datetime"],
        water_level["upstream_water_level_tpm"],
        color="#2ca02c",
        marker="^",
        markersize=3.5,
        linewidth=1.8,
        label="Upstream water level (TPm)",
    )
    axis.set_title("Chikugo Ozeki upstream/downstream water levels")
    axis.set_xlabel("Datetime")
    axis.set_ylabel("Water level (TPm)")
    axis.grid(True, color="#d9d9d9", linewidth=0.8)
    axis.legend(loc="upper left")
    axis.xaxis.set_major_formatter(mdates.DateFormatter("%m/%d %H:%M"))
    axis.xaxis.set_major_locator(mdates.HourLocator(interval=6))
    fig.autofmt_xdate(rotation=35, ha="right")
    fig.savefig(output_path, dpi=160)
    plt.close(fig)


def main() -> int:
    """Runs stage 1."""
    try:
        water_level = fetch_all_water_levels()
        water_level.to_csv(WATER_LEVEL_CSV_PATH, index=False, encoding="utf-8-sig")
        write_water_level_graph(water_level, WATER_LEVEL_PNG_PATH)
    except (OSError, requests.RequestException, ValueError) as error:
        print(f"Failed to create water-level outputs: {error}", file=sys.stderr)
        return 1

    print(f"Wrote: {WATER_LEVEL_CSV_PATH}")
    print(f"Wrote: {WATER_LEVEL_PNG_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
