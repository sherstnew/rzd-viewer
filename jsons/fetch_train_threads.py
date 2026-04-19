import argparse
import json
import os
import time
from pathlib import Path
from typing import Any
from urllib import error, parse, request


DEFAULT_INPUT = "jsons/trains.json"
DEFAULT_OUTPUT = "jsons/trains-with-threads.json"
DEFAULT_BASE_URL = "https://api.rasp.yandex.net/v3.0/thread/"
DEFAULT_TIMEOUT = 10.0
DEFAULT_DELAY = 0.2
MAX_ATTEMPTS = 3
RETRYABLE_STATUSES = {429, 500, 502, 503, 504}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Fetches route threads for each train segment from trains.json "
            "using Yandex Rasp API and writes merged output JSON."
        )
    )
    parser.add_argument("--input", default=DEFAULT_INPUT, help="Input JSON path")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="Output JSON path")
    parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help="Yandex Rasp thread endpoint URL",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional segment limit for smoke runs",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_DELAY,
        help="Delay in seconds between successful requests",
    )
    return parser.parse_args()


def read_env_file(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env

    for line in path.read_text(encoding="utf-8").splitlines():
        raw = line.strip()
        if not raw or raw.startswith("#") or "=" not in raw:
            continue
        key, value = raw.split("=", 1)
        env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def get_api_key(project_root: Path) -> str:
    from_os = os.environ.get("YANDEX_API_KEY")
    if from_os:
        return from_os

    env_values = read_env_file(project_root / ".env")
    key = env_values.get("YANDEX_API_KEY")
    if key:
        return key

    raise RuntimeError("YANDEX_API_KEY not found in environment or .env file")


def load_input(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    segments = payload.get("segments")
    if not isinstance(segments, list):
        raise ValueError("Input file must contain 'segments' array")
    return payload, segments


def build_url(base_url: str, params: dict[str, str]) -> str:
    base = base_url.rstrip("/") + "/"
    return f"{base}?{parse.urlencode(params)}"


def request_thread(
    *,
    base_url: str,
    api_key: str,
    uid: str,
    date: str,
    timeout: float,
) -> tuple[Any | None, dict[str, Any] | None]:
    params = {"apikey": api_key, "uid": uid, "date": date}
    url = build_url(base_url, params)

    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            req = request.Request(url, method="GET")
            with request.urlopen(req, timeout=timeout) as resp:
                status = resp.status
                body = resp.read().decode("utf-8")
                if status >= 400:
                    message = f"HTTP {status}"
                    if status in RETRYABLE_STATUSES and attempt < MAX_ATTEMPTS:
                        time.sleep(0.5 * (2 ** (attempt - 1)))
                        continue
                    return None, {"status_code": status, "message": message}

                return json.loads(body), None
        except error.HTTPError as exc:
            status = exc.code
            try:
                text = exc.read().decode("utf-8", errors="replace")
            except Exception:
                text = str(exc)

            if status in RETRYABLE_STATUSES and attempt < MAX_ATTEMPTS:
                time.sleep(0.5 * (2 ** (attempt - 1)))
                continue
            return None, {"status_code": status, "message": text[:500]}
        except error.URLError as exc:
            if attempt < MAX_ATTEMPTS:
                time.sleep(0.5 * (2 ** (attempt - 1)))
                continue
            return None, {"status_code": None, "message": str(exc.reason)}
        except TimeoutError:
            if attempt < MAX_ATTEMPTS:
                time.sleep(0.5 * (2 ** (attempt - 1)))
                continue
            return None, {"status_code": None, "message": "Request timed out"}
        except json.JSONDecodeError as exc:
            return None, {"status_code": None, "message": f"Invalid JSON: {exc}"}
        except Exception as exc:
            return None, {"status_code": None, "message": str(exc)}

    return None, {"status_code": None, "message": "Unknown request failure"}


def process_segments(
    *,
    payload: dict[str, Any],
    segments: list[dict[str, Any]],
    api_key: str,
    base_url: str,
    timeout: float,
    delay: float,
    limit: int | None,
) -> list[dict[str, Any]]:
    selected = segments if limit is None else segments[:limit]
    default_date = payload.get("search", {}).get("date")
    output: list[dict[str, Any]] = []

    for idx, segment in enumerate(selected, start=1):
        item = dict(segment)
        thread = segment.get("thread") or {}
        uid = thread.get("uid")
        date = segment.get("start_date") or default_date

        if not uid or not date:
            item["thread_route"] = None
            item["thread_error"] = {
                "status_code": None,
                "message": "Missing thread.uid or date for request",
            }
            output.append(item)
            print(f"[{idx}/{len(selected)}] skipped: missing uid/date")
            continue

        route, err = request_thread(
            base_url=base_url,
            api_key=api_key,
            uid=uid,
            date=date,
            timeout=timeout,
        )
        item["thread_route"] = route
        item["thread_error"] = err
        output.append(item)

        if err is None:
            print(f"[{idx}/{len(selected)}] ok: {uid}")
            if delay > 0:
                time.sleep(delay)
        else:
            print(f"[{idx}/{len(selected)}] error: {uid} -> {err.get('message')}")

    return output


def main() -> int:
    args = parse_args()
    project_root = Path(__file__).resolve().parents[1]
    input_path = (project_root / args.input).resolve()
    output_path = (project_root / args.output).resolve()

    if args.limit is not None and args.limit <= 0:
        raise ValueError("--limit must be > 0")

    api_key = get_api_key(project_root)
    payload, segments = load_input(input_path)

    print(f"Loaded {len(segments)} segments from {input_path}")
    merged = process_segments(
        payload=payload,
        segments=segments,
        api_key=api_key,
        base_url=args.base_url,
        timeout=DEFAULT_TIMEOUT,
        delay=args.delay,
        limit=args.limit,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote {len(merged)} records to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
