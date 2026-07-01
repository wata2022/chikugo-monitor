"""Create a water-level graph from ckgoozeki.jp mobile data."""

from __future__ import annotations

import csv
import datetime as dt
import html
import re
import sys
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import matplotlib.dates as mdates
import matplotlib.pyplot as plt


SOURCE_URL = "https://ckgoozeki.jp/mobile2-6.htm"
CSV_PATH = Path("water_level_mobile2_6.csv")
PNG_PATH = Path("water_level_mobile2_6.png")

UPDATE_RE = re.compile(r"(\d{2})/(\d{2})/(\d{2})\s+(\d{2}):(\d{2})")
DATA_RE = re.compile(
    r"<font[^>]*>\s*(\d{2})/(\d{2})\s+(\d{2}):(\d{2})\s*</font>"
    r"&nbsp;<font[^>]*>\s*&nbsp;([+-]?\d+(?:\.\d+)?)\s*</font>",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class WaterLevelSample:
    """One water-level observation."""

    observed_at: dt.datetime
    source_label: str
    level_tpm: float


def fetch_html(url: str) -> str:
    """Fetches the source HTML with explicit timeout and encoding fallback."""
    request = urllib.request.Request(url, headers={"User-Agent": "CodexGraph/1.0"})
    with urllib.request.urlopen(request, timeout=15) as response:
        body = response.read()
    return body.decode("shift_jis", errors="replace")


def parse_update_year(page_html: str) -> int:
    """Returns the update year from the page header."""
    text = html.unescape(page_html)
    match = UPDATE_RE.search(text)
    if match is None:
        raise ValueError("Could not find update timestamp in source page.")
    return 2000 + int(match.group(1))


def normalize_observed_at(year: int, month: int, day: int, hour: int, minute: int) -> dt.datetime:
    """Builds a datetime and handles the source page's 24:00 notation."""
    if hour == 24:
        if minute != 0:
            raise ValueError("24-hour timestamp must use minute 00.")
        return dt.datetime(year, month, day) + dt.timedelta(days=1)
    if hour > 23:
        raise ValueError(f"Invalid hour in source timestamp: {hour}")
    return dt.datetime(year, month, day, hour, minute)


def parse_samples(page_html: str) -> list[WaterLevelSample]:
    """Extracts water-level samples sorted by observation time."""
    year = parse_update_year(page_html)
    samples: list[WaterLevelSample] = []
    for match in DATA_RE.finditer(page_html):
        month = int(match.group(1))
        day = int(match.group(2))
        hour = int(match.group(3))
        minute = int(match.group(4))
        level_tpm = float(match.group(5))
        source_label = f"{month:02d}/{day:02d} {hour:02d}:{minute:02d}"
        samples.append(
            WaterLevelSample(
                observed_at=normalize_observed_at(year, month, day, hour, minute),
                source_label=source_label,
                level_tpm=level_tpm,
            )
        )
    if not samples:
        raise ValueError("Could not find water-level samples in source page.")
    samples.sort(key=lambda sample: sample.observed_at)
    return samples


def write_csv(samples: list[WaterLevelSample], path: Path) -> None:
    """Writes source samples to CSV."""
    with path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.writer(csv_file)
        writer.writerow(["observed_at", "source_label", "level_tpm"])
        for sample in samples:
            writer.writerow([sample.observed_at.isoformat(), sample.source_label, sample.level_tpm])


def write_graph(samples: list[WaterLevelSample], path: Path) -> None:
    """Writes a PNG line graph."""
    times = [sample.observed_at for sample in samples]
    levels = [sample.level_tpm for sample in samples]

    fig, ax = plt.subplots(figsize=(13, 6), layout="constrained")
    ax.plot(times, levels, color="#1f77b4", linewidth=2.0, marker="o", markersize=3.5)
    ax.fill_between(times, levels, min(levels), color="#1f77b4", alpha=0.12)
    ax.set_title("Downstream water level history")
    ax.set_xlabel("Time")
    ax.set_ylabel("Water level (TPm)")
    ax.grid(True, color="#d9d9d9", linewidth=0.8)
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%m/%d %H:%M"))
    ax.xaxis.set_major_locator(mdates.HourLocator(interval=6))
    fig.autofmt_xdate(rotation=35, ha="right")
    fig.savefig(path, dpi=160)
    plt.close(fig)


def main() -> int:
    """Program entry point."""
    try:
        page_html = fetch_html(SOURCE_URL)
        samples = parse_samples(page_html)
        write_csv(samples, CSV_PATH)
        write_graph(samples, PNG_PATH)
    except (OSError, TimeoutError, UnicodeError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    print(f"Wrote {CSV_PATH}")
    print(f"Wrote {PNG_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
