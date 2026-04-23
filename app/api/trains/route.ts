import { NextResponse } from "next/server"
import stationsData from "@/public/assets/stations.json"

const YANDEX_API_BASE = "https://api.rasp.yandex.net/v3.0"
const YANDEX_BATCH_URL = "https://rasp.yandex.ru/api/batch"
const PODOLSK_CODE = "s9600731"
const NAKHABINO_CODE = "s9601122"
const ODINTSOVO_CODE = "s9600721"
const LOBNYA_CODE = "s9600781"
const ZELENOGRAD_KRYUKOVO_CODE = "s9600212"
const IPPODROM_CODE = "s9601197"
const MOSCOW_PAVELETSKY_CODE = "s2000005"
const DOMODEDOVO_CODE = "s9600811"
const MOSCOW_YAROSLAVSKY_CODE = "s2000002"
const PUSHKINO_CODE = "s9600701"
const MYTISHCHI_CODE = "s9600681"
const BOLSHEVO_CODE = "s9602217"
const SEARCH_LIMIT = 200
const BATCH_CACHE_TTL_MS = 30_000
const MOSCOW_TIMEZONE = "Europe/Moscow"
const SEARCH_DIRECTIONS: ReadonlyArray<{ from: string; to: string; mcd_route_id: McdRouteId }> = [
  { from: PODOLSK_CODE, to: NAKHABINO_CODE, mcd_route_id: "mcd2" },
  { from: NAKHABINO_CODE, to: PODOLSK_CODE, mcd_route_id: "mcd2" },
  { from: ODINTSOVO_CODE, to: LOBNYA_CODE, mcd_route_id: "mcd1" },
  { from: LOBNYA_CODE, to: ODINTSOVO_CODE, mcd_route_id: "mcd1" },
  { from: ZELENOGRAD_KRYUKOVO_CODE, to: IPPODROM_CODE, mcd_route_id: "mcd3" },
  { from: IPPODROM_CODE, to: ZELENOGRAD_KRYUKOVO_CODE, mcd_route_id: "mcd3" },
  { from: MOSCOW_PAVELETSKY_CODE, to: DOMODEDOVO_CODE, mcd_route_id: "mcd5_south" },
  { from: DOMODEDOVO_CODE, to: MOSCOW_PAVELETSKY_CODE, mcd_route_id: "mcd5_south" },
  { from: MOSCOW_YAROSLAVSKY_CODE, to: PUSHKINO_CODE, mcd_route_id: "mcd5_north" },
  { from: PUSHKINO_CODE, to: MOSCOW_YAROSLAVSKY_CODE, mcd_route_id: "mcd5_north" },
  { from: MYTISHCHI_CODE, to: BOLSHEVO_CODE, mcd_route_id: "mcd5_korolev" },
  { from: BOLSHEVO_CODE, to: MYTISHCHI_CODE, mcd_route_id: "mcd5_korolev" },
]

type McdRouteId = "mcd1" | "mcd2" | "mcd3" | "mcd5_south" | "mcd5_north" | "mcd5_korolev"

type Nullable<T> = T | null

type DelayEvent = {
  type?: unknown
  minutesFromNew?: unknown
  minutesToNew?: unknown
  minutesFrom?: unknown
  minutesTo?: unknown
}

type SearchSegment = Record<string, unknown> & {
  mcd_route_id?: McdRouteId
  thread?: Record<string, unknown> & {
    uid?: string
  }
}

type SearchResponse = {
  segments?: SearchSegment[]
}

type BatchResponse = {
  data?: Array<{
    data?: {
      search?: {
        segments?: BatchSearchSegment[]
      }
    }
  }>
}

type BatchStation = {
  id?: unknown
  title?: unknown
  popularTitle?: unknown
  timezone?: unknown
  country?: {
    code?: unknown
  }
  settlement?: {
    title?: unknown
  }
  platform?: unknown
}

