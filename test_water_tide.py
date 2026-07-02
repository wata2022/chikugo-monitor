"""Unit tests for the staged Chikugo water/tide scripts."""

from __future__ import annotations

import datetime as dt
import tempfile
import unittest
from pathlib import Path

import pandas as pd

import stage1_water_level
import stage2_water_tide


class WaterLevelTest(unittest.TestCase):
    """Tests for stage 1 parsing helpers."""

    def test_normalize_datetime_handles_24_hour_notation(self) -> None:
        observed_at = stage1_water_level.normalize_datetime(2026, 6, 30, 24, 0)
        self.assertEqual(observed_at, dt.datetime(2026, 7, 1, 0, 0))


class TideMergeTest(unittest.TestCase):
    """Tests for stage 2 tide parsing and merging."""

    def test_read_tide_csv_accepts_japanese_columns(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            tide_path = Path(temp_dir) / "tide.csv"
            tide_path.write_text(
                "日時,潮位(cm)\n"
                "2026/06/30 23:00,150\n"
                "2026/06/30 24:00,180\n",
                encoding="utf-8",
            )

            tide = stage2_water_tide.read_tide_csv(tide_path, 2026)

        self.assertEqual(len(tide), 2)
        self.assertEqual(tide.loc[1, "datetime"], pd.Timestamp("2026-07-01 00:00"))
        self.assertEqual(tide.loc[1, "tide_cm"], 180)

    def test_merge_nearest_uses_tolerance(self) -> None:
        water_level = pd.DataFrame(
            {
                "datetime": [pd.Timestamp("2026-07-01 10:00")],
                "water_level_tpm": [2.1],
            }
        )
        tide = pd.DataFrame(
            {
                "datetime": [pd.Timestamp("2026-07-01 10:20")],
                "tide_cm": [135],
            }
        )

        merged = stage2_water_tide.merge_nearest(water_level, tide, 30)

        self.assertEqual(merged.loc[0, "tide_cm"], 135)
        self.assertEqual(merged.loc[0, "time_diff_minutes"], -20)

    def test_merge_hourly_keeps_full_water_history(self) -> None:
        water_level = pd.DataFrame(
            {
                "datetime": [
                    pd.Timestamp("2026-07-01 09:00"),
                    pd.Timestamp("2026-07-01 10:00"),
                ],
                "downstream_water_level_tpm": [2.4, 2.7],
                "upstream_water_level_tpm": [3.1, 3.2],
            }
        )
        tide = pd.DataFrame(
            {
                "datetime": [pd.Timestamp("2026-07-01 09:00")],
                "tide_cm": [450],
            }
        )

        merged = stage2_water_tide.merge_hourly(water_level, tide, "1h")

        self.assertEqual(merged.iloc[-1]["datetime"], pd.Timestamp("2026-07-01 10:00"))
        self.assertEqual(merged.iloc[-1]["downstream_water_level_tpm"], 2.7)
        self.assertTrue(pd.isna(merged.iloc[-1]["tide_cm"]))

    def test_merge_hourly_keeps_tide_when_water_is_empty(self) -> None:
        water_level = pd.DataFrame(
            columns=[
                "datetime",
                "downstream_water_level_tpm",
                "upstream_water_level_tpm",
            ]
        )
        tide = pd.DataFrame(
            {
                "datetime": [
                    pd.Timestamp("2026-07-01 09:00"),
                    pd.Timestamp("2026-07-01 10:00"),
                ],
                "tide_cm": [450, 460],
            }
        )

        merged = stage2_water_tide.merge_hourly(water_level, tide, "1h")

        self.assertEqual(len(merged), 2)
        self.assertEqual(merged.iloc[-1]["datetime"], pd.Timestamp("2026-07-01 10:00"))
        self.assertEqual(merged.iloc[-1]["tide_cm"], 460)

    def test_parse_tide736_response(self) -> None:
        response_json = {
            "status": 1,
            "tide": {
                "chart": {
                    "2026-06-30": {
                        "tide": [
                            {"time": "23:00", "cm": 410.5},
                            {"time": "24:00", "cm": 430.0},
                        ]
                    }
                }
            },
        }

        tide = stage2_water_tide.parse_tide736_response(response_json)

        self.assertEqual(len(tide), 2)
        self.assertEqual(tide.iloc[1]["datetime"], pd.Timestamp("2026-07-01 00:00"))
        self.assertEqual(tide.iloc[1]["tide_cm"], 430.0)


if __name__ == "__main__":
    unittest.main()
