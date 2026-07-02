"""Overlay Chikugo Ozeki water levels and Wakatsu tide data."""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from pathlib import Path
from typing import Sequence

import matplotlib.dates as mdates
import matplotlib.pyplot as plt
from matplotlib import font_manager
import pandas as pd
import requests

import stage1_water_level


DEFAULT_TIDE_CSV_PATH = Path("tide.csv")
DEFAULT_TIDE_OUTPUT_CSV_PATH = Path("tide_auto.csv")
DEFAULT_MERGED_CSV_PATH = Path("merged.csv")
DEFAULT_GRAPH_PATH = Path("graph.png")
DEFAULT_DAILY_GRAPH_DIR = Path("daily_graphs")
DEFAULT_MERGE_TOLERANCE_MINUTES = 90
DEFAULT_MAX_LAG_MINUTES = 180
DEFAULT_LAG_STEP_MINUTES = 10
DEFAULT_FREQUENCY = "10min"
TIDE736_API_URL = "https://api.tide736.net/get_tide.php"
DEFAULT_TIDE_PREFECTURE_CODE = 41
DEFAULT_TIDE_HARBOR_CODE = 8

DATETIME_COLUMN_CANDIDATES = (
    "datetime",
    "date_time",
    "observed_at",
    "predicted_at",
    "日時",
    "年月日時",
)
DATE_COLUMN_CANDIDATES = ("date", "年月日", "日付", "月日")
TIME_COLUMN_CANDIDATES = ("time", "時刻", "時間")
TIDE_COLUMN_CANDIDATES = (
    "tide_cm",
    "tide",
    "tide_level",
    "level_cm",
    "潮位",
    "潮位cm",
    "潮位(cm)",
    "予測潮位",
)
WATER_COLUMNS = ("downstream_water_level_tpm", "upstream_water_level_tpm")
JAPANESE_FONT_CANDIDATES = (
    "Yu Gothic",
    "Meiryo",
    "MS Gothic",
    "Noto Sans CJK JP",
    "Noto Sans JP",
)


def current_jst_timestamp() -> pd.Timestamp:
    """Returns the current timestamp in Japan time without timezone metadata."""
    return pd.Timestamp(
        dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).replace(tzinfo=None)
    )


def canonicalize_column_name(column: object) -> str:
    """Normalizes a column name for flexible CSV matching."""
    return str(column).strip().replace(" ", "").replace("　", "").lower()


def find_column(columns: Sequence[object], candidates: Sequence[str]) -> object | None:
    """Finds a column by normalized exact match."""
    normalized_candidates = {canonicalize_column_name(candidate) for candidate in candidates}
    for column in columns:
        if canonicalize_column_name(column) in normalized_candidates:
            return column
    return None


def configure_plot_font() -> None:
    """Configures a Japanese-capable font when one is available."""
    available_fonts = {font.name for font in font_manager.fontManager.ttflist}
    for font_name in JAPANESE_FONT_CANDIDATES:
        if font_name in available_fonts:
            plt.rcParams["font.family"] = font_name
            break
    plt.rcParams["axes.unicode_minus"] = False


def normalize_datetime(
    year: int,
    month: int,
    day: int,
    hour: int,
    minute: int,
) -> dt.datetime:
    """Returns a datetime, treating 24:00 as the following day's 00:00."""
    return stage1_water_level.normalize_datetime(year, month, day, hour, minute)


def parse_flexible_datetime(value: object, default_year: int) -> pd.Timestamp | pd.NaT:
    """Parses datetime text such as 2026/06/30 23:00 or 06/30 24:00."""
    if pd.isna(value):
        return pd.NaT

    text = str(value).strip()
    if not text:
        return pd.NaT

    normalized_text = text.replace("年", "/").replace("月", "/").replace("日", " ")
    normalized_text = re.sub(r"\s+", " ", normalized_text)
    match = re.search(
        r"(?:(\d{4})[/-])?(\d{1,2})[/-](\d{1,2})\s+(\d{1,2}):(\d{2})",
        normalized_text,
    )
    if match is not None:
        year = int(match.group(1)) if match.group(1) else default_year
        month = int(match.group(2))
        day = int(match.group(3))
        hour = int(match.group(4))
        minute = int(match.group(5))
        try:
            return pd.Timestamp(normalize_datetime(year, month, day, hour, minute))
        except ValueError:
            return pd.NaT

    parsed = pd.to_datetime(text, errors="coerce")
    if pd.isna(parsed):
        return pd.NaT
    if parsed.year == 1900:
        parsed = parsed.replace(year=default_year)
    return parsed


