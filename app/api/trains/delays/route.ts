import { NextResponse } from "next/server"
import { fetchTextWithProxy } from "@/lib/proxy-http"
import stationsData from "@/public/assets/stations.json"
import type { TrainDelayEvent } from "@/lib/trains"

const YANDEX_BATCH_URL = "https://rasp.yandex.ru/api/batch"
const MOSCOW_TIMEZONE = "Europe/Moscow"
const DELAYS_CACHE_TTL_MS = 5 * 60 * 1000

const SEARCH_DIRECTIONS: ReadonlyArray<{ from: string; to: string }> = [
  { from: "s9600731", to: "s9601122" },
  { from: "s9601122", to: "s9600731" },
  { from: "s9600721", to: "s9600781" },
  { from: "s9600781", to: "s9600721" },
  { from: "s9600212", to: "s9601197" },
  { from: "s9601197", to: "s9600212" },
  { from: "s9601102", to: "s9601675" },
  { from: "s9601675", to: "s9601102" },
  { from: "s2000005", to: "s9600811" },
  { from: "s9600811", to: "s2000005" },
  { from: "s2000002", to: "s9600701" },
  { from: "s9600701", to: "s2000002" },
  { from: "s9600681", to: "s9602217" },
  { from: "s9602217", to: "s9600681" },
]

type StationSource = {
  key: string
  title: string
  slug: string
}

type BatchSearchSegment = {
  arrivalEvent?: TrainDelayEvent | null
  departureEvent?: TrainDelayEvent | null
  startDate?: unknown
  thread?: {
    uid?: unknown
  }
}

type BatchResponse = {
  data?: Array<{
    data?: {
      search?: {
        segments?: BatchSearchSegment[]
        teasers?: {
          attention?: {
            content?: unknown
          }
        }
      }
    }
    error?: unknown
  }>
}

type DelayPayload = {
  departure_event: TrainDelayEvent | null
  arrival_event: TrainDelayEvent | null
}

type TrainNotice = {
  direction: {
    from: string
    to: string
  }
  lines: string[]
}

type CachedDelaysPayload = {
  date: string
  fetchedAt: number
  delaysByUid: Record<string, DelayPayload>
  notices: TrainNotice[]
}

let delaysCache: CachedDelaysPayload | null = null

function emptyDelaysPayload(date: string, fetchedAt: number): CachedDelaysPayload {
  return {
    date,
    fetchedAt,
    delaysByUid: {},
    notices: [],
  }
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
}

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

function getTodayMoscowDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MOSCOW_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
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
            key: from.key,
            title: from.title,
            slug: from.slug,
          },
          to: {
            key: to.key,
            title: to.title,
            slug: to.slug,
          },
        },
        transportType: "suburban",
        from,
        originalFrom: from,
        to,
        originalTo: to,
        when: {
          date,
        },
        time: {
          now: Date.now(),
          timezone: MOSCOW_TIMEZONE,
        },
        language: "ru",
        searchForPastDate: false,
      },
      isMobile: false,
      excludeTrains: false,
      nationalVersion: "ru",
      groupTrains: false,
      allowChangeContext: true,
    },
  }
}

function isDelayEvent(value: unknown): value is TrainDelayEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  const record = value as { type?: unknown }
  return typeof record.type === "string" && record.type.length > 0
}

function toDelayEvent(value: unknown): TrainDelayEvent | null {
  return isDelayEvent(value) ? value : null
}

function toLogPreview(value: unknown): string {
  if (typeof value === "string") {
    return value.slice(0, 2000)
  }

  try {
    return JSON.stringify(value).slice(0, 2000)
  } catch {
    return String(value).slice(0, 2000)
  }
}

function isLikelyCaptchaOrHtmlResponse(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return (
    normalized.startsWith("<!doctype html") ||
    normalized.startsWith("<html") ||
    normalized.includes("captcha") ||
    normalized.includes("вы не робот")
  )
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&bull;/gi, " ")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
}

