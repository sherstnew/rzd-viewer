#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import Counter
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, NamedTuple

DEFAULT_SCHEDULE_PATH = Path("public/assets/local-trains-schedule.json")
DEFAULT_ROUTE = "mcd2"
DEFAULT_WEEKDAY_DATE = "2026-05-06"
DEFAULT_WEEKEND_DATE = "2026-05-16"
API_BASE_URL = "https://api.rasp.yandex-net.ru/v3.0"
SEARCH_DIRECTIONS: tuple[tuple[str, str], ...] = (
    ("s9600731", "s9601122"),
    ("s9601122", "s9600731"),
)
STATION_TITLES: dict[str, str] = {
    "s9600731": "Подольск",
    "s9601122": "Нахабино",
}
SEARCH_LIMIT = 200


class SearchCandidate(NamedTuple):
    date: str
    direction_from: str
    direction_to: str
    dedupe_key: str
    segment: dict[str, Any]


class SearchDirectionSummary(NamedTuple):
    date: str
    direction_from: str
    direction_to: str
    found_segments: int
    unique_segments: int
    subtype_counts: Counter[tuple[str, str]]


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()

    return values


def get_api_key() -> str:
    env_key = os.getenv("YANDEX_API_KEY")
    if env_key:
        return env_key.strip()

    file_values = parse_env_file(repo_root() / ".env")
    file_key = file_values.get("YANDEX_API_KEY", "").strip()
    if file_key:
        return file_key

    raise ValueError("YANDEX_API_KEY is missing in environment and .env")


def read_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def write_json(path: Path, payload: Any) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def format_direction(direction_from: str, direction_to: str) -> str:
    from_title = STATION_TITLES.get(direction_from, direction_from)
    to_title = STATION_TITLES.get(direction_to, direction_to)
    return f"{from_title} ({direction_from}) -> {to_title} ({direction_to})"


