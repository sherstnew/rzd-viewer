import { NextResponse } from "next/server"
import { readFile } from "node:fs/promises"
import path from "node:path"
import {
  createRussiaGeoFilter,
  normalizeLongDistanceRoutePayload,
  normalizeLongDistanceRouteRequestNumber,
  type RussiaGeoFilter,
  type RussiaRegionsGeoJson,
} from "@/lib/long-distance-trains"

const RZD_ROUTE_BASE_URL = "https://www.rzd.ru/routemap/source/current/train"
const ROUTE_CACHE_TTL_MS = 60_000
const TRAIN_NUMBER_REGEX = /^[0-9A-Za-zА-Яа-я]+$/
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

type CachedRoute = {
  fetchedAt: number
  payload: unknown
}

const routeCache = new Map<string, CachedRoute>()
let cachedRussiaGeoFilter: RussiaGeoFilter | null = null

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error"
}

async function getRussiaGeoFilter(): Promise<RussiaGeoFilter> {
  if (cachedRussiaGeoFilter) {
    return cachedRussiaGeoFilter
  }

  const filePath = path.join(process.cwd(), "public", "assets", "Russia_regions.geojson")
  const file = await readFile(filePath, "utf8")
  const geoJson = JSON.parse(file) as RussiaRegionsGeoJson
  cachedRussiaGeoFilter = createRussiaGeoFilter(geoJson)
  return cachedRussiaGeoFilter
}

function routeNumberCandidates(number: string): string[] {
  const candidates = [number]
  if (!number.endsWith("J")) {
    candidates.push(`${number}J`)
  }

  return Array.from(new Set(candidates))
}

async function fetchRzdRoute(number: string, date: string) {
  const url = new URL(`${RZD_ROUTE_BASE_URL}/${encodeURIComponent(number)}/departure/${date}`)
  url.searchParams.set("useTimeZone", "true")

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "application/json,text/plain,*/*",
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`RZD route request for ${number} failed (${response.status}): ${text.slice(0, 300)}`)
  }

  return response.json()
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const rawNumber = requestUrl.searchParams.get("number")?.trim() ?? ""
  const number = normalizeLongDistanceRouteRequestNumber(rawNumber)
  const date = requestUrl.searchParams.get("date")?.trim() ?? ""

  if (!number || !date) {
    return NextResponse.json(
      { error: "number and date query parameters are required" },
      { status: 400 },
    )
  }

  if (!TRAIN_NUMBER_REGEX.test(number) || !DATE_REGEX.test(date)) {
    return NextResponse.json(
      { error: "Invalid number or date query parameter" },
      { status: 400 },
    )
  }

  const cacheKey = `${number}|${date}`
  const cached = routeCache.get(cacheKey)
  if (cached && Date.now() - cached.fetchedAt <= ROUTE_CACHE_TTL_MS) {
    return NextResponse.json(cached.payload)
  }

  try {
    const errors: string[] = []
    const isPointInRussia = await getRussiaGeoFilter()

    for (const candidate of routeNumberCandidates(number)) {
      try {
        const rawPayload = await fetchRzdRoute(candidate, date)
        const payload = normalizeLongDistanceRoutePayload(rawPayload, candidate, date, isPointInRussia)
        routeCache.set(cacheKey, {
          fetchedAt: Date.now(),
          payload,
        })

        return NextResponse.json(payload)
      } catch (candidateError) {
        errors.push(toErrorMessage(candidateError))
      }
    }

    throw new Error(errors.join(" | "))
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to load long-distance train route",
        details: toErrorMessage(error),
      },
      { status: 500 },
    )
  }
}
