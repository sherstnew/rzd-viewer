import { NextResponse } from "next/server"
import {
  normalizeLongDistanceLiveObjects,
  type YandexLiveObjectsPayload,
} from "@/lib/long-distance-trains"

const YANDEX_LIVE_OBJECTS_URL = "https://rasp.yandex.ru/maps/train/objects"
const LIVE_OBJECTS_CACHE_TTL_MS = 60_000

type LiveTrainObject = {
  id: string
  uid: string
  date: string | null
  number: string
  longitude: number
  latitude: number
  timestamp: number | null
  expires: number | null
}
type CachedLiveObjectsPayload = {
  fetchedAt: number
  trains: LiveTrainObject[]
  timestamp: unknown
  expires: unknown
}

const liveObjectsCache = new Map<string, CachedLiveObjectsPayload>()

class LiveObjectsParseError extends Error {
  constructor(
    message: string,
    readonly preview: string,
  ) {
    super(message)
  }
}

function toFiniteNumber(value: string | null): number | null {
  if (!value) {
    return null
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function toResponsePreview(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 300)
}

function parsePayloadText(value: string): YandexLiveObjectsPayload {
  try {
    return JSON.parse(value) as YandexLiveObjectsPayload
  } catch (jsonError) {
    const normalizedTopLevelKeys = value.replace(
      /([{,])\s*(objects|timestamp|expires|info)\s*:/g,
      '$1"$2":',
    )

    if (normalizedTopLevelKeys !== value) {
      return JSON.parse(normalizedTopLevelKeys) as YandexLiveObjectsPayload
    }

    throw jsonError
  }
}

function parseJsonpPayload(text: string, expectedCallback: string): YandexLiveObjectsPayload {
  const body = text.trim().replace(/^\/\*\*\/\s*/, "")
  const callbackPrefix = `${expectedCallback}(`
  const preview = toResponsePreview(body)

  if (/^<!doctype html/i.test(body) || body.includes("Вы не робот?")) {
    throw new LiveObjectsParseError("Yandex returned anti-bot HTML instead of live objects JSONP", preview)
  }

  if (body.startsWith(callbackPrefix) && body.endsWith(")")) {
    return parsePayloadText(body.slice(callbackPrefix.length, -1))
  }

  if (body.startsWith("{") && body.endsWith("}")) {
    return parsePayloadText(body)
  }

  const callbackStart = body.indexOf(callbackPrefix)
  if (callbackStart !== -1) {
    const payloadStart = callbackStart + callbackPrefix.length
    const payloadEnd = body.lastIndexOf(")")
    if (payloadEnd > payloadStart) {
      return parsePayloadText(body.slice(payloadStart, payloadEnd))
    }
  }

  const jsonStart = body.indexOf("{")
  const jsonEnd = body.lastIndexOf("}")

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    throw new LiveObjectsParseError("Live objects response is not valid JSONP", preview)
  }

  try {
    return parsePayloadText(body.slice(jsonStart, jsonEnd + 1))
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown JSON parse error"
    throw new LiveObjectsParseError(message, preview)
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const center = requestUrl.searchParams.get("center")
  const span = requestUrl.searchParams.get("span")
  const zoom = toFiniteNumber(requestUrl.searchParams.get("zoom"))

  if (!center || !span || zoom === null) {
    return NextResponse.json(
      { error: "center, span and zoom query parameters are required" },
      { status: 400 },
    )
  }

  const callback = `jsonp_${Date.now()}`
  const cacheKey = `${center}|${span}|${Math.round(zoom)}`
  const cached = liveObjectsCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt <= LIVE_OBJECTS_CACHE_TTL_MS) {
    return NextResponse.json({
      trains: cached.trains,
      timestamp: cached.timestamp ?? null,
      expires: cached.expires ?? null,
    })
  }

  const url = new URL(YANDEX_LIVE_OBJECTS_URL)
  url.searchParams.set("callback", callback)
  url.searchParams.set("number", "")
  url.searchParams.set("type", "all")
  url.searchParams.set("station", "")
  url.searchParams.set("city", "")
  url.searchParams.set("center", center)
  url.searchParams.set("span", span)
  url.searchParams.set("zoom", String(Math.round(zoom)))
  url.searchParams.set("_", String(Date.now()))

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: {
        accept: "application/javascript,text/javascript,*/*;q=0.1",
      },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Live objects request failed (${response.status}): ${text.slice(0, 200)}`)
    }

    const text = await response.text()
    const payload = parseJsonpPayload(text, callback)
    const trains = normalizeLongDistanceLiveObjects(payload)
    liveObjectsCache.set(cacheKey, {
      fetchedAt: Date.now(),
      trains,
      timestamp: payload.timestamp ?? null,
      expires: payload.expires ?? null,
    })

    return NextResponse.json({
      trains,
      timestamp: payload.timestamp ?? null,
      expires: payload.expires ?? null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load live train objects"
    const debug =
      error instanceof LiveObjectsParseError
        ? {
            responsePreview: error.preview,
          }
        : undefined
    return NextResponse.json(
      { error: "Failed to load live train objects", details: message, debug },
      { status: 500 },
    )
  }
}
