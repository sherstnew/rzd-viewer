"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { GeoJsonObject } from "geojson"
import L from "leaflet"
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet"
import { useTheme } from "next-themes"
import { createRouteEngine } from "@/lib/route-engine"
import { resolveTrainProgressByStops } from "@/lib/train-progress"
import { findTrains, Train, TrainWithCoordinates } from "@/lib/trains"
import { getTrainDelayLabels } from "@/lib/train-delays"
import type { LongDistanceRoute, LongDistanceTrainObject } from "@/lib/long-distance-trains"
import {
  isLongDistancePointInRussia,
  longDistanceTrainKey,
  normalizeLongDistanceRouteRequestNumber,
  normalizeLongDistanceLiveObjects,
  type YandexLiveObjectsPayload,
} from "@/lib/long-distance-trains"
import stationsData from "@/public/assets/stations.json"
import moscowBigGeoJson from "@/public/assets/moscow-big.json"
import { getNow } from "@/lib/runtime-mode"
import {
  bucketHeading,
  CLOCK_TICK_MS,
  FORCED_STATION_CODES_BY_ROUTE,
  FORWARD_TERMINAL_BY_ROUTE,
  LONG_DISTANCE_TRAINS_CACHE_TTL_MS,
  LONG_DISTANCE_TRAINS_DEBOUNCE_MS,
  LONG_DISTANCE_VIEWPORT_PRECISION,
  MOSCOW_CENTER,
  OPENRAILWAYMAP_ATTRIBUTION,
  ROUTE_COLOR_BY_ID,
  ROUTE_DEFINITIONS,
  ROUTE_STATION_DISTANCE_THRESHOLD,
  STATION_LABEL_ZOOM_THRESHOLD,
  stationMarkerRadiusByZoom,
  trainIconSizeByZoom,
  VIDEO_SECTION_END_TITLE,
  VIDEO_SECTION_START_TITLE,
  YANDEX_LIVE_OBJECTS_URL,
} from "@/lib/map-constants"
import {
  createLongDistanceTrainIcon,
  createTrainIconWithSelection,
  trainIconSrc,
} from "@/lib/map-icons"
import {
  buildStationIndexes,
  buildStationSchedule,
  coordinateIndexValueFromProjection,
  findNearestProjection,
  nearestCoordinateIndex,
  type LonLat,
  type RouteDataById,
  type RouteGeoJson,
  type RouteId,
  type RouteStation,
  type StationCandidate,
  type StationScheduleItem,
} from "@/lib/map-utils"
import { TrainSidebar } from "./train-sidebar"
import { LongDistanceTrainSidebar } from "./long-distance-train-sidebar"
import { StationSidebar, type StationPhotoItem } from "./station-sidebar"
import { useCurrentTrainStore } from "@/stores/currentTrainStore"
import { useTrainsStore } from "@/stores/trainsStore"
import { Switch } from "@/components/ui/switch"

type SnappedPoint = {
  point: LonLat
  headingDeg: number
  segmentStart: LonLat
  segmentEnd: LonLat
}


type RouteStationsById = Record<RouteId, RouteStation[]>
type RouteProgressOverlay = {
  routeId: RouteId
  passedRoute: RouteGeoJson | null
  upcomingRoute: RouteGeoJson | null
}
type LongDistanceProgressOverlay = {
  passedRoute: RouteGeoJson | null
  upcomingRoute: RouteGeoJson | null
}
type LongDistanceViewport = {
  center: string
  span: string
  zoom: number
}
type SuburbanViewportBounds = {
  west: number
  east: number
  south: number
  north: number
}

const longDistanceTrainsCache = new Map<
  string,
  {
    fetchedAt: number
    trains: LongDistanceTrainObject[]
  }
>()
const trainIconCache = new Map<string, L.DivIcon>()
const longDistanceIconCache = new Map<string, L.DivIcon>()

const { stationCoordinatesByCode, stationCoordinatesByTitle, stationCandidates } =
  buildStationIndexes(stationsData)

function buildVideoSectionRoute(routeData: RouteGeoJson | null): RouteGeoJson | null {
  if (!routeData || routeData.features.length === 0) {
    return null
  }

  const startCoordinates = stationCoordinatesByTitle.get(VIDEO_SECTION_START_TITLE)
  const endCoordinates = stationCoordinatesByTitle.get(VIDEO_SECTION_END_TITLE)
  if (!startCoordinates || !endCoordinates) {
    return null
  }

  const routeCoordinates = routeData.features[0]?.geometry.coordinates as LonLat[] | undefined
  if (!routeCoordinates || routeCoordinates.length < 2) {
    return null
  }

  const startIndex = nearestCoordinateIndex(
    [startCoordinates.longitude, startCoordinates.latitude],
    routeCoordinates,
  )
  const endIndex = nearestCoordinateIndex(
    [endCoordinates.longitude, endCoordinates.latitude],
    routeCoordinates,
  )
  const from = Math.min(startIndex, endIndex)
  const to = Math.max(startIndex, endIndex)
  const sectionCoordinates = routeCoordinates.slice(from, to + 1)

  if (sectionCoordinates.length < 2) {
    return null
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "video-section" },
        geometry: {
          type: "LineString",
          coordinates: sectionCoordinates,
        },
      },
    ],
  }
}

type StationPhotosDebug = {
  searchQueries?: string[]
  attempts?: Array<{
    url?: string
    attempt?: number
    status?: number | null
    error?: string | null
  }>
  selectedQuery?: string | null
  selectedUrl?: string | null
  htmlLength?: number
  hasPhotosSection?: boolean
  figureCountInSection?: number
  htmlSnippet?: string
}

function trainInstanceKey(train: Pick<Train, "thread" | "departure" | "arrival">): string {
  return `${train.thread.uid}__${train.departure}__${train.arrival}`
}

function snapToRoute(point: LonLat, routeData: RouteGeoJson | null): SnappedPoint {
  const nearest = findNearestProjection(point, routeData)
  if (!nearest) {
    return { point, headingDeg: 0, segmentStart: point, segmentEnd: point }
  }

  return {
    point: nearest.point,
    headingDeg: nearest.headingDeg,
    segmentStart: nearest.segmentStart,
    segmentEnd: nearest.segmentEnd,
  }
}

function resolveTrainHeading(train: TrainWithCoordinates, snapped: SnappedPoint): number {
  const routeDx = snapped.segmentEnd[0] - snapped.segmentStart[0]
  const routeDy = snapped.segmentEnd[1] - snapped.segmentStart[1]
  const startCoordinates = stationCoordinatesByCode.get(train.departure_station.station.code)
  const endCoordinates = stationCoordinatesByCode.get(train.arrival_station.station.code)
  const routeId = train.mcd_route_id ?? "mcd2"
  const forwardTerminalCode = FORWARD_TERMINAL_BY_ROUTE[routeId]

  const isDwellingAtStation = train.departure_station.station.code === train.arrival_station.station.code
  const trainDx = isDwellingAtStation
    ? train.to.code === forwardTerminalCode
      ? routeDx
      : -routeDx
    : (endCoordinates?.longitude ?? 0) - (startCoordinates?.longitude ?? 0)
  const trainDy = isDwellingAtStation
    ? train.to.code === forwardTerminalCode
      ? routeDy
      : -routeDy
    : (endCoordinates?.latitude ?? 0) - (startCoordinates?.latitude ?? 0)

  const dot = routeDx * trainDx + routeDy * trainDy
  if (dot < 0) {
    return (snapped.headingDeg + 180) % 360
  }

  return snapped.headingDeg
}