type BatchSearchSegment = {
  arrival?: unknown
  departure?: unknown
  arrivalLocalDt?: unknown
  departureLocalDt?: unknown
  duration?: unknown
  number?: unknown
  startDate?: unknown
  stops?: unknown
  hasTransfers?: unknown
  ticketsInfo?: unknown
  arrivalEvent?: DelayEvent | null
  departureEvent?: DelayEvent | null
  title?: unknown
  stationFrom?: BatchStation
  stationTo?: BatchStation
  company?: {
    id?: unknown
    title?: unknown
    url?: unknown
  }
  transport?: {
    code?: unknown
    subtype?: {
      title?: unknown
      code?: unknown
      titleColor?: unknown
    }
  }
  thread?: {
    number?: unknown
    title?: unknown
    uid?: unknown
    canonicalUid?: unknown
  }
}

type StationSource = {
  key: string
  title: string
  slug: string
}

type CachedPayload = {
  date: string
  fetchedAt: number
  segments: SearchSegment[]
}

let dailyCache: CachedPayload | null = null

const stationSourceByCode = new Map<string, StationSource>(
  Array.isArray(stationsData)
    ? stationsData.flatMap((station): Array<[string, StationSource]> => {
        const record = station as Record<string, unknown>
        const codes = record.codes as { yandex_code?: unknown } | undefined
        const key = typeof codes?.yandex_code === "string" ? codes.yandex_code : null
        const title = typeof record.title === "string" ? record.title : null

        if (!key || !title) {
          return []
        }

        return [[key, { key, title, slug: slugify(title) }]]
      })
    : [],
)

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
}

function getTodayMoscowDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MOSCOW_TIMEZONE,
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

function toStringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function toNumberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function toNullableNumber(value: unknown): Nullable<number> {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function stationCodeFromId(id: unknown): string {
  return typeof id === "number" && Number.isFinite(id) ? `s${id}` : ""
}

function stationSource(code: string): StationSource {
  return stationSourceByCode.get(code) ?? { key: code, title: code, slug: code }
}

function buildBatchPoint(code: string) {
  const source = stationSource(code)

  return {
    key: source.key,
    title: source.title,
    timezone: MOSCOW_TIMEZONE,
    country: {
      code: "RU",
      title: "",
      railwayTimezone: MOSCOW_TIMEZONE,
    },
    region: {
      title: "Москва и Московская область",
    },
    settlement: {
      title: source.title,
      slug: source.slug,
      key: "",
    },
    titleGenitive: source.title,
    titleAccusative: source.title,
    titleLocative: source.title,
    preposition: "в",
    shortTitle: null,
    popularTitle: null,
    slug: source.slug,
  }
}

function buildBatchSearchMethod(direction: (typeof SEARCH_DIRECTIONS)[number], date: string) {
  const from = buildBatchPoint(direction.from)
  const to = buildBatchPoint(direction.to)

  return {
    method: "search",
    params: {
      context: {
        userInput: {
          from: {
            title: from.title,
            key: from.key,
            slug: from.slug,
          },
          to: {
            title: to.title,
            key: to.key,
            slug: to.slug,
          },
        },
        transportType: "suburban",
        from,
        originalFrom: from,
        to,
        originalTo: to,
        searchNext: false,
        when: {
          date,
        },
        time: {
          now: Date.now(),
          timezone: MOSCOW_TIMEZONE,
        },
        language: "ru",
      },
      isMobile: false,
      excludeTrains: false,
      nationalVersion: "ru",
      groupTrains: false,
      allowChangeContext: true,
    },
  }
}

async function fetchWithRetry(input: string | URL, init: RequestInit, retries = 2): Promise<Response> {
  let attempt = 0
  let lastError: unknown = null

  while (attempt <= retries) {
    try {
      const response = await fetch(input, init)
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

function mapDelayEvent(event: DelayEvent | null | undefined) {
  if (!event || typeof event !== "object") {
    return null
  }

  const type = toStringValue(event.type)
  if (!type) {
    return null
  }

  return {
    type,
    minutesFromNew: toNullableNumber(event.minutesFromNew),
    minutesToNew: toNullableNumber(event.minutesToNew),
    minutesFrom: toNullableNumber(event.minutesFrom),
    minutesTo: toNullableNumber(event.minutesTo),
  }
}

function mapBatchStation(station: BatchStation | undefined) {
  const code = stationCodeFromId(station?.id)
  const title = toStringValue(station?.title, code)
  const popularTitle = toStringValue(station?.popularTitle)

  return {
    type: "station",
    title,
    short_title: popularTitle || title,
    popular_title: popularTitle || null,
    code,
    station_type: "station",
    station_type_name: "станция",
    transport_type: "train",
  }
}

function mapBatchSegment(segment: BatchSearchSegment, mcdRouteId: McdRouteId): SearchSegment {
  const stationFrom = mapBatchStation(segment.stationFrom)
  const stationTo = mapBatchStation(segment.stationTo)
  const companyId = toNumberValue(segment.company?.id)
  const companyTitle = toStringValue(segment.company?.title)
  const threadNumber = toStringValue(segment.thread?.number, toStringValue(segment.number))
  const threadTitle = toStringValue(segment.thread?.title, toStringValue(segment.title))
  const uid = toStringValue(segment.thread?.uid, `${threadNumber}_${stationFrom.code}_${segment.startDate}`)
  const departure = toStringValue(segment.departureLocalDt, toStringValue(segment.departure))
  const arrival = toStringValue(segment.arrivalLocalDt, toStringValue(segment.arrival))

  return {
    mcd_route_id: mcdRouteId,
    thread: {
      number: threadNumber,
      title: threadTitle,
      short_title: threadTitle,
      express_type: null,
      transport_type: toStringValue(segment.transport?.code, "suburban"),
      carrier: {
        code: companyId,
        title: companyTitle,
        codes: {
          sirena: null,
          iata: null,
          icao: null,
        },
        url: toStringValue(segment.company?.url) || undefined,
      },
      uid,
      vehicle: null,
      transport_subtype: {
        title: toStringValue(segment.transport?.subtype?.title),
        code: toStringValue(segment.transport?.subtype?.code),
        color: toStringValue(segment.transport?.subtype?.titleColor),
      },
    },
    stops: toStringValue(segment.stops),
    from: stationFrom,
    to: stationTo,
    departure_platform: toStringValue(segment.stationFrom?.platform) || null,
    arrival_platform: toStringValue(segment.stationTo?.platform) || null,
    departure_terminal: null,
    arrival_terminal: null,
    duration: toNumberValue(segment.duration),
    has_transfers: Boolean(segment.hasTransfers),
    tickets_info: segment.ticketsInfo ?? null,
    departure,
    arrival,
    start_date: toStringValue(segment.startDate, departure.slice(0, 10)),
    departure_event: mapDelayEvent(segment.departureEvent),
    arrival_event: mapDelayEvent(segment.arrivalEvent),
  }
}

async function fetchBatchSearchSegments(date: string): Promise<SearchSegment[]> {
  const body = JSON.stringify({
    methods: SEARCH_DIRECTIONS.map((direction) => buildBatchSearchMethod(direction, date)),
  })

  const response = await fetchWithRetry(YANDEX_BATCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
    cache: "no-store",
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Batch search request failed (${response.status}): ${text.slice(0, 200)}`)
  }

  const json = (await response.json()) as BatchResponse
  const allSegments: SearchSegment[] = []

  SEARCH_DIRECTIONS.forEach((direction, index) => {
    const segments = json.data?.[index]?.data?.search?.segments
    if (!Array.isArray(segments)) {
      return
    }

    allSegments.push(...segments.map((segment) => mapBatchSegment(segment, direction.mcd_route_id)))
  })

  if (allSegments.length === 0) {
    throw new Error("Batch search returned no train segments")
  }

  return allSegments
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

    const response = await fetchWithRetry(url, { method: "GET", cache: "no-store" })
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

async function getFallbackSegments(date: string, batchError: unknown): Promise<SearchSegment[]> {
  const apiKey = process.env.YANDEX_API_KEY
  if (!apiKey) {
    throw new Error(`Batch failed and YANDEX_API_KEY is not configured: ${toErrorMessage(batchError)}`)
  }

  return fetchSearchSegments(apiKey, date)
}

async function getDailySegments(): Promise<CachedPayload> {
  const today = getTodayMoscowDate()
  const now = Date.now()
  if (dailyCache?.date === today && now - dailyCache.fetchedAt < BATCH_CACHE_TTL_MS) {
    return dailyCache
  }

  let segments: SearchSegment[]
  try {
    segments = await fetchBatchSearchSegments(today)
  } catch (batchError) {
    segments = await getFallbackSegments(today, batchError)
  }

  const payload = { date: today, fetchedAt: now, segments }
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