def api_get_json(path: str, query: dict[str, Any]) -> Any:
    url = f"{API_BASE_URL}/{path.lstrip('/')}"
    encoded_query = urllib.parse.urlencode(query)
    request = urllib.request.Request(f"{url}?{encoded_query}", method="GET")

    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            body = response.read().decode("utf-8")
            return json.loads(body)
    except urllib.error.HTTPError as error:
        body = ""
        try:
            body = error.read().decode("utf-8", errors="replace")
        except Exception:
            body = error.reason if isinstance(error.reason, str) else str(error.reason)
        raise RuntimeError(f"HTTP {error.code}: {body[:300]}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(str(error.reason)) from error


def iter_search_segments(
    api_key: str,
    date: str,
    direction_from: str,
    direction_to: str,
) -> Iterable[dict[str, Any]]:
    offset = 0
    total: int | None = None

    while total is None or offset < total:
        payload = api_get_json(
            "search/",
            {
                "apikey": api_key,
                "format": "json",
                "lang": "ru_RU",
                "from": direction_from,
                "to": direction_to,
                "date": date,
                "transport_types": "suburban",
                "limit": SEARCH_LIMIT,
                "offset": offset,
            },
        )

        segments = payload.get("segments")
        if not isinstance(segments, list):
            break

        pagination = payload.get("pagination", {})
        if isinstance(pagination, dict):
            raw_total = pagination.get("total")
            if isinstance(raw_total, int):
                total = raw_total

        for segment in segments:
            if not isinstance(segment, dict):
                continue
            yield segment

        if not segments:
            break
        offset += len(segments)


def build_thread_payload(
    api_key: str,
    uid: str,
    date: str,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    try:
        payload = api_get_json(
            "thread/",
            {
                "apikey": api_key,
                "format": "json",
                "lang": "ru_RU",
                "uid": uid,
                "date": date,
                "show_systems": "all",
            },
        )
    except RuntimeError as error:
        message = str(error).strip()
        status_code: int | None = None
        if message.startswith("HTTP "):
            parts = message.split(":", 1)[0].split()
            if len(parts) >= 2 and parts[1].isdigit():
                status_code = int(parts[1])
        return None, {"status_code": status_code, "message": message}

    if not isinstance(payload, dict):
        return None, {"status_code": None, "message": "Invalid thread payload format"}

    return payload, None


def collect_search_candidates(
    api_key: str,
    date: str,
    route: str,
) -> tuple[list[SearchCandidate], list[SearchDirectionSummary]]:
    candidates: list[SearchCandidate] = []
    summaries: list[SearchDirectionSummary] = []
    seen: set[str] = set()

    for from_code, to_code in SEARCH_DIRECTIONS:
        found_segments = 0
        unique_segments = 0
        subtype_counts: Counter[tuple[str, str]] = Counter()

        for segment in iter_search_segments(api_key, date, from_code, to_code):
            found_segments += 1
            thread = segment.get("thread")
            subtype = thread.get("transport_subtype") if isinstance(thread, dict) else None
            subtype_code = subtype.get("code") if isinstance(subtype, dict) else None
            subtype_title = subtype.get("title") if isinstance(subtype, dict) else None
            subtype_counts[
                (
                    subtype_code if isinstance(subtype_code, str) and subtype_code else "<no code>",
                    subtype_title if isinstance(subtype_title, str) and subtype_title else "<no title>",
                )
            ] += 1
            uid = thread.get("uid") if isinstance(thread, dict) else None
            departure = segment.get("departure")
            dedupe_key = f"{uid}|{departure}"
            if not isinstance(uid, str) or not uid or dedupe_key in seen:
                continue

            seen.add(dedupe_key)
            unique_segments += 1
            candidates.append(
                SearchCandidate(
                    date=date,
                    direction_from=from_code,
                    direction_to=to_code,
                    dedupe_key=dedupe_key,
                    segment=segment,
                )
            )

        summaries.append(
            SearchDirectionSummary(
                date=date,
                direction_from=from_code,
                direction_to=to_code,
                found_segments=found_segments,
                unique_segments=unique_segments,
                subtype_counts=subtype_counts,
            )
        )

    return candidates, summaries


def collect_route_segments_from_candidates(
    api_key: str,
    candidates: list[SearchCandidate],
    route: str,
) -> list[dict[str, Any]]:
    collected: list[dict[str, Any]] = []

    for index, candidate in enumerate(candidates, start=1):
        thread = candidate.segment.get("thread")
        uid = thread.get("uid") if isinstance(thread, dict) else None
        if not isinstance(uid, str) or not uid:
            continue

        print(f"Fetching thread {index}/{len(candidates)}: {uid}")
        thread_route, thread_error = build_thread_payload(api_key, uid, candidate.date)
        next_segment = dict(candidate.segment)
        next_segment["mcd_route_id"] = route
        next_segment["thread_route"] = thread_route
        next_segment["thread_error"] = thread_error
        collected.append(next_segment)

    collected.sort(
        key=lambda item: (
            str(item.get("departure", "")),
            str((item.get("thread") or {}).get("uid", "")),
        )
    )
    return collected


def print_search_summary(
    weekday_summaries: list[SearchDirectionSummary],
    weekend_summaries: list[SearchDirectionSummary],
) -> None:
    print("Search summary:")
    for summary in [*weekday_summaries, *weekend_summaries]:
        print(
            "  "
            f"{summary.date} | {format_direction(summary.direction_from, summary.direction_to)} | "
            f"found={summary.found_segments} | unique={summary.unique_segments}"
        )
        print("    train types from search:")
        for (code, title), count in summary.subtype_counts.most_common():
            print(f"      {count} | {code} | {title}")


def confirm_fetch(thread_request_count: int) -> bool:
    try:
        answer = input(f"Fetch {thread_request_count} thread requests and update file? [y/N] ")
    except EOFError:
        return False
    return answer.strip().lower() in {"y", "yes"}


def replace_route_segments(
    source_segments: list[Any],
    replacement_segments: list[dict[str, Any]],
    route: str,
) -> list[Any]:
    kept = [
        segment
        for segment in source_segments
        if not (isinstance(segment, dict) and segment.get("mcd_route_id") == route)
    ]
    return [*kept, *replacement_segments]


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate and replace only MCD-2 segments in local schedule JSON from official Yandex Rasp API.",
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=DEFAULT_SCHEDULE_PATH,
        help=f"Schedule JSON path (default: {DEFAULT_SCHEDULE_PATH.as_posix()})",
    )
    parser.add_argument("--weekday-date", default=DEFAULT_WEEKDAY_DATE)
    parser.add_argument("--weekend-date", default=DEFAULT_WEEKEND_DATE)
    parser.add_argument(
        "--route",
        default=DEFAULT_ROUTE,
        help="Local mcd_route_id to replace and assign to fetched Podolsk-Nakhabino segments.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Only run search requests and print the thread request estimate. Do not fetch threads or write the schedule.",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Skip the interactive confirmation before fetching thread routes and writing the schedule.",
    )
    args = parser.parse_args()

    input_path = args.input
    if not input_path.is_absolute():
        input_path = repo_root() / input_path

    try:
        api_key = get_api_key()
        payload = read_json(input_path)
        if not isinstance(payload, dict):
            raise ValueError("schedule payload must be an object")

        weekday_section = payload.get("weekday")
        weekend_section = payload.get("weekend")
        if not isinstance(weekday_section, dict) or not isinstance(weekend_section, dict):
            raise ValueError("weekday/weekend sections are required")

        weekday_segments = weekday_section.get("segments")
        weekend_segments = weekend_section.get("segments")
        if not isinstance(weekday_segments, list) or not isinstance(weekend_segments, list):
            raise ValueError("weekday/weekend segments must be arrays")

        print(f"Searching {args.route} weekday data for {args.weekday_date}...")
        weekday_candidates, weekday_summaries = collect_search_candidates(
            api_key,
            args.weekday_date,
            args.route,
        )

        print(f"Searching {args.route} weekend data for {args.weekend_date}...")
        weekend_candidates, weekend_summaries = collect_search_candidates(
            api_key,
            args.weekend_date,
            args.route,
        )

        print_search_summary(weekday_summaries, weekend_summaries)
        total_thread_requests = len(weekday_candidates) + len(weekend_candidates)
        print(f"Total thread requests needed: {total_thread_requests}")

        if args.dry_run:
            print("Dry run complete. No thread requests were fetched and no files were written.")
            return 0

        if total_thread_requests == 0:
            raise ValueError("No route candidates were found. Refusing to replace schedule with an empty route.")

        if not args.yes and not confirm_fetch(total_thread_requests):
            print("Cancelled. No thread requests were fetched and no files were written.")
            return 0

        print(f"Collecting {args.route} weekday thread data for {args.weekday_date}...")
        new_weekday_route_segments = collect_route_segments_from_candidates(
            api_key,
            weekday_candidates,
            args.route,
        )
        print(f"Collected weekday {args.route} segments: {len(new_weekday_route_segments)}")

        print(f"Collecting {args.route} weekend thread data for {args.weekend_date}...")
        new_weekend_route_segments = collect_route_segments_from_candidates(
            api_key,
            weekend_candidates,
            args.route,
        )
        print(f"Collected weekend {args.route} segments: {len(new_weekend_route_segments)}")

        weekday_section["segments"] = replace_route_segments(
            weekday_segments,
            new_weekday_route_segments,
            args.route,
        )
        weekend_section["segments"] = replace_route_segments(
            weekend_segments,
            new_weekend_route_segments,
            args.route,
        )
        weekday_section["date"] = args.weekday_date
        weekend_section["date"] = args.weekend_date
        payload["generated_at"] = utc_timestamp()

        write_json(input_path, payload)
        print(f"Updated {args.route} segments in {input_path}")
        return 0
    except Exception as error:
        print(f"Failed to generate schedule: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