function interpolateCoordinate(a: LonLat, b: LonLat, ratio: number): LonLat {
  return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio]
}

function coordinatesEqual(a: LonLat, b: LonLat): boolean {
  const epsilon = 1e-9
  return Math.abs(a[0] - b[0]) < epsilon && Math.abs(a[1] - b[1]) < epsilon
}

function pointAtRouteIndex(routeCoordinates: LonLat[], indexValue: number): LonLat {
  const maxIndex = routeCoordinates.length - 1
  const clampedIndex = Math.min(maxIndex, Math.max(0, indexValue))
  const lower = Math.floor(clampedIndex)
  const upper = Math.ceil(clampedIndex)

  if (lower === upper) {
    return routeCoordinates[lower]
  }

  const ratio = clampedIndex - lower
  return interpolateCoordinate(routeCoordinates[lower], routeCoordinates[upper], ratio)
}

function buildRouteSlice(
  routeCoordinates: LonLat[],
  startIndexValue: number,
  endIndexValue: number,
): LonLat[] {
  if (routeCoordinates.length < 2 || endIndexValue < startIndexValue) {
    return []
  }

  const maxIndex = routeCoordinates.length - 1
  const safeStart = Math.min(maxIndex, Math.max(0, startIndexValue))
  const safeEnd = Math.min(maxIndex, Math.max(0, endIndexValue))
  if (safeEnd < safeStart) {
    return []
  }

  const coordinates: LonLat[] = [pointAtRouteIndex(routeCoordinates, safeStart)]
  const integerStart = Math.floor(safeStart) + 1
  const integerEnd = Math.floor(safeEnd)

  for (let i = integerStart; i <= integerEnd; i += 1) {
    if (i >= 0 && i <= maxIndex) {
      const nextPoint = routeCoordinates[i]
      if (!coordinatesEqual(coordinates[coordinates.length - 1], nextPoint)) {
        coordinates.push(nextPoint)
      }
    }
  }

  const endPoint = pointAtRouteIndex(routeCoordinates, safeEnd)
  if (!coordinatesEqual(coordinates[coordinates.length - 1], endPoint)) {
    coordinates.push(endPoint)
  }

  return coordinates
}

function buildOverlayRoute(name: string, coordinates: LonLat[]): RouteGeoJson | null {
  if (coordinates.length < 2) {
    return null
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name },
        geometry: {
          type: "LineString",
          coordinates,
        },
      },
    ],
  }
}

function buildTrainRouteProgressOverlay(
  train: Train | null,
  routeDataById: RouteDataById,
  nowTimestamp: number,
): RouteProgressOverlay | null {
  if (!train) {
    return null
  }

  const routeId = train.mcd_route_id ?? "mcd2"
  const routeData = routeDataById[routeId] ?? null
  const routeCoordinates = routeData?.features[0]?.geometry.coordinates as LonLat[] | undefined
  if (!routeData || !routeCoordinates || routeCoordinates.length < 2) {
    return null
  }

  const routeStops = train.thread_route?.stops ?? []
  if (routeStops.length < 2) {
    return null
  }

  const progress = resolveTrainProgressByStops(nowTimestamp, routeStops)
  if (progress.mode === "unknown") {
    return null
  }

  const stopRouteIndexes = routeStops.map((stop) => {
    const stationCoordinates = stationCoordinatesByCode.get(stop.station.code)
    if (!stationCoordinates) {
      return null
    }

    const nearest = findNearestProjection(
      [stationCoordinates.longitude, stationCoordinates.latitude],
      routeData,
    )
    if (!nearest) {
      return null
    }

    return nearestCoordinateIndex(nearest.point, routeCoordinates)
  })

  const startRouteIndex = stopRouteIndexes[progress.startIndex]
  const endRouteIndex = stopRouteIndexes[progress.endIndex]
  if (startRouteIndex === null || startRouteIndex === undefined) {
    return null
  }

  const fallbackEndIndex = Math.min(routeCoordinates.length - 1, startRouteIndex + 1)
  const safeEndRouteIndex = endRouteIndex ?? fallbackEndIndex
  const fallbackSplitIndex =
    startRouteIndex + (safeEndRouteIndex - startRouteIndex) * progress.ratioWithinLeg
  const projectedSplitIndex = (() => {
    const positionedTrain = train as Partial<TrainWithCoordinates>
    if (
      typeof positionedTrain.longitude !== "number" ||
      !Number.isFinite(positionedTrain.longitude) ||
      typeof positionedTrain.latitude !== "number" ||
      !Number.isFinite(positionedTrain.latitude)
    ) {
      return null
    }

    const nearestProjection = findNearestProjection(
      [positionedTrain.longitude, positionedTrain.latitude],
      routeData,
    )
    if (!nearestProjection) {
      return null
    }

    const rawIndexValue = coordinateIndexValueFromProjection(nearestProjection)
    const minLegIndex = Math.min(startRouteIndex, safeEndRouteIndex)
    const maxLegIndex = Math.max(startRouteIndex, safeEndRouteIndex)

    return Math.min(maxLegIndex, Math.max(minLegIndex, rawIndexValue))
  })()
  const splitIndex = projectedSplitIndex ?? fallbackSplitIndex

  const maxRouteIndex = routeCoordinates.length - 1
  const isForwardDirection = safeEndRouteIndex >= startRouteIndex
  const passedSlice = isForwardDirection
    ? buildRouteSlice(routeCoordinates, 0, splitIndex)
    : buildRouteSlice(routeCoordinates, splitIndex, maxRouteIndex)
  const upcomingSlice = isForwardDirection
    ? buildRouteSlice(routeCoordinates, splitIndex, maxRouteIndex)
    : buildRouteSlice(routeCoordinates, 0, splitIndex)

  return {
    routeId,
    passedRoute: buildOverlayRoute("passed-progress", passedSlice),
    upcomingRoute: buildOverlayRoute("upcoming-progress", upcomingSlice),
  }
}

function buildLongDistanceRouteProgressOverlay(route: LongDistanceRoute | null): LongDistanceProgressOverlay | null {
  if (!route || route.stations.length < 2) {
    return null
  }

  const routeCoordinates = route.stations.map((station) => station.coordinates)
  const lastTraversedIndex = route.stations.reduce(
    (lastIndex, station, index) => (station.traversed ? index : lastIndex),
    -1,
  )

  if (lastTraversedIndex < 0) {
    return {
      passedRoute: null,
      upcomingRoute: buildOverlayRoute("long-distance-upcoming", routeCoordinates),
    }
  }

  if (lastTraversedIndex >= routeCoordinates.length - 1) {
    return {
      passedRoute: buildOverlayRoute("long-distance-passed", routeCoordinates),
      upcomingRoute: null,
    }
  }

  return {
    passedRoute: buildOverlayRoute(
      "long-distance-passed",
      routeCoordinates.slice(0, lastTraversedIndex + 1),
    ),
    upcomingRoute: buildOverlayRoute(
      "long-distance-upcoming",
      routeCoordinates.slice(lastTraversedIndex),
    ),
  }
}

