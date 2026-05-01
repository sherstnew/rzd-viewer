import { readFile } from "node:fs/promises"
import path from "node:path"

import { NextRequest, NextResponse } from "next/server"

const STATION_PHOTOS_MANIFEST_PATH = path.join(
  process.cwd(),
  "public",
  "assets",
  "station-photos",
  "manifest.json",
)
const STATION_PHOTOS_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store",
}

type StationPhotoItem = {
  imageUrl: string
  photoPageUrl: string
  caption: string
}

type StationPhotosManifest = {
  generatedAt?: string
  limit?: number
  stations?: Record<string, StationPhotoItem[]>
}

type StationPhotosDebugInfo = {
  source: "local-manifest"
  manifestFound: boolean
  cacheKey: string | null
  generatedAt: string | null
  limit: number | null
}

type StationPhotosResponse = {
  photos: StationPhotoItem[]
  debug: StationPhotosDebugInfo
}

function getStationPhotosCacheKey(esrCode: string, stationTitle: string): string | null {
  if (esrCode) {
    return `esr:${esrCode.toLowerCase()}`
  }

  if (stationTitle) {
    return `title:${stationTitle.toLowerCase()}`
  }

  return null
}

function stationPhotosJson(response: StationPhotosResponse) {
  return NextResponse.json(response, { headers: STATION_PHOTOS_RESPONSE_HEADERS })
}

async function readStationPhotosManifest(): Promise<StationPhotosManifest | null> {
  try {
    const text = await readFile(STATION_PHOTOS_MANIFEST_PATH, "utf8")
    return JSON.parse(text) as StationPhotosManifest
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { esrCode?: unknown; stationTitle?: unknown }
    | null
  const esrCode = typeof body?.esrCode === "string" ? body.esrCode.trim() : ""
  const stationTitle = typeof body?.stationTitle === "string" ? body.stationTitle.trim() : ""
  const cacheKey = getStationPhotosCacheKey(esrCode, stationTitle)
  const manifest = await readStationPhotosManifest()

  return stationPhotosJson({
    photos: cacheKey ? (manifest?.stations?.[cacheKey] ?? []) : [],
    debug: {
      source: "local-manifest",
      manifestFound: Boolean(manifest),
      cacheKey,
      generatedAt: manifest?.generatedAt ?? null,
      limit: typeof manifest?.limit === "number" ? manifest.limit : null,
    },
  })
}
