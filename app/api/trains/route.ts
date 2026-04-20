import { NextResponse } from "next/server"

const YANDEX_API_BASE = "https://api.rasp.yandex.net/v3.0"
const PODOLSK_CODE = "s9600731"
const NAKHABINO_CODE = "s9601122"
const ODINTSOVO_CODE = "s9600721"
const LOBNYA_CODE = "s9600781"
const ZELENOGRAD_KRYUKOVO_CODE = "s9600212"
const IPPODROM_CODE = "s9601197"
const SEARCH_LIMIT = 200
const SEARCH_DIRECTIONS: ReadonlyArray<{ from: string; to: string; mcd_route_id: McdRouteId }> = [
  { from: PODOLSK_CODE, to: NAKHABINO_CODE, mcd_route_id: "mcd2" },
  { from: NAKHABINO_CODE, to: PODOLSK_CODE, mcd_route_id: "mcd2" },
  { from: ODINTSOVO_CODE, to: LOBNYA_CODE, mcd_route_id: "mcd1" },
  { from: LOBNYA_CODE, to: ODINTSOVO_CODE, mcd_route_id: "mcd1" },
  { from: ZELENOGRAD_KRYUKOVO_CODE, to: IPPODROM_CODE, mcd_route_id: "mcd3" },
  { from: IPPODROM_CODE, to: ZELENOGRAD_KRYUKOVO_CODE, mcd_route_id: "mcd3" },
]

type McdRouteId = "mcd1" | "mcd2" | "mcd3"

type SearchSegment = Record<string, unknown> & {
  mcd_route_id?: McdRouteId
  thread?: {
    uid?: string
  }
}

type SearchResponse = {
  segments?: SearchSegment[]
}

type CachedPayload = {
  date: string
  segments: SearchSegment[]
}

let dailyCache: CachedPayload | null = null

function getTodayMoscowDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return "Unknown error"
}

async function fetchWithRetry(url: URL, retries = 2): Promise<Response> {
  let attempt = 0
  let lastError: unknown = null

  while (attempt <= retries) {
    try {
      const response = await fetch(url, { method: "GET", cache: "no-store" })
      if (response.ok) {
        return response
      }

      const shouldRetry =
        response.status === 429 ||
        response.status === 500 ||
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504

      if (!shouldRetry || attempt === retries) {
        return response
      }
    } catch (error) {
      lastError = error
      if (attempt === retries) {
        throw error
      }
    }

    attempt += 1
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
  }

  if (lastError) {
    throw lastError
  }

  throw new Error("Request failed")
}

async function fetchSearchSegments(apiKey: string, date: string): Promise<SearchSegment[]> {
  const allSegments: SearchSegment[] = []

  for (const direction of SEARCH_DIRECTIONS) {
    const url = new URL(`${YANDEX_API_BASE}/search/`)
    url.searchParams.set("apikey", apiKey)
    url.searchParams.set("from", direction.from)
    url.searchParams.set("to", direction.to)
    url.searchParams.set("transport_types", "suburban")
    url.searchParams.set("transfers", "false")
    url.searchParams.set("date", date)
    url.searchParams.set("limit", String(SEARCH_LIMIT))

    const response = await fetchWithRetry(url)
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Search request failed (${response.status}): ${text.slice(0, 200)}`)
    }

    const json = (await response.json()) as SearchResponse
    const segments = Array.isArray(json.segments) ? json.segments : []
    allSegments.push(
      ...segments.map((segment) => ({
        ...segment,
        mcd_route_id: direction.mcd_route_id,
      })),
    )
  }

  return allSegments
}

async function getDailySegments(): Promise<CachedPayload> {
  const today = getTodayMoscowDate()
  if (dailyCache?.date === today) {
    return dailyCache
  }

  const apiKey = process.env.YANDEX_API_KEY
  if (!apiKey) {
    throw new Error("YANDEX_API_KEY is not configured")
  }

  const segments = await fetchSearchSegments(apiKey, today)
  const payload = { date: today, segments }
  dailyCache = payload

  return payload
}

export async function GET() {
  try {
    const payload = await getDailySegments()
    return NextResponse.json(payload.segments)
  } catch (error) {
    const message = toErrorMessage(error)
    return NextResponse.json(
      { error: "Failed to load trains from Yandex API", details: message },
      { status: 500 },
    )
  }
}