function buildAutoStationsForRoute(routeId: RouteId, routeData: RouteGeoJson | null): RouteStation[] {
  if (!routeData) {
    return []
  }

  const stationByCode = new Map<
    string,
    { station: StationCandidate; distanceSq: number; segmentIndex: number }
  >()

  const strictDistanceSq = ROUTE_STATION_DISTANCE_THRESHOLD * ROUTE_STATION_DISTANCE_THRESHOLD
  const relaxedDistanceSq = strictDistanceSq * 36

  for (const station of stationCandidates) {
    const nearest = findNearestProjection([station.longitude, station.latitude], routeData)
    if (!nearest) {
      continue
    }

    const existing = stationByCode.get(station.code)
    if (existing && nearest.distanceSq >= existing.distanceSq) {
      continue
    }

    stationByCode.set(station.code, {
      station,
      distanceSq: nearest.distanceSq,
      segmentIndex: nearest.segmentIndex,
    })
  }

  const allMatchedStations = Array.from(stationByCode.values()).sort(
    (left, right) => left.segmentIndex - right.segmentIndex,
  )
  const forcedStationCodes = new Set(FORCED_STATION_CODES_BY_ROUTE[routeId] ?? [])
  const strictStations = allMatchedStations.filter((item) => item.distanceSq <= strictDistanceSq)
  const stationsToRender =
    strictStations.length >= 2
      ? allMatchedStations.filter(
          (item) => item.distanceSq <= strictDistanceSq || forcedStationCodes.has(item.station.code),
        )
      : allMatchedStations.filter((item) => item.distanceSq <= relaxedDistanceSq)

  return stationsToRender
    .map(({ station }) => ({
      routeId,
      code: station.code,
      title: station.title,
      longitude: station.longitude,
      latitude: station.latitude,
      direction: station.direction,
      esrCode: station.esrCode,
    }))
}

function RouteBounds({ routes }: { routes: RouteGeoJson[] }) {
  const map = useMap()

  useEffect(() => {
    if (routes.length === 0) {
      return
    }

    let mergedBounds: L.LatLngBounds | null = null
    for (const route of routes) {
      const routeBounds = L.geoJSON(route).getBounds()
      if (!routeBounds.isValid()) {
        continue
      }

      if (!mergedBounds) {
        mergedBounds = routeBounds
      } else {
        mergedBounds.extend(routeBounds)
      }
    }

    if (mergedBounds?.isValid()) {
      map.fitBounds(mergedBounds, { padding: [24, 24] })
    }
  }, [map, routes])

  return null
}

function MapZoomWatcher({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMapEvents({
    zoom(event) {
      onZoomChange(event.target.getZoom())
    },
    zoomend(event) {
      onZoomChange(event.target.getZoom())
    },
  })

  useEffect(() => {
    onZoomChange(map.getZoom())
  }, [map, onZoomChange])

  return null
}

function SuburbanViewportWatcher({
  enabled,
  onBoundsChange,
}: {
  enabled: boolean
  onBoundsChange: (bounds: SuburbanViewportBounds | null) => void
}) {
  const updateBounds = useCallback(
    (map: L.Map) => {
      if (!enabled) {
        onBoundsChange(null)
        return
      }

      const bounds = map.getBounds()
      onBoundsChange({
        west: bounds.getWest(),
        east: bounds.getEast(),
        south: bounds.getSouth(),
        north: bounds.getNorth(),
      })
    },
    [enabled, onBoundsChange],
  )

  const map = useMapEvents({
    moveend(event) {
      updateBounds(event.target)
    },
    zoomend(event) {
      updateBounds(event.target)
    },
  })
  useEffect(() => {
    updateBounds(map)
  }, [map, updateBounds])

  return null
}

function getLongDistanceViewport(map: L.Map): LongDistanceViewport {
  const center = map.getCenter()
  const bounds = map.getBounds()
  const longitudeSpan = Math.abs(bounds.getEast() - bounds.getWest())
  const latitudeSpan = Math.abs(bounds.getNorth() - bounds.getSouth())

  return {
    center: `${center.lng.toFixed(LONG_DISTANCE_VIEWPORT_PRECISION)},${center.lat.toFixed(LONG_DISTANCE_VIEWPORT_PRECISION)}`,
    span: `${longitudeSpan.toFixed(LONG_DISTANCE_VIEWPORT_PRECISION)},${latitudeSpan.toFixed(LONG_DISTANCE_VIEWPORT_PRECISION)}`,
    zoom: Math.round(map.getZoom()),
  }
}

function longDistanceViewportKey(viewport: LongDistanceViewport): string {
  return `${viewport.center}|${viewport.span}|${viewport.zoom}`
}

function readLongDistanceTrainsCache(key: string): LongDistanceTrainObject[] | null {
  const cached = longDistanceTrainsCache.get(key)
  if (!cached) {
    return null
  }

  if (Date.now() - cached.fetchedAt > LONG_DISTANCE_TRAINS_CACHE_TTL_MS) {
    longDistanceTrainsCache.delete(key)
    return null
  }

  return cached.trains
}

function writeLongDistanceTrainsCache(key: string, trains: LongDistanceTrainObject[]) {
  longDistanceTrainsCache.set(key, {
    fetchedAt: Date.now(),
    trains,
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : typeof error === "object" &&
        error !== null &&
        "name" in error &&
        (error as { name?: unknown }).name === "AbortError"
}

async function fetchLongDistanceObjects(
  viewport: LongDistanceViewport,
  signal: AbortSignal,
): Promise<LongDistanceTrainObject[]> {
  const params = new URLSearchParams({
    center: viewport.center,
    span: viewport.span,
    zoom: String(Math.round(viewport.zoom)),
  })
  const response = await fetch(`/api/trains/live-objects?${params.toString()}`, {
    cache: "no-store",
    signal,
  })

  if (!response.ok) {
    const errorPayload = (await response.json().catch(() => null)) as
      | { error?: string; details?: string }
      | null
    throw new Error(
      errorPayload?.details ??
        errorPayload?.error ??
        `Live objects request failed with status ${response.status}`,
    )
  }

  const payload = (await response.json()) as { trains?: LongDistanceTrainObject[] }
  return Array.isArray(payload.trains) ? payload.trains : []
}

function fetchLongDistanceObjectsWithJsonpFallback(
  viewport: LongDistanceViewport,
  signal: AbortSignal,
): Promise<LongDistanceTrainObject[]> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"))
      return
    }

    const callbackName = `__rzdLiveObjects_${Date.now()}_${Math.random().toString(36).slice(2)}`
    const windowWithCallback = window as typeof window & Record<string, (payload: YandexLiveObjectsPayload) => void>
    const script = document.createElement("script")
    const url = new URL(YANDEX_LIVE_OBJECTS_URL)
    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error("Yandex live objects JSONP request timed out"))
    }, 10_000)

    function cleanup() {
      window.clearTimeout(timeoutId)
      signal.removeEventListener("abort", handleAbort)
      delete windowWithCallback[callbackName]
      script.remove()
    }

    function handleAbort() {
      cleanup()
      reject(new DOMException("Aborted", "AbortError"))
    }

    windowWithCallback[callbackName] = (payload) => {
      cleanup()
      resolve(normalizeLongDistanceLiveObjects(payload))
    }

    url.searchParams.set("callback", callbackName)
    url.searchParams.set("number", "")
    url.searchParams.set("type", "all")
    url.searchParams.set("station", "")
    url.searchParams.set("city", "")
    url.searchParams.set("center", viewport.center)
    url.searchParams.set("span", viewport.span)
    url.searchParams.set("zoom", String(Math.round(viewport.zoom)))
    url.searchParams.set("_", String(Date.now()))

    script.async = true
    script.src = url.toString()
    script.onerror = () => {
      cleanup()
      reject(new Error("Yandex live objects JSONP fallback failed"))
    }
    signal.addEventListener("abort", handleAbort, { once: true })
    document.head.appendChild(script)
  })
}

