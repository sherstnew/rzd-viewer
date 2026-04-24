#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

DEFAULT_SCHEDULE_PATH = Path("public/assets/local-trains-schedule.json")


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def validate_section(payload: Any, key: str) -> tuple[int, int, int]:
    if not isinstance(payload, dict):
        raise ValueError("schedule payload must be an object")

    section = payload.get(key)
    if not isinstance(section, dict):
        raise ValueError(f"{key} section is missing")

    date = section.get("date")
    if not isinstance(date, str) or not date:
        raise ValueError(f"{key}.date is missing")

    segments = section.get("segments")
    if not isinstance(segments, list):
        raise ValueError(f"{key}.segments must be an array")

    with_uid = 0
    with_thread_route_stops = 0
    for segment in segments:
        if not isinstance(segment, dict):
            continue

        thread = segment.get("thread")
        if isinstance(thread, dict) and isinstance(thread.get("uid"), str) and thread["uid"]:
            with_uid += 1

        route = segment.get("thread_route")
        if isinstance(route, dict) and isinstance(route.get("stops"), list):
            with_thread_route_stops += 1

    return len(segments), with_uid, with_thread_route_stops


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate local offline train schedule data."
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_SCHEDULE_PATH,
        help=f"Schedule JSON path (default: {DEFAULT_SCHEDULE_PATH.as_posix()})",
    )
    args = parser.parse_args()

    schedule_path = args.input
    if not schedule_path.is_absolute():
        schedule_path = repo_root() / schedule_path

    try:
        payload = read_json(schedule_path)
        if not isinstance(payload, dict):
            raise ValueError("schedule payload must be an object")
        if not isinstance(payload.get("generated_at"), str):
            raise ValueError("generated_at is missing")

        weekday_total, weekday_uid, weekday_routes = validate_section(payload, "weekday")
        weekend_total, weekend_uid, weekend_routes = validate_section(payload, "weekend")
    except (OSError, json.JSONDecodeError, ValueError) as error:
        print(f"Invalid local schedule: {error}", file=sys.stderr)
        return 1

    print(f"Schedule: {schedule_path}")
    print(f"weekday: segments={weekday_total}, uid={weekday_uid}, thread_route_stops={weekday_routes}")
    print(f"weekend: segments={weekend_total}, uid={weekend_uid}, thread_route_stops={weekend_routes}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