function htmlToNoticeLines(value: string): string[] {
  return decodeHtmlEntities(value)
    .replace(/\r/g, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/li\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<[^>]*>/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
}

function noticeKey(lines: string[]): string {
  return lines.join("\n").toLowerCase()
}

async function fetchBatchDelays(date: string): Promise<{
  delaysByUid: Record<string, DelayPayload>
  notices: TrainNotice[]
}> {
  const body = JSON.stringify({
    methods: SEARCH_DIRECTIONS.map((direction) => buildBatchSearchMethod(direction, date)),
  })

  let responseStatus = 0
  let responseText = ""

  try {
    const response = await fetchTextWithProxy(YANDEX_BATCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body,
    })
    responseStatus = response.status
    responseText = response.text
  } catch (error) {
    console.error("[trains/delays] batch request failed", error)
    throw error
  }

  if (responseStatus < 200 || responseStatus >= 300) {
    if (isLikelyCaptchaOrHtmlResponse(responseText) || responseStatus === 403 || responseStatus === 429) {
      console.warn("[trains/delays] upstream returned captcha or rate-limit response; using empty delays payload")
      return { delaysByUid: {}, notices: [] }
    }

    console.warn("[trains/delays] batch API returned non-OK response", {
      status: responseStatus,
      body: toLogPreview(responseText),
    })
    return { delaysByUid: {}, notices: [] }
  }

  let payload: BatchResponse
  try {
    payload = JSON.parse(responseText) as BatchResponse
  } catch (error) {
    if (isLikelyCaptchaOrHtmlResponse(responseText)) {
      console.warn("[trains/delays] upstream returned HTML/captcha instead of JSON; using empty delays payload")
      return { delaysByUid: {}, notices: [] }
    }

    console.warn("[trains/delays] batch API returned invalid JSON; using empty delays payload", {
      error: error instanceof Error ? error.message : String(error),
      body: toLogPreview(responseText),
    })
    return { delaysByUid: {}, notices: [] }
  }

  const delaysByUid: Record<string, DelayPayload> = {}
  const notices: TrainNotice[] = []
  const seenNotices = new Set<string>()
  const items = Array.isArray(payload.data) ? payload.data : []

  SEARCH_DIRECTIONS.forEach((direction, index) => {
    const item = items[index]
    if (item?.error) {
      console.error("[trains/delays] batch method returned error", {
        direction,
        response: toLogPreview(item),
      })
    }

    const segments = item?.data?.search?.segments
    if (!Array.isArray(segments)) {
      console.error("[trains/delays] batch method returned no search segments", {
        direction,
        response: toLogPreview(item),
      })
      return
    }

    const attentionContent = item.data?.search?.teasers?.attention?.content
    if (typeof attentionContent === "string") {
      const lines = htmlToNoticeLines(attentionContent)
      const key = noticeKey(lines)
      if (lines.length > 0 && !seenNotices.has(key)) {
        seenNotices.add(key)
        notices.push({
          direction,
          lines,
        })
      }
    }

    for (const segment of segments) {
      const uid = typeof segment.thread?.uid === "string" ? segment.thread.uid : null
      if (!uid) {
        continue
      }

      const departureEvent = toDelayEvent(segment.departureEvent)
      const arrivalEvent = toDelayEvent(segment.arrivalEvent)
      if (!departureEvent && !arrivalEvent) {
        continue
      }

      delaysByUid[uid] = {
        departure_event: departureEvent,
        arrival_event: arrivalEvent,
      }
    }
  })

  return { delaysByUid, notices }
}

async function getDelaysPayload(): Promise<CachedDelaysPayload> {
  const today = getTodayMoscowDate()
  const now = Date.now()
  if (delaysCache?.date === today && now - delaysCache.fetchedAt < DELAYS_CACHE_TTL_MS) {
    return delaysCache
  }

  try {
    const result = await fetchBatchDelays(today)
    const payload = {
      date: today,
      fetchedAt: now,
      delaysByUid: result.delaysByUid,
      notices: result.notices,
    }
    delaysCache = payload
    return payload
  } catch (error) {
    console.warn("[trains/delays] fetch failed; using cached/empty payload", error)
    return delaysCache?.date === today ? delaysCache : emptyDelaysPayload(today, now)
  }
}

export async function GET() {
  try {
    const payload = await getDelaysPayload()
    return NextResponse.json(payload)
  } catch (error) {
    const today = getTodayMoscowDate()
    const now = Date.now()
    console.warn("[trains/delays] failed to build payload; returning empty delays", error)
    return NextResponse.json(delaysCache?.date === today ? delaysCache : emptyDelaysPayload(today, now))
  }
}