function LongDistanceTrainLoader({
  enabled,
  onError,
  onTrainsChange,
}: {
  enabled: boolean
  onError: (message: string | null) => void
  onTrainsChange: (trains: LongDistanceTrainObject[]) => void
}) {
  const abortControllerRef = useRef<AbortController | null>(null)
  const debounceTimeoutRef = useRef<number | null>(null)
  const lastRequestedViewportKeyRef = useRef<string | null>(null)

  const loadTrains = useCallback(
    async (map: L.Map) => {
      if (!enabled) {
        return
      }

      const viewport = getLongDistanceViewport(map)
      const viewportKey = longDistanceViewportKey(viewport)
      const cachedTrains = readLongDistanceTrainsCache(viewportKey)
      if (cachedTrains) {
        lastRequestedViewportKeyRef.current = viewportKey
        onTrainsChange(cachedTrains)
        onError(null)
        return
      }

      if (lastRequestedViewportKeyRef.current === viewportKey) {
        return
      }

      lastRequestedViewportKeyRef.current = viewportKey
      abortControllerRef.current?.abort()
      const controller = new AbortController()
      abortControllerRef.current = controller

      try {
        let trains: LongDistanceTrainObject[]
        try {
          trains = await fetchLongDistanceObjects(viewport, controller.signal)
        } catch (serverError) {
          if (isAbortError(serverError)) {
            return
          }
          trains = await fetchLongDistanceObjectsWithJsonpFallback(viewport, controller.signal)
        }
        writeLongDistanceTrainsCache(viewportKey, trains)
        onTrainsChange(trains)
        onError(null)
      } catch (error) {
        if (isAbortError(error)) {
          return
        }

        onTrainsChange([])
        onError(error instanceof Error ? error.message : "Не удалось загрузить поезда дальнего следования")
      }
    },
    [enabled, onError, onTrainsChange],
  )

  const scheduleLoadTrains = useCallback(
    (map: L.Map) => {
      if (!enabled) {
        return
      }

      if (debounceTimeoutRef.current !== null) {
        window.clearTimeout(debounceTimeoutRef.current)
      }

      debounceTimeoutRef.current = window.setTimeout(() => {
        debounceTimeoutRef.current = null
        void loadTrains(map)
      }, LONG_DISTANCE_TRAINS_DEBOUNCE_MS)
    },
    [enabled, loadTrains],
  )

  const map = useMapEvents({
    moveend(event) {
      scheduleLoadTrains(event.target)
    },
    zoomend(event) {
      scheduleLoadTrains(event.target)
    },
  })

  useEffect(() => {
    if (!enabled) {
      abortControllerRef.current?.abort()
      lastRequestedViewportKeyRef.current = null
      if (debounceTimeoutRef.current !== null) {
        window.clearTimeout(debounceTimeoutRef.current)
        debounceTimeoutRef.current = null
      }
      onTrainsChange([])
      onError(null)
      return
    }

    scheduleLoadTrains(map)

    return () => {
      abortControllerRef.current?.abort()
      if (debounceTimeoutRef.current !== null) {
        window.clearTimeout(debounceTimeoutRef.current)
        debounceTimeoutRef.current = null
      }
    }
  }, [enabled, map, onError, onTrainsChange, scheduleLoadTrains])

  return null
}

function MapControlPositioner() {
  const map = useMap()

  useEffect(() => {
    map.zoomControl.setPosition("bottomright")
    map.attributionControl.setPrefix(false)
  }, [map])

  return null
}

function PopupCloserOnSidebarClose({ isSidebarOpen }: { isSidebarOpen: boolean }) {
  const map = useMap()

  useEffect(() => {
    if (!isSidebarOpen) {
      map.closePopup()
    }
  }, [isSidebarOpen, map])

  return null
}

function StationSidebarMapClickCloser({
  onCloseStationSidebar,
  shouldIgnoreMapClick,
}: {
  onCloseStationSidebar: () => void
  shouldIgnoreMapClick: () => boolean
}) {
  useMapEvents({
    click() {
      if (shouldIgnoreMapClick()) {
        return
      }
      onCloseStationSidebar()
    },
  })

  return null
}

function ZoomToSelectedStation({
  station,
  stationTitle,
  routeDataById,
}: {
  station: RouteStation | null
  stationTitle: string | null
  routeDataById: RouteDataById
}) {
  const map = useMap()

  useEffect(() => {
    if (!station && !stationTitle) {
      return
    }

    const stationPoint = station
      ? {
          point: [station.longitude, station.latitude] as LonLat,
          routeId: station.routeId,
        }
      : stationTitle
        ? {
            point: (() => {
              const coordinates = stationCoordinatesByTitle.get(stationTitle)
              return coordinates ? ([coordinates.longitude, coordinates.latitude] as LonLat) : null
            })(),
            routeId: null,
          }
        : null

    if (!stationPoint?.point) {
      return
    }

    const snapped = snapToRoute(stationPoint.point, stationPoint.routeId ? routeDataById[stationPoint.routeId] ?? null : null)
    const [longitude, latitude] = snapped.point
    const targetZoom = Math.max(map.getZoom(), 13)

    map.flyTo([latitude, longitude], targetZoom, {
      animate: true,
      duration: 0.45,
    })
  }, [map, routeDataById, station, stationTitle])

  return null
}

function ZoomToSelectedTrain({
  train,
  trainKey,
  routeDataById,
}: {
  train: TrainWithCoordinates | null
  trainKey: string | null
  routeDataById: RouteDataById
}) {
  const map = useMap()
  const lastZoomedTrainKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!train || !trainKey || lastZoomedTrainKeyRef.current === trainKey) {
      return
    }

    lastZoomedTrainKeyRef.current = trainKey
    const routeId = train.mcd_route_id ?? "mcd2"
    const snapped = snapToRoute([train.longitude, train.latitude], routeDataById[routeId] ?? null)
    const [longitude, latitude] = snapped.point
    const targetZoom = Math.max(map.getZoom(), 14)

    map.flyTo([latitude, longitude], targetZoom, {
      animate: true,
      duration: 0.45,
    })
  }, [map, routeDataById, train, trainKey])

  return null
}

function ZoomToLongDistanceRoute({
  route,
  routeKey,
}: {
  route: LongDistanceRoute | null
  routeKey: string | null
}) {
  const map = useMap()
  const lastZoomedRouteKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!route || !routeKey || lastZoomedRouteKeyRef.current === routeKey) {
      return
    }

    const bounds = L.geoJSON(route.routeGeoJson).getBounds()
    if (!bounds.isValid()) {
      return
    }

    lastZoomedRouteKeyRef.current = routeKey
    map.fitBounds(bounds, {
      animate: true,
      duration: 0.45,
      padding: [36, 36],
    })
  }, [map, route, routeKey])

  return null
}