def build_tide_datetime_series(data_frame: pd.DataFrame, default_year: int) -> pd.Series:
    """Builds tide datetime values from datetime or date/time columns."""
    datetime_column = find_column(data_frame.columns, DATETIME_COLUMN_CANDIDATES)
    if datetime_column is not None:
        return data_frame[datetime_column].map(
            lambda value: parse_flexible_datetime(value, default_year)
        )

    date_column = find_column(data_frame.columns, DATE_COLUMN_CANDIDATES)
    time_column = find_column(data_frame.columns, TIME_COLUMN_CANDIDATES)
    if date_column is None or time_column is None:
        raise ValueError("tide.csv needs datetime, or date and time columns.")

    combined = data_frame[date_column].astype(str) + " " + data_frame[time_column].astype(str)
    return combined.map(lambda value: parse_flexible_datetime(value, default_year))


def read_tide_csv(path: Path, default_year: int) -> pd.DataFrame:
    """Reads tide CSV and returns datetime/tide_cm columns."""
    if not path.exists():
        raise FileNotFoundError(f"{path} was not found.")

    raw_tide = pd.read_csv(path, encoding="utf-8-sig")
    if raw_tide.empty:
        raise ValueError("tide.csv is empty.")

    tide_column = find_column(raw_tide.columns, TIDE_COLUMN_CANDIDATES)
    if tide_column is None:
        raise ValueError("tide.csv needs a tide_cm or tide-level column.")

    tide = pd.DataFrame(
        {
            "datetime": build_tide_datetime_series(raw_tide, default_year),
            "tide_cm": pd.to_numeric(raw_tide[tide_column], errors="coerce"),
        }
    )
    tide = tide.dropna(subset=["datetime", "tide_cm"])
    if tide.empty:
        raise ValueError("No valid tide datetime/tide_cm rows were found.")
    return tide.sort_values("datetime").drop_duplicates("datetime").reset_index(drop=True)


def parse_tide736_response(response_json: dict[str, object]) -> pd.DataFrame:
    """Converts a tide736 API response to datetime/tide_cm rows."""
    if int(response_json.get("status", 0)) != 1:
        message = response_json.get("message", "unknown error")
        raise ValueError(f"tide736 API returned an error: {message}")

    tide_block = response_json.get("tide")
    if not isinstance(tide_block, dict):
        raise ValueError("tide736 API response does not contain tide data.")
    chart = tide_block.get("chart")
    if not isinstance(chart, dict):
        raise ValueError("tide736 API response does not contain chart data.")

    rows: list[dict[str, object]] = []
    for ymd, daily_data in chart.items():
        if not isinstance(ymd, str) or not isinstance(daily_data, dict):
            continue
        tide_rows = daily_data.get("tide")
        if not isinstance(tide_rows, list):
            continue
        moon_data = daily_data.get("moon")
        tide_name = ""
        moon_age: float | None = None
        if isinstance(moon_data, dict):
            tide_name = str(moon_data.get("title", "")).strip()
            try:
                moon_age = float(moon_data["age"])
            except (KeyError, TypeError, ValueError):
                moon_age = None
        date_match = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", ymd)
        if date_match is None:
            continue
        year = int(date_match.group(1))
        month = int(date_match.group(2))
        day = int(date_match.group(3))
        for tide_row in tide_rows:
            if not isinstance(tide_row, dict):
                continue
            time_text = str(tide_row.get("time", "")).strip()
            time_match = re.fullmatch(r"(\d{1,2}):(\d{2})", time_text)
            if time_match is None:
                continue
            try:
                observed_at = normalize_datetime(
                    year,
                    month,
                    day,
                    int(time_match.group(1)),
                    int(time_match.group(2)),
                )
                tide_cm = float(tide_row["cm"])
            except (KeyError, TypeError, ValueError):
                continue
            rows.append(
                {
                    "datetime": observed_at,
                    "tide_cm": tide_cm,
                    "tide_name": tide_name,
                    "moon_age": moon_age,
                }
            )

    if not rows:
        raise ValueError("No valid tide rows were found in the tide736 API response.")
    return pd.DataFrame(rows).sort_values("datetime").drop_duplicates("datetime")