export function MapExample() {
  const [currentZoom, setCurrentZoom] = useState(10)
  const [clockTimestamp, setClockTimestamp] = useState(() => getNow("real").getTime())
  const [suburbanViewportBounds, setSuburbanViewportBounds] = useState<SuburbanViewportBounds | null>(null)
  const [currentStation, setCurrentStation] = useState<RouteStation | null>(null)
  const [stationPhotos, setStationPhotos] = useState<StationPhotoItem[]>([])
  const [isPhotosLoading, setIsPhotosLoading] = useState(false)
  const [longDistanceTrains, setLongDistanceTrains] = useState<LongDistanceTrainObject[]>([])
  const [longDistanceTrainsError, setLongDistanceTrainsError] = useState<string | null>(null)
  const [selectedLongDistanceRoute, setSelectedLongDistanceRoute] = useState<LongDistanceRoute | null>(null)
  const [longDistanceRouteError, setLongDistanceRouteError] = useState<string | null>(null)
  const [isLongDistanceRouteLoading, setIsLongDistanceRouteLoading] = useState(false)
  const stationClickLockUntilRef = useRef(0)

  const {
    currentTrain,
    currentStationTitle,
    showLongDistanceTrains,
    selectedLongDistanceTrain,
    setCurrentTrain,
    setCurrentStationTitle,
    setRouteStationTitles,
    setShowLongDistanceTrains,
    setVisibleLongDistanceTrains,
    setSelectedLongDistanceTrain,
  } =
    useCurrentTrainStore()
  const {
    segments,
    threadsByUid,
    clockMode,
    fetchForToday,
    fetchDelays,
    fetchThreadsForUids,
    error: trainsError,
    threadsError,
  } = useTrainsStore()

  const showPermanentStationLabels = currentZoom >= STATION_LABEL_ZOOM_THRESHOLD
  const trainIconSize = trainIconSizeByZoom(currentZoom)
  const stationMarkerRadius = stationMarkerRadiusByZoom(currentZoom)
  const closeStationSidebar = useCallback(() => {
    setCurrentStation(null)
    setStationPhotos([])
    setIsPhotosLoading(false)
  }, [])
  const closeLongDistanceSidebar = useCallback(() => {
    setSelectedLongDistanceTrain(null)
    setSelectedLongDistanceRoute(null)
    setLongDistanceRouteError(null)
    setIsLongDistanceRouteLoading(false)
  }, [setSelectedLongDistanceTrain])

  const shouldIgnoreMapClick = useCallback(() => {
    return Date.now() < stationClickLockUntilRef.current
  }, [])

  const handleShowLongDistanceTrainsChange = useCallback((nextValue: boolean) => {
    setShowLongDistanceTrains(nextValue)

    if (nextValue) {
      setCurrentTrain(null)
      setCurrentStationTitle(null)
      closeStationSidebar()
      return
    }

    closeLongDistanceSidebar()
    setLongDistanceTrainsError(null)
  }, [
    closeLongDistanceSidebar,
    closeStationSidebar,
    setShowLongDistanceTrains,
    setCurrentStationTitle,
    setCurrentTrain,
  ])
  const { routeDataById, routeError } = useMemo(() => {
    try {
      const routeEngine = createRouteEngine(moscowBigGeoJson as GeoJsonObject)
      const nextRoutes: RouteDataById = {}

      for (const routeDefinition of ROUTE_DEFINITIONS) {
        if (!routeDefinition.start || !routeDefinition.end) {
          throw new Error(`Не заданы координаты маршрута ${routeDefinition.label}`)
        }

        nextRoutes[routeDefinition.id] = routeEngine.findRoute(routeDefinition.start, routeDefinition.end)
      }

      return { routeDataById: nextRoutes, routeError: null as string | null }
    } catch (calculationError) {
      const message =
        calculationError instanceof Error ? calculationError.message : "Не удалось построить маршрут"
      return { routeDataById: {}, routeError: message }
    }
  }, [])

  const hydratedSegments = useMemo<Train[]>(() => {
    return segments.map((segment) => {
      const uid = segment.thread?.uid
      if (!uid) {
        return segment
      }

      const threadPayload = threadsByUid[uid]
      if (!threadPayload) {
        return segment
      }

      return {
        ...segment,
        thread_route: threadPayload.thread_route,
        thread_error: threadPayload.thread_error,
      }
    })
  }, [segments, threadsByUid])

  const trains = useMemo<TrainWithCoordinates[]>(
    () => findTrains(new Date(clockTimestamp), hydratedSegments),
    [clockTimestamp, hydratedSegments],
  )

  const visibleTrainUids = useMemo(() => {
    if (!suburbanViewportBounds || showLongDistanceTrains) {
      return []
    }

    const uids = new Set<string>()

    for (const train of trains) {
      const uid = train.thread?.uid
      if (!uid) {
        continue
      }

      const isVisible =
        train.longitude >= suburbanViewportBounds.west &&
        train.longitude <= suburbanViewportBounds.east &&
        train.latitude >= suburbanViewportBounds.south &&
        train.latitude <= suburbanViewportBounds.north

      if (isVisible) {
        uids.add(uid)
      }
    }

    return Array.from(uids)
  }, [showLongDistanceTrains, suburbanViewportBounds, trains])

  const { resolvedTheme } = useTheme()
  const tileTheme = resolvedTheme === "dark" ? "dark" : "light"
  const mcd2RouteData = routeDataById.mcd2 ?? null
  const videoSectionRouteData = useMemo(() => buildVideoSectionRoute(mcd2RouteData), [mcd2RouteData])

  const builtRoutes = useMemo(
    () =>
      ROUTE_DEFINITIONS.flatMap((routeDefinition) => {
        const route = routeDataById[routeDefinition.id]
        return route ? [route] : []
      }),
    [routeDataById],
  )

  const currentTrainKey = currentTrain ? trainInstanceKey(currentTrain) : null
  const selectedTrainForZoom = useMemo(
    () => (currentTrainKey ? trains.find((train) => trainInstanceKey(train) === currentTrainKey) ?? null : null),
    [currentTrainKey, trains],
  )

  const selectedTrainRouteOverlay = useMemo(
    () => buildTrainRouteProgressOverlay(selectedTrainForZoom ?? currentTrain, routeDataById, clockTimestamp),
    [clockTimestamp, currentTrain, routeDataById, selectedTrainForZoom],
  )
  const selectedLongDistanceTrainKey = selectedLongDistanceTrain
    ? longDistanceTrainKey(selectedLongDistanceTrain)
    : null
  const selectedLongDistanceRouteOverlay = useMemo(
    () => buildLongDistanceRouteProgressOverlay(selectedLongDistanceRoute),
    [selectedLongDistanceRoute],
  )
  const visibleLongDistanceTrains = useMemo(
    () =>
      longDistanceTrains.filter((train) =>
        isLongDistancePointInRussia(train.longitude, train.latitude),
      ),
    [longDistanceTrains],
  )

  useEffect(() => {
    setVisibleLongDistanceTrains(visibleLongDistanceTrains)
  }, [setVisibleLongDistanceTrains, visibleLongDistanceTrains])

  const routeStationsById = useMemo((): RouteStationsById => {
    return {
      mcd1: buildAutoStationsForRoute("mcd1", routeDataById.mcd1 ?? null),
      mcd2: buildAutoStationsForRoute("mcd2", routeDataById.mcd2 ?? null),
      mcd3: buildAutoStationsForRoute("mcd3", routeDataById.mcd3 ?? null),
      mcd4: buildAutoStationsForRoute("mcd4", routeDataById.mcd4 ?? null),
      mcd5_south: buildAutoStationsForRoute("mcd5_south", routeDataById.mcd5_south ?? null),
      mcd5_north: buildAutoStationsForRoute("mcd5_north", routeDataById.mcd5_north ?? null),
      mcd5_korolev: buildAutoStationsForRoute(
        "mcd5_korolev",
        routeDataById.mcd5_korolev ?? null,
      ),
    }
  }, [routeDataById])

  const routeStations = useMemo(
    () =>
      ROUTE_DEFINITIONS.flatMap((routeDefinition) =>
        routeStationsById[routeDefinition.id].map((station) => ({
          ...station,
          color: routeDefinition.color,
          label: routeDefinition.label,
        })),
      ),
    [routeStationsById],
  )
  const renderedRouteStations = useMemo(
    () =>
      routeStations.map((station) => {
        const snapped = snapToRoute(
          [station.longitude, station.latitude],
          routeDataById[station.routeId] ?? null,
        )
        const [lon, lat] = snapped.point
        return {
          station,
          center: [lat, lon] as [number, number],
        }
      }),
    [routeDataById, routeStations],
  )

  useEffect(() => {
    setRouteStationTitles(Array.from(new Set(routeStations.map((station) => station.title))))
  }, [routeStations, setRouteStationTitles])

  useEffect(() => {
    if (!currentStationTitle) {
      return
    }

    const station = routeStations.find((routeStation) => routeStation.title === currentStationTitle)
    const timeoutId = window.setTimeout(() => {
      setCurrentTrain(null)
      setCurrentStation(station ?? null)
      setStationPhotos([])
      setIsPhotosLoading(Boolean(station))
    }, 0)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [currentStationTitle, routeStations, setCurrentTrain])

  const stationSchedule = useMemo<StationScheduleItem[]>(() => {
    if (!currentStation) {
      return []
    }

    return buildStationSchedule(currentStation, clockTimestamp, hydratedSegments)
  }, [clockTimestamp, currentStation, hydratedSegments])
  useEffect(() => {
    void fetchForToday().then(() => {
      void fetchDelays()
    })
    const interval = setInterval(() => {
      void fetchForToday()
    }, 60_000)

    return () => {
      clearInterval(interval)
    }
  }, [fetchDelays, fetchForToday])

  useEffect(() => {
    void fetchDelays()
    const interval = setInterval(() => {
      void fetchDelays()
    }, 5 * 60_000)

    return () => {
      clearInterval(interval)
    }
  }, [fetchDelays])

  useEffect(() => {
    if (visibleTrainUids.length === 0) {
      return
    }

    void fetchThreadsForUids(visibleTrainUids)
  }, [fetchThreadsForUids, visibleTrainUids])

  useEffect(() => {
    if (!selectedLongDistanceTrain) {
      return
    }

    const resetTimeoutId = window.setTimeout(() => {
      setSelectedLongDistanceRoute(null)
    }, 0)

    if (!selectedLongDistanceTrain.date) {
      const errorTimeoutId = window.setTimeout(() => {
        setLongDistanceRouteError("Нет даты отправления для запроса маршрута")
        setIsLongDistanceRouteLoading(false)
      }, 0)
      return () => {
        window.clearTimeout(resetTimeoutId)
        window.clearTimeout(errorTimeoutId)
      }
    }

    const controller = new AbortController()
    const loadingTimeoutId = window.setTimeout(() => {
      setIsLongDistanceRouteLoading(true)
      setLongDistanceRouteError(null)
    }, 0)

    const params = new URLSearchParams({
      number: normalizeLongDistanceRouteRequestNumber(selectedLongDistanceTrain.number),
      date: selectedLongDistanceTrain.date,
    })

    void fetch(`/api/trains/long-distance-route?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const errorPayload = (await response.json().catch(() => null)) as
            | { error?: string; details?: string }
            | null
          throw new Error(
            errorPayload?.details ??
              errorPayload?.error ??
              `Request failed with status ${response.status}`,
          )
        }

        return (await response.json()) as LongDistanceRoute
      })
      .then((route) => {
        setSelectedLongDistanceRoute(route)
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return
        }

        setLongDistanceRouteError(
          error instanceof Error ? error.message : "Не удалось загрузить маршрут дальнего поезда",
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLongDistanceRouteLoading(false)
        }
      })

    return () => {
      window.clearTimeout(resetTimeoutId)
      window.clearTimeout(loadingTimeoutId)
      controller.abort()
    }
  }, [selectedLongDistanceTrain])

  useEffect(() => {
    if (!currentStation) {
      return
    }

    const controller = new AbortController()

    void fetch("/api/stations/photos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        esrCode: currentStation.esrCode,
        stationTitle: currentStation.title,
      }),
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          return {
            photos: [] as StationPhotoItem[],
            debug: {
              error: `HTTP ${response.status}`,
            } as StationPhotosDebug & { error?: string },
          }
        }

        const payload = (await response.json().catch(() => null)) as
          | { photos?: StationPhotoItem[]; debug?: StationPhotosDebug }
          | null
        return {
          photos: Array.isArray(payload?.photos) ? payload.photos : [],
          debug: payload?.debug,
        }
      })
      .then((result) => {
        setStationPhotos(result.photos)
        const stationTitle = currentStation.title
        // Railwayz debug trace for local troubleshooting when photos do not appear.
        console.info("[station-photos]", {
          stationTitle,
          esrCode: currentStation.esrCode,
          photosCount: result.photos.length,
          debug: result.debug ?? null,
        })
      })
      .catch((error: unknown) => {
        const aborted =
          error instanceof DOMException
            ? error.name === "AbortError"
            : typeof error === "object" &&
              error !== null &&
              "name" in error &&
              (error as { name?: unknown }).name === "AbortError"

        if (!aborted) {
          setStationPhotos([])
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsPhotosLoading(false)
        }
      })

    return () => {
      controller.abort()
    }
  }, [currentStation])

  useEffect(() => {
    if (!currentTrain || !currentTrainKey) {
      return
    }

    const updated = trains.find((train) => trainInstanceKey(train) === currentTrainKey)
    if (!updated) {
      return
    }

    const currentDelaySignature = JSON.stringify([currentTrain.departure_event, currentTrain.arrival_event])
    const updatedDelaySignature = JSON.stringify([updated.departure_event, updated.arrival_event])
    const shouldSyncThreadRoute = !currentTrain.thread_route && (updated.thread_route || updated.thread_error)
    const shouldSyncDelay = currentDelaySignature !== updatedDelaySignature
    const currentTrainWithPosition = currentTrain as Partial<TrainWithCoordinates>
    const updatedTrainWithPosition = updated as Partial<TrainWithCoordinates>
    const shouldSyncPosition =
      currentTrainWithPosition.longitude !== updatedTrainWithPosition.longitude ||
      currentTrainWithPosition.latitude !== updatedTrainWithPosition.latitude

    if (shouldSyncThreadRoute || shouldSyncDelay || shouldSyncPosition) {
      setCurrentTrain(updated)
    }
  }, [currentTrain, currentTrainKey, trains, setCurrentTrain])

  useEffect(() => {
    const interval = setInterval(() => {
      setClockTimestamp((prevTimestamp) => {
        const nextTimestamp = getNow(clockMode).getTime()
        return nextTimestamp === prevTimestamp ? prevTimestamp : nextTimestamp
      })
    }, CLOCK_TICK_MS)

    return () => {
      clearInterval(interval)
    }
  }, [clockMode])

  const renderedSuburbanTrains = useMemo(
    () =>
      trains.map((train) => {
        const trainKey = trainInstanceKey(train)
        const routeId = train.mcd_route_id ?? "mcd2"
        const routeData = routeDataById[routeId] ?? null
        const snapped = snapToRoute([train.longitude, train.latitude], routeData)
        const [lon, lat] = snapped.point
        const heading = resolveTrainHeading(train, snapped)
        const headingBucket = bucketHeading(heading)
        const isSelected = currentTrainKey === trainKey
        const selectedColor = ROUTE_COLOR_BY_ID[routeId]
        const iconSrc = trainIconSrc(train)
        const iconCacheKey = `${iconSrc}|${trainIconSize}|${headingBucket}|${isSelected ? "1" : "0"}|${selectedColor}`
        const cachedIcon = trainIconCache.get(iconCacheKey)
        const icon =
          cachedIcon ??
          createTrainIconWithSelection(iconSrc, headingBucket, trainIconSize, isSelected, selectedColor)

        if (!cachedIcon) {
          trainIconCache.set(iconCacheKey, icon)
        }

        return {
          train,
          trainKey,
          position: [lat, lon] as [number, number],
          isSelected,
          icon,
          delayDetails: getTrainDelayLabels(train),
        }
      }),
    [currentTrainKey, routeDataById, trainIconSize, trains],
  )

  const renderedLongDistanceTrains = useMemo(
    () =>
      visibleLongDistanceTrains.map((train) => {
        const trainKey = longDistanceTrainKey(train)
        const isSelected = selectedLongDistanceTrainKey === trainKey
        const iconCacheKey = `${trainIconSize}|${isSelected ? "1" : "0"}`
        const cachedIcon = longDistanceIconCache.get(iconCacheKey)
        const icon = cachedIcon ?? createLongDistanceTrainIcon(trainIconSize, isSelected)

        if (!cachedIcon) {
          longDistanceIconCache.set(iconCacheKey, icon)
        }

        return {
          train,
          trainKey,
          isSelected,
          icon,
        }
      }),
    [selectedLongDistanceTrainKey, trainIconSize, visibleLongDistanceTrains],
  )

  return (
    <div className="relative h-full min-h-0">
      {routeError || trainsError || threadsError || longDistanceTrainsError ? (
        <div className="pointer-events-none absolute top-2 right-3 left-3 z-[1250] space-y-2 sm:top-3 sm:right-5 sm:left-auto sm:w-96 sm:max-w-[calc(100vw-2.5rem)]">
          {routeError ? (
            <p className="pointer-events-auto rounded-md border border-destructive/30 bg-card/95 px-3 py-2 text-sm text-destructive shadow-md backdrop-blur">
              {routeError}
            </p>
          ) : null}
          {trainsError ? (
            <p className="pointer-events-auto rounded-md border border-destructive/30 bg-card/95 px-3 py-2 text-sm text-destructive shadow-md backdrop-blur">
              {trainsError}
            </p>
          ) : null}
          {threadsError ? (
            <p className="pointer-events-auto rounded-md border border-destructive/30 bg-card/95 px-3 py-2 text-sm text-destructive shadow-md backdrop-blur">
              {threadsError}
            </p>
          ) : null}
          {longDistanceTrainsError ? (
            <p className="pointer-events-auto rounded-md border border-destructive/30 bg-card/95 px-3 py-2 text-sm text-destructive shadow-md backdrop-blur">
              Не удалось загрузить поезда дальнего следования: {longDistanceTrainsError}
            </p>
          ) : null}
        </div>
      ) : null}
      {!showLongDistanceTrains ? (
        <>
          <TrainSidebar />
          <StationSidebar
            station={
              currentStation
                ? {
                    title: currentStation.title,
                    direction: currentStation.direction,
                    esrCode: currentStation.esrCode,
                  }
                : null
            }
            schedule={stationSchedule}
            photos={currentStation ? stationPhotos : []}
            isPhotosLoading={Boolean(currentStation) && isPhotosLoading}
            onClose={closeStationSidebar}
          />
        </>
      ) : (
        <LongDistanceTrainSidebar
          train={selectedLongDistanceTrain}
          route={selectedLongDistanceRoute}
          isLoading={isLongDistanceRouteLoading}
          error={longDistanceRouteError}
          onClose={closeLongDistanceSidebar}
        />
      )}
      <MapContainer
        center={MOSCOW_CENTER}
        zoom={10}
        className="rzd-map relative z-0 h-full w-full rounded-xl"
        scrollWheelZoom
      >
        <MapControlPositioner />
        <PopupCloserOnSidebarClose
          isSidebarOpen={Boolean(currentTrain || currentStation || selectedLongDistanceTrain)}
        />
        <StationSidebarMapClickCloser
          onCloseStationSidebar={closeStationSidebar}
          shouldIgnoreMapClick={shouldIgnoreMapClick}
        />
        <MapZoomWatcher onZoomChange={setCurrentZoom} />
        <SuburbanViewportWatcher
          enabled={!showLongDistanceTrains}
          onBoundsChange={setSuburbanViewportBounds}
        />
        <LongDistanceTrainLoader
          enabled={showLongDistanceTrains}
          onError={setLongDistanceTrainsError}
          onTrainsChange={setLongDistanceTrains}
        />
        <ZoomToSelectedStation
          station={currentStation}
          stationTitle={currentStationTitle}
          routeDataById={routeDataById}
        />
        <ZoomToSelectedTrain
          train={selectedTrainForZoom}
          trainKey={currentTrainKey}
          routeDataById={routeDataById}
        />
        <ZoomToLongDistanceRoute
          route={selectedLongDistanceRoute}
          routeKey={selectedLongDistanceTrainKey}
        />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url={`https://{s}.basemaps.cartocdn.com/${tileTheme}_all/{z}/{x}/{y}{r}.png`}
        />
        {showLongDistanceTrains ? (
          <TileLayer
            attribution={OPENRAILWAYMAP_ATTRIBUTION}
            className="openrailwaymap-muted-layer"
            opacity={0.26}
            url={"https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png"}
            zIndex={320}
          />
        ) : null}
        <div className="leaflet-top leaflet-left z-[1000] hidden sm:block">
          <div className="leaflet-control mt-3 ml-3">
            <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-card/95 px-3 py-2 text-sm font-medium shadow-md backdrop-blur transition hover:bg-accent">
              <Switch
                checked={showLongDistanceTrains}
                onCheckedChange={handleShowLongDistanceTrainsChange}
                aria-label="Показать поезда дальнего следования"
              />
              <span>Поезда дальнего следования</span>
              {showLongDistanceTrains && visibleLongDistanceTrains.length > 0 ? (
                <span className="rounded-sm bg-primary px-1.5 py-0.5 text-xs text-primary-foreground">
                  {visibleLongDistanceTrains.length}
                </span>
              ) : null}
            </label>
          </div>
        </div>
        {!showLongDistanceTrains && builtRoutes.length > 0 ? (
          <>
            {ROUTE_DEFINITIONS.map((routeDefinition) => {
              const route = routeDataById[routeDefinition.id]
              if (!route) {
                return null
              }
              const isSelectedRoute = selectedTrainRouteOverlay?.routeId === routeDefinition.id
              const upcomingRoute = isSelectedRoute ? selectedTrainRouteOverlay?.upcomingRoute : null
              const passedRoute = isSelectedRoute ? selectedTrainRouteOverlay?.passedRoute : null
              const overlayKeySuffix = currentTrainKey ?? "no-train"
              const overlayMotionKey = `${overlayKeySuffix}-${Math.floor(clockTimestamp / CLOCK_TICK_MS)}`

              return [
                <GeoJSON
                  key={routeDefinition.id}
                  data={route}
                  style={{
                    weight: 4,
                    opacity: 1,
                    color: routeDefinition.color,
                  }}
                />,
                upcomingRoute ? (
                  <GeoJSON
                    key={`${routeDefinition.id}-upcoming-progress-${overlayMotionKey}`}
                    data={upcomingRoute}
                    style={{
                      color: "#fff",
                      weight: 3,
                      opacity: 0.95,
                      dashArray: "10 10",
                      lineCap: "round",
                    }}
                  />
                ) : null,
                passedRoute ? (
                  <GeoJSON
                    key={`${routeDefinition.id}-passed-progress-${overlayMotionKey}`}
                    data={passedRoute}
                    style={{
                      color: routeDefinition.color,
                      weight: 8,
                      opacity: 1,
                      lineCap: "round",
                    }}
                  />
                ) : null,
              ]
            })}
            {videoSectionRouteData ? (
              <GeoJSON
                data={videoSectionRouteData}
                style={{
                  weight: 1.5,
                  opacity: 1,
                  color: "#ffffff",
                }}
              />
            ) : null}
            <RouteBounds routes={builtRoutes} />
          </>
        ) : null}

        {showLongDistanceTrains && selectedLongDistanceRoute ? (
          <>
            <GeoJSON
              key={`${selectedLongDistanceTrainKey ?? "long-distance"}-route-shadow`}
              data={selectedLongDistanceRoute.routeGeoJson}
              style={{
                color: "#202124",
                weight: 8,
                opacity: 0.62,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
            {selectedLongDistanceRouteOverlay?.upcomingRoute ? (
              <GeoJSON
                key={`${selectedLongDistanceTrainKey ?? "long-distance"}-route-upcoming`}
                data={selectedLongDistanceRouteOverlay.upcomingRoute}
                style={{
                  color: "#E42D24",
                  weight: 5,
                  opacity: 0.96,
                  lineCap: "round",
                  lineJoin: "round",
                }}
              />
            ) : null}
            {selectedLongDistanceRouteOverlay?.passedRoute ? (
              <GeoJSON
                key={`${selectedLongDistanceTrainKey ?? "long-distance"}-route-passed`}
                data={selectedLongDistanceRouteOverlay.passedRoute}
                style={{
                  color: "#7f1d1d",
                  weight: 5,
                  opacity: 0.9,
                  lineCap: "round",
                  lineJoin: "round",
                }}
              />
            ) : null}
            <GeoJSON
              key={`${selectedLongDistanceTrainKey ?? "long-distance"}-route-sleepers`}
              data={selectedLongDistanceRoute.routeGeoJson}
              style={{
                color: "#ffffff",
                weight: 2,
                opacity: 0.9,
                dashArray: "1 13",
                lineCap: "butt",
              }}
            />
            {selectedLongDistanceRoute.stations.map((station, index) => {
              const [longitude, latitude] = station.coordinates
              return (
                <CircleMarker
                  key={`${station.id}-${index}-long-distance-station`}
                  center={[latitude, longitude]}
                  radius={index === 0 || index === selectedLongDistanceRoute.stations.length - 1 ? 5 : 3}
                  pathOptions={{
                    color: station.traversed ? "#7f1d1d" : "#E42D24",
                    fillColor: "#ffffff",
                    fillOpacity: 1,
                    weight: 2,
                  }}
                >
                  <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                    {station.name}
                  </Tooltip>
                </CircleMarker>
              )
            })}
          </>
        ) : null}

        {!showLongDistanceTrains && renderedRouteStations.map(({ station, center }) => (
          <CircleMarker
            key={`${station.routeId}-${station.code}`}
            center={center}
            radius={stationMarkerRadius}
            pathOptions={{
              color: station.color,
              fillColor: station.color,
              fillOpacity: 1,
              weight: 1,
            }}
            bubblingMouseEvents={false}
            eventHandlers={{
              click: () => {
                stationClickLockUntilRef.current = Date.now() + 350
                setCurrentTrain(null)
                setCurrentStationTitle(station.title)
                setCurrentStation(station)
                setStationPhotos([])
                setIsPhotosLoading(true)
              },
            }}
          >
            <Tooltip
              key={`${station.routeId}-${station.code}-${showPermanentStationLabels ? "permanent" : "hover"}`}
              direction="top"
              offset={[0, -6]}
              opacity={1}
              permanent={showPermanentStationLabels}
            >
              {station.title}
            </Tooltip>
          </CircleMarker>
        ))}

        {!showLongDistanceTrains && renderedSuburbanTrains.map(({ train, trainKey, position, isSelected, icon, delayDetails }) => {
          return (
            <Marker
              position={position}
              icon={icon}
              key={trainKey}
              zIndexOffset={isSelected ? 1000 : 0}
              eventHandlers={{
                click: () => {
                  setCurrentStationTitle(null)
                  closeStationSidebar()
                  setCurrentTrain(train)
                },
                popupclose: () => setCurrentTrain(null),
              }}
            >
              <Popup
                eventHandlers={{
                  popupclose: () => setCurrentTrain(null),
                }}
              >
                <div>
                  <div>
                    {train.thread.number} {train.thread.title}
                  </div>
                  {delayDetails.length > 0 ? (
                    <div className="mt-1 space-y-1 text-sm">
                      {delayDetails.map((detail) => (
                        <div key={detail} className="text-destructive">
                          {detail}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </Popup>
            </Marker>
          )
        })}
        {showLongDistanceTrains
          ? renderedLongDistanceTrains.map(({ train, trainKey, isSelected, icon }) => {
              return (
                <Marker
                  key={train.id}
                  position={[train.latitude, train.longitude]}
                  icon={icon}
                  zIndexOffset={isSelected ? 1000 : 500}
                  eventHandlers={{
                    click: () => {
                      closeStationSidebar()
                      setCurrentStationTitle(null)
                      setCurrentTrain(null)
                      setSelectedLongDistanceTrain(train)
                    },
                    popupclose: () => {
                      if (selectedLongDistanceTrainKey === trainKey) {
                        closeLongDistanceSidebar()
                      }
                    },
                  }}
                >
                  <Tooltip direction="top" offset={[0, -6]} opacity={1}>
                    {normalizeLongDistanceRouteRequestNumber(train.number)}
                  </Tooltip>
                  <Popup>
                    <div>
                      <div>
                        Поезд{" "}
                        {selectedLongDistanceRoute?.number && isSelected
                          ? selectedLongDistanceRoute.number
                          : normalizeLongDistanceRouteRequestNumber(train.number)}
                      </div>
                      {isSelected && selectedLongDistanceRoute ? (
                        <div className="text-sm text-muted-foreground">
                          {selectedLongDistanceRoute.directionLabel}
                        </div>
                      ) : train.date ? (
                        <div className="text-sm text-muted-foreground">Дата: {train.date}</div>
                      ) : null}
                    </div>
                  </Popup>
                </Marker>
              )
            })
          : null}
      </MapContainer>
    </div>
  )
}