def fetch_tide736_data(
    start_time: pd.Timestamp,
    prefecture_code: int,
    harbor_code: int,
) -> pd.DataFrame:
    """Fetches tide prediction data from tide736.net for the water-data period."""
    params = {
        "pc": prefecture_code,
        "hc": harbor_code,
        "yr": int(start_time.year),
        "mn": int(start_time.month),
        "dy": int(start_time.day),
        "rg": "week",
    }
    response = requests.get(
        TIDE736_API_URL,
        params=params,
        headers={"User-Agent": "ChikugoWaterTideGraph/1.0"},
        timeout=stage1_water_level.HTTP_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return parse_tide736_response(response.json()).reset_index(drop=True)


def load_tide_data(args: argparse.Namespace, water_level: pd.DataFrame) -> pd.DataFrame:
    """Loads tide data from tide736 first, falling back to tide.csv when needed."""
    if (
        water_level.empty
        or "datetime" not in water_level
        or water_level["datetime"].dropna().empty
    ):
        tide_start = current_jst_timestamp()
    else:
        tide_start = pd.Timestamp(water_level["datetime"].min())

    if not args.no_auto_tide:
        try:
            tide = fetch_tide736_data(
                tide_start,
                args.tide_prefecture_code,
                args.tide_harbor_code,
            )
            tide.to_csv(args.tide_output_csv, index=False, encoding="utf-8-sig")
            print(
                "Fetched tide data from tide736 "
                f"(pc={args.tide_prefecture_code}, hc={args.tide_harbor_code})."
            )
            print(f"Wrote: {args.tide_output_csv}")
            return tide
        except (OSError, requests.RequestException, ValueError) as error:
            print(f"Automatic tide fetch failed: {error}", file=sys.stderr)
            print(f"Falling back to CSV: {args.tide_csv}", file=sys.stderr)

    default_year = int(tide_start.year)
    return read_tide_csv(args.tide_csv, default_year)


def merge_nearest(
    water_level: pd.DataFrame,
    tide: pd.DataFrame,
    tolerance_minutes: int,
) -> pd.DataFrame:
    """Merges water and tide rows by nearest datetime."""
    merged = pd.merge_asof(
        water_level.sort_values("datetime"),
        tide.sort_values("datetime").rename(columns={"datetime": "tide_datetime"}),
        left_on="datetime",
        right_on="tide_datetime",
        direction="nearest",
        tolerance=pd.Timedelta(minutes=tolerance_minutes),
    )
    merged["time_diff_minutes"] = (
        (merged["datetime"] - merged["tide_datetime"]).dt.total_seconds() / 60.0
    )
    return merged


def resample_numeric(
    data_frame: pd.DataFrame,
    value_column: str,
    frequency: str,
    start: pd.Timestamp,
    end: pd.Timestamp,
    interpolate: bool,
) -> pd.DataFrame:
    """Resamples a datetime/value frame to a fixed time grid."""
    if data_frame.empty:
        raise ValueError(f"No data rows for {value_column}.")

    hourly_index = pd.date_range(start=start, end=end, freq=frequency)
    if hourly_index.empty:
        raise ValueError("The requested time range is empty.")

    series = (
        data_frame[["datetime", value_column]]
        .dropna()
        .sort_values("datetime")
        .set_index("datetime")[value_column]
        .resample(frequency)
        .mean()
        .reindex(hourly_index)
    )
    if interpolate:
        series = series.interpolate(method="time", limit_area="inside")
    return pd.DataFrame({"datetime": hourly_index, value_column: series.to_numpy()})


def build_daily_tide_metadata(tide: pd.DataFrame) -> pd.DataFrame:
    """Builds one tide-name/moon-age row per day when metadata is available."""
    if "tide_name" not in tide.columns and "moon_age" not in tide.columns:
        return pd.DataFrame(columns=["date", "tide_name", "moon_age"])

    metadata = tide.copy()
    metadata["date"] = metadata["datetime"].dt.date
    columns = ["date"]
    if "tide_name" in metadata.columns:
        columns.append("tide_name")
    if "moon_age" in metadata.columns:
        columns.append("moon_age")
    return (
        metadata[columns]
        .dropna(how="all", subset=[column for column in columns if column != "date"])
        .drop_duplicates("date")
        .reset_index(drop=True)
    )


def merge_hourly(
    water_level: pd.DataFrame,
    tide: pd.DataFrame,
    frequency: str,
) -> pd.DataFrame:
    """Aligns water levels and available tide data on the water-history grid."""
    water_has_rows = not water_level.empty and water_level["datetime"].notna().any()
    if water_has_rows:
        start = water_level["datetime"].min()
        end = water_level["datetime"].max()
    else:
        start = tide["datetime"].min()
        end = min(tide["datetime"].max(), current_jst_timestamp().floor(frequency))
    if pd.isna(start) or pd.isna(end) or start > end:
        raise ValueError("Water and tide data time ranges are empty.")

    merged = pd.DataFrame({"datetime": pd.date_range(start=start, end=end, freq=frequency)})
    for water_column in WATER_COLUMNS:
        if water_column not in water_level.columns:
            continue
        if water_level[["datetime", water_column]].dropna().empty:
            merged[water_column] = pd.NA
            continue
        water_hourly = resample_numeric(
            water_level,
            water_column,
            frequency,
            pd.Timestamp(start),
            pd.Timestamp(end),
            interpolate=False,
        )
        merged = pd.merge(merged, water_hourly, on="datetime", how="left")

    tide_hourly = resample_numeric(
        tide,
        "tide_cm",
        frequency,
        pd.Timestamp(start),
        pd.Timestamp(end),
        interpolate=True,
    )
    merged = pd.merge(merged, tide_hourly, on="datetime", how="left")
    daily_metadata = build_daily_tide_metadata(tide)
    if not daily_metadata.empty:
        merged["date"] = merged["datetime"].dt.date
        merged = pd.merge(merged, daily_metadata, on="date", how="left")
        merged = merged.drop(columns=["date"])
    merged["tide_datetime"] = merged["datetime"]
    merged["time_diff_minutes"] = 0.0
    return merged.sort_values("datetime").reset_index(drop=True)


def summarize_tide_metadata(data_frame: pd.DataFrame) -> str:
    """Returns a compact tide-name/moon-age summary for a graph annotation."""
    if "tide_name" not in data_frame.columns and "moon_age" not in data_frame.columns:
        return ""

    rows: list[str] = []
    metadata = data_frame.copy()
    metadata["date"] = metadata["datetime"].dt.date
    for day, daily_data in metadata.groupby("date"):
        tide_name = ""
        moon_age_text = ""
        if "tide_name" in daily_data.columns:
            names = daily_data["tide_name"].dropna().astype(str)
            names = names[names.str.len() > 0]
            if not names.empty:
                tide_name = names.iloc[0]
        if "moon_age" in daily_data.columns:
            ages = pd.to_numeric(daily_data["moon_age"], errors="coerce").dropna()
            if not ages.empty:
                moon_age_text = f"月齢 {ages.iloc[0]:.1f}"

        parts = [part for part in (tide_name, moon_age_text) if part]
        if parts:
            rows.append(f"{day:%m/%d}: " + ", ".join(parts))
    return "\n".join(rows)


def write_overlay_graph(
    merged: pd.DataFrame,
    output_path: Path,
    title_suffix: str = "",
) -> None:
    """Writes a two-axis line graph."""
    if "tide_cm" not in merged or merged["tide_cm"].notna().sum() == 0:
        raise ValueError("No tide rows are available for plotting.")

    configure_plot_font()
    fig, left_axis = plt.subplots(figsize=(13, 6), layout="constrained")
    right_axis = left_axis.twinx()

    lines = []
    if (
        "downstream_water_level_tpm" in merged
        and merged["downstream_water_level_tpm"].notna().any()
    ):
        lines += left_axis.plot(
            merged["datetime"],
            merged["downstream_water_level_tpm"],
            color="#1f77b4",
            marker="o",
            markersize=3.5,
            linewidth=2.0,
            label="Downstream water level (TPm)",
        )
    if (
        "upstream_water_level_tpm" in merged
        and merged["upstream_water_level_tpm"].notna().any()
    ):
        lines += left_axis.plot(
            merged["datetime"],
            merged["upstream_water_level_tpm"],
            color="#2ca02c",
            marker="^",
            markersize=3.5,
            linewidth=1.8,
            label="Upstream water level (TPm)",
        )
    lines += right_axis.plot(
        merged["datetime"],
        merged["tide_cm"],
        color="#d62728",
        marker="s",
        markersize=3.0,
        linewidth=1.8,
        label="Wakatsu tide (cm)",
    )

    title = "Chikugo Ozeki water levels and Wakatsu tide"
    if title_suffix:
        title = f"{title} ({title_suffix})"
    left_axis.set_title(title)
    metadata_summary = summarize_tide_metadata(merged)
    if metadata_summary:
        left_axis.text(
            0.995,
            0.985,
            metadata_summary,
            transform=left_axis.transAxes,
            ha="right",
            va="top",
            fontsize=10,
            bbox={"boxstyle": "round,pad=0.35", "facecolor": "white", "alpha": 0.82},
        )
    left_axis.set_xlabel("Datetime")
    left_axis.set_ylabel("Water level (TPm)", color="#1f77b4")
    right_axis.set_ylabel("Tide level (cm)", color="#d62728")
    left_axis.tick_params(axis="y", labelcolor="#1f77b4")
    right_axis.tick_params(axis="y", labelcolor="#d62728")
    left_axis.grid(True, color="#d9d9d9", linewidth=0.8)
    left_axis.xaxis.set_major_formatter(mdates.DateFormatter("%m/%d %H:%M"))
    left_axis.xaxis.set_major_locator(mdates.HourLocator(interval=6))
    if lines:
        left_axis.legend(lines, [line.get_label() for line in lines], loc="upper left")
    fig.autofmt_xdate(rotation=35, ha="right")
    fig.savefig(output_path, dpi=160)
    plt.close(fig)


def write_daily_overlay_graphs(merged: pd.DataFrame, output_dir: Path) -> list[Path]:
    """Writes one graph per calendar day."""
    if merged.empty:
        raise ValueError("No merged rows are available for daily graphs.")

    output_dir.mkdir(parents=True, exist_ok=True)
    written_paths: list[Path] = []
    for day, daily_data in merged.groupby(merged["datetime"].dt.date):
        if daily_data.empty:
            continue
        if "tide_cm" not in daily_data or daily_data["tide_cm"].isna().all():
            continue

        output_path = output_dir / f"graph_{day:%Y%m%d}.png"
        write_overlay_graph(daily_data.reset_index(drop=True), output_path, f"{day:%Y-%m-%d}")
        written_paths.append(output_path)

    if not written_paths:
        raise ValueError("No daily graphs were written.")
    return written_paths


def select_correlation_water_column(water_level: pd.DataFrame) -> str:
    """Selects the downstream water column for tide correlation when available."""
    if "downstream_water_level_tpm" in water_level.columns:
        return "downstream_water_level_tpm"
    if "water_level_tpm" in water_level.columns:
        return "water_level_tpm"
    raise ValueError("No downstream water-level column is available for correlation.")


def calculate_best_lag(
    water_level: pd.DataFrame,
    tide: pd.DataFrame,
    tolerance_minutes: int,
    max_lag_minutes: int,
    lag_step_minutes: int,
) -> tuple[int, float] | None:
    """Finds the tide shift with the highest absolute downstream correlation."""
    if lag_step_minutes <= 0:
        raise ValueError("lag_step_minutes must be positive.")

    water_column = select_correlation_water_column(water_level)
    best_lag: int | None = None
    best_correlation: float | None = None
    for lag_minutes in range(-max_lag_minutes, max_lag_minutes + 1, lag_step_minutes):
        shifted_tide = tide.copy()
        shifted_tide["datetime"] = shifted_tide["datetime"] + pd.Timedelta(
            minutes=lag_minutes
        )
        shifted_merged = merge_nearest(
            water_level[["datetime", water_column]].rename(
                columns={water_column: "water_level_tpm"}
            ),
            shifted_tide,
            tolerance_minutes,
        )
        valid = shifted_merged.dropna(subset=["water_level_tpm", "tide_cm"])
        if len(valid) < 3:
            continue

        correlation = valid["water_level_tpm"].corr(valid["tide_cm"])
        if pd.isna(correlation):
            continue
        if best_correlation is None or abs(correlation) > abs(best_correlation):
            best_lag = lag_minutes
            best_correlation = float(correlation)

    if best_lag is None or best_correlation is None:
        return None
    return best_lag, best_correlation


def parse_args() -> argparse.Namespace:
    """Parses command-line arguments."""
    parser = argparse.ArgumentParser(
        description="Plot Chikugo Ozeki water levels and Wakatsu tide."
    )
    parser.add_argument("--tide-csv", type=Path, default=DEFAULT_TIDE_CSV_PATH)
    parser.add_argument("--tide-output-csv", type=Path, default=DEFAULT_TIDE_OUTPUT_CSV_PATH)
    parser.add_argument(
        "--tide-prefecture-code",
        type=int,
        default=DEFAULT_TIDE_PREFECTURE_CODE,
    )
    parser.add_argument("--tide-harbor-code", type=int, default=DEFAULT_TIDE_HARBOR_CODE)
    parser.add_argument("--no-auto-tide", action="store_true")
    parser.add_argument("--merged-csv", type=Path, default=DEFAULT_MERGED_CSV_PATH)
    parser.add_argument("--graph", type=Path, default=DEFAULT_GRAPH_PATH)
    parser.add_argument("--daily-graph-dir", type=Path, default=DEFAULT_DAILY_GRAPH_DIR)
    parser.add_argument("--frequency", default=DEFAULT_FREQUENCY)
    parser.add_argument(
        "--merge-tolerance-minutes",
        type=int,
        default=DEFAULT_MERGE_TOLERANCE_MINUTES,
    )
    parser.add_argument("--max-lag-minutes", type=int, default=DEFAULT_MAX_LAG_MINUTES)
    parser.add_argument("--lag-step-minutes", type=int, default=DEFAULT_LAG_STEP_MINUTES)
    return parser.parse_args()


def main() -> int:
    """Runs stage 2."""
    args = parse_args()
    try:
        try:
            water_level = stage1_water_level.fetch_all_water_levels()
        except (OSError, requests.RequestException, ValueError) as error:
            print(
                f"Water-level fetch failed; continuing with tide-only data: {error}",
                file=sys.stderr,
            )
            water_level = pd.DataFrame(
                columns=[
                    "datetime",
                    "downstream_water_level_tpm",
                    "upstream_water_level_tpm",
                ]
            )
        tide = load_tide_data(args, water_level)
        merged = merge_hourly(water_level, tide, args.frequency)
        merged.to_csv(args.merged_csv, index=False, encoding="utf-8-sig")
        write_overlay_graph(merged, args.graph)
        daily_graphs = write_daily_overlay_graphs(merged, args.daily_graph_dir)
        best_lag = None
        if not water_level.empty:
            best_lag = calculate_best_lag(
                water_level,
                tide,
                args.merge_tolerance_minutes,
                args.max_lag_minutes,
                args.lag_step_minutes,
            )
    except (
        OSError,
        pd.errors.ParserError,
        ValueError,
        requests.RequestException,
    ) as error:
        print(f"Failed to create water/tide graph: {error}", file=sys.stderr)
        return 1

    matched_count = int(
        merged[["downstream_water_level_tpm", "upstream_water_level_tpm", "tide_cm"]]
        .dropna()
        .shape[0]
    )
    print(f"Wrote: {args.merged_csv}")
    print(f"Wrote: {args.graph}")
    print(f"Wrote daily graphs: {len(daily_graphs)} files in {args.daily_graph_dir}")
    print(f"Hourly matched rows: {matched_count}/{len(merged)}")
    if best_lag is None:
        print("Correlation lag was not calculated because matched rows were insufficient.")
    else:
        lag_minutes, correlation = best_lag
        print(
            "Best tide shift against downstream water level: "
            f"{lag_minutes:+d} min, correlation={correlation:.3f}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
