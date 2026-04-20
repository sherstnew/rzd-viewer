"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { FeatureCollection, GeoJsonObject, LineString } from "geojson"
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
import { findTrains, Train, TrainWithCoordinates } from "@/lib/trains"
import stationsData from "@/jsons/stations.json"
import moscowBigGeoJson from "@/jsons/moscow-big.json"
import { getNow } from "@/lib/runtime-mode"
import { TrainSidebar } from "./train-sidebar"
import { StationSidebar, type StationPhotoItem } from "./station-sidebar"
import { useCurrentTrainStore } from "@/stores/currentTrainStore"
import { useTrainsStore } from "@/stores/trainsStore"

const moscowCenter: [number, number] = [55.7558, 37.6173]

type RouteGeoJson = FeatureCollection<LineString, { name: string }>
type LonLat = [number, number]
type RouteId = "mcd1" | "mcd2" | "mcd3"

type SnappedPoint = {
  point: LonLat
  headingDeg: number
  segmentStart: LonLat
  segmentEnd: LonLat
}

type StationCoordinates = {
  longitude: number
  latitude: number
}

type StationCandidate = {
  code: string
  title: string
  longitude: number
  latitude: number
  direction: string | null
  esrCode: string | null
}

type RouteStation = {
  routeId: RouteId
  code: string
  title: string
  longitude: number
  latitude: number
  direction: string | null
  esrCode: string | null
}

type RouteDefinition = {
  id: RouteId
  label: string
  color: string
  start: LonLat
  end: LonLat
}

type NearestProjection = {
  point: LonLat
  distanceSq: number
  segmentIndex: number
  segmentStart: LonLat
  segmentEnd: LonLat
  headingDeg: number
}

type RouteDataById = Partial<Record<RouteId, RouteGeoJson>>
type RouteStationsById = Record<RouteId, RouteStation[]>

const TRAIN_ICON_SIZE_PX = 30
const TRAIN_ICON_MIN_SIZE_PX = 20
const TRAIN_ICON_MAX_SIZE_PX = 54
const STATION_MARKER_SIZE_PX = 3
const STATION_MARKER_MIN_SIZE_PX = 2
const STATION_MARKER_MAX_SIZE_PX = 7
const STATION_LABEL_ZOOM_THRESHOLD = 13
const ROUTE_STATION_DISTANCE_THRESHOLD = 0.00025
const STATION_SCHEDULE_WINDOW_MS = 3 * 60 * 60 * 1000
const MCD1_ROUTE_COLOR = "#F6A500"
const MCD2_ROUTE_COLOR = "#d55384"
const MCD3_ROUTE_COLOR = "#E95B0C"
const PODOLSK_STATION_CODE = "s9600731"
const LOBNYA_STATION_CODE = "s9600781"
const IPPODROM_STATION_CODE = "s9601197"
const VIDEO_SECTION_START_TITLE = "Красный Строитель"
const VIDEO_SECTION_END_TITLE = "Подольск"

const ROUTE_DEFINITIONS: RouteDefinition[] = [
  {
    id: "mcd1",
    label: "МЦД-1",
    color: MCD1_ROUTE_COLOR,
    start: [37.28264496693386, 55.672407632018555],
    end: [37.484721474868444, 56.01327444797851],
  },
  {
    id: "mcd2",
    label: "МЦД-2",
    color: MCD2_ROUTE_COLOR,
    start: [37.18482251289728, 55.841658030144124],
    end: [37.56539830422924, 55.43156562773968],
  },
  {
    id: "mcd3",
    label: "МЦД-3",
    color: MCD3_ROUTE_COLOR,
    start: [37.173888, 55.980039],
    end: [38.23932639021258, 55.560367089788535],
  },
]
const FORWARD_TERMINAL_BY_ROUTE: Record<RouteId, string> = {
  mcd1: LOBNYA_STATION_CODE,
  mcd2: PODOLSK_STATION_CODE,
  mcd3: IPPODROM_STATION_CODE,
}
const ROUTE_COLOR_BY_ID: Record<RouteId, string> = {
  mcd1: MCD1_ROUTE_COLOR,
  mcd2: MCD2_ROUTE_COLOR,
  mcd3: MCD3_ROUTE_COLOR,
}

function parseCoordinate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string") {
    const normalized = value.trim().replace(",", ".")
    const parsed = Number(normalized)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function parseStationCode(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const record = value as Record<string, unknown>
  if (typeof record.yandex_code === "string" && record.yandex_code.length > 0) {
    return record.yandex_code
  }

  return null
}

function parseDirection(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim()
  }

  return null
}

function parseFirstEsrCode(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim()
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseFirstEsrCode(item)
      if (parsed) {
        return parsed
      }
    }
  }

  return null
}

const stationCoordinatesByCode = new Map<string, StationCoordinates>(
  Array.isArray(stationsData)
    ? stationsData.flatMap((station): Array<[string, StationCoordinates]> => {
        const stationRecord = station as Record<string, unknown>
        const code = parseStationCode(stationRecord.codes)
        const longitude = parseCoordinate(stationRecord.longitude)
        const latitude = parseCoordinate(stationRecord.latitude)

        if (!code || longitude === null || latitude === null) {
          return []
        }

        return [[code, { longitude, latitude }]]
      })
    : [],
)

const stationCoordinatesByTitle = new Map<string, StationCoordinates>(
  Array.isArray(stationsData)
    ? stationsData.flatMap((station): Array<[string, StationCoordinates]> => {
        const stationRecord = station as Record<string, unknown>
        const title = typeof stationRecord.title === "string" ? stationRecord.title : null
        const longitude = parseCoordinate(stationRecord.longitude)
        const latitude = parseCoordinate(stationRecord.latitude)

        if (!title || longitude === null || latitude === null) {
          return []
        }

        return [[title, { longitude, latitude }]]
      })
    : [],
)

const stationCandidates: StationCandidate[] = Array.isArray(stationsData)
  ? stationsData.flatMap((station): StationCandidate[] => {
      const stationRecord = station as Record<string, unknown>
      if (stationRecord.transport_type !== "train") {
        return []
      }

      const title = typeof stationRecord.title === "string" ? stationRecord.title : null
      const code = parseStationCode(stationRecord.codes) ?? title
      const longitude = parseCoordinate(stationRecord.longitude)
      const latitude = parseCoordinate(stationRecord.latitude)
      const direction = parseDirection(stationRecord.direction)
      const esrCode = parseFirstEsrCode(
        (stationRecord.codes as { esr_code?: unknown } | undefined)?.esr_code,
      )

      if (!code || !title || longitude === null || latitude === null) {
        return []
      }

      return [{ code, title, longitude, latitude, direction, esrCode }]
    })
  : []

function distanceSq(a: LonLat, b: LonLat): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy
}

function nearestCoordinateIndex(target: LonLat, coordinates: LonLat[]): number {
  let bestIndex = 0
  let bestDistance = Number.POSITIVE_INFINITY

  for (let i = 0; i < coordinates.length; i += 1) {
    const d = distanceSq(target, coordinates[i])
    if (d < bestDistance) {
      bestDistance = d
      bestIndex = i
    }
  }

  return bestIndex
}

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

function projectPointToSegment(point: LonLat, a: LonLat, b: LonLat): LonLat {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const abLenSq = abx * abx + aby * aby

  if (abLenSq === 0) {
    return a
  }

  const apx = point[0] - a[0]
  const apy = point[1] - a[1]
  let t = (apx * abx + apy * aby) / abLenSq
  t = Math.max(0, Math.min(1, t))

  return [a[0] + abx * t, a[1] + aby * t]
}

function headingFromSegment(a: LonLat, b: LonLat): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const radians = Math.atan2(dx, dy)
  const degrees = (radians * 180) / Math.PI
  return (degrees + 360) % 360
}

function findNearestProjection(point: LonLat, routeData: RouteGeoJson | null): NearestProjection | null {
  if (!routeData || routeData.features.length === 0) {
    return null
  }

  const coordinates = routeData.features[0]?.geometry.coordinates ?? []
  if (coordinates.length < 2) {
    return null
  }

  let bestProjection: LonLat = point
  let bestDistanceSq = Number.POSITIVE_INFINITY
  let bestSegmentIndex = 0
  let bestStart: LonLat = point
  let bestEnd: LonLat = point

  for (let i = 0; i < coordinates.length - 1; i += 1) {
    const a: LonLat = [coordinates[i][0], coordinates[i][1]]
    const b: LonLat = [coordinates[i + 1][0], coordinates[i + 1][1]]
    const projected = projectPointToSegment(point, a, b)
    const d = distanceSq(point, projected)

    if (d < bestDistanceSq) {
      bestDistanceSq = d
      bestProjection = projected
      bestSegmentIndex = i
      bestStart = a
      bestEnd = b
    }
  }

  return {
    point: bestProjection,
    distanceSq: bestDistanceSq,
    segmentIndex: bestSegmentIndex,
    segmentStart: bestStart,
    segmentEnd: bestEnd,
    headingDeg: headingFromSegment(bestStart, bestEnd),
  }
}

function createTrainIconWithSelection(
  iconSrc: string,
  headingDeg: number,
  sizePx: number,
  isSelected: boolean,
  selectedColor: string,
): L.DivIcon {
  const correctedHeading = (headingDeg + 180) % 360
  const shadow = isSelected
    ? `filter:drop-shadow(0 0 3px ${selectedColor}) drop-shadow(0 0 8px ${selectedColor});`
    : ""

  return L.divIcon({
    className: "train-marker-wrapper",
    iconSize: [sizePx, sizePx],
    iconAnchor: [sizePx / 2, sizePx / 2],
    html: `<img src="${iconSrc}" alt="Train" style="width:${sizePx}px;height:${sizePx}px;transform:rotate(${correctedHeading}deg);transform-origin:center center;object-fit:contain;${shadow}" />`,
  })
}

function trainIconSizeByZoom(zoom: number): number {
  const baselineZoom = 10
  const size = TRAIN_ICON_SIZE_PX + (zoom - baselineZoom) * 2.4
  return Math.round(Math.min(TRAIN_ICON_MAX_SIZE_PX, Math.max(TRAIN_ICON_MIN_SIZE_PX, size)))
}

function stationMarkerRadiusByZoom(zoom: number): number {
  const baselineZoom = 10
  const size = STATION_MARKER_SIZE_PX + (zoom - baselineZoom) * 0.32
  return Math.min(STATION_MARKER_MAX_SIZE_PX, Math.max(STATION_MARKER_MIN_SIZE_PX, size))
}

type StationScheduleItem = {
  key: string
  timestamp: number
  arrivalTimeLabel: string | null
  departureTimeLabel: string | null
  trainNumber: string
  trainTitle: string
  routeLabel: string
}

function toTimestamp(value: string | null | undefined): number | null {
  if (!value) {
    return null
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function formatScheduleTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

function buildStationSchedule(
  station: Pick<RouteStation, "code" | "title" | "routeId">,
  nowTimestamp: number,
  segments: Train[],
): StationScheduleItem[] {
  const windowEnd = nowTimestamp + STATION_SCHEDULE_WINDOW_MS
  const schedule: StationScheduleItem[] = []
  const normalizedStationTitle = station.title.trim().toLowerCase()

  for (const segment of segments) {
    if (segment.mcd_route_id && segment.mcd_route_id !== station.routeId) {
      continue
    }

    const segmentDeparture = toTimestamp(segment.departure)
    const segmentArrival = toTimestamp(segment.arrival)
    if (segmentDeparture === null || segmentArrival === null) {
      continue
    }

    const intersectsWindow = segmentArrival >= nowTimestamp && segmentDeparture <= windowEnd
    if (!intersectsWindow) {
      continue
    }

    const routeLabel = `${segment.from.title} - ${segment.to.title}`
    const stops = segment.thread_route?.stops ?? []
    let matchedStopArrivalTimestamp: number | null = null
    let matchedStopDepartureTimestamp: number | null = null
    let hasMatchedStop = false

    for (let i = 0; i < stops.length; i += 1) {
      const stop = stops[i]
      const stopTitle = stop.station.title.trim().toLowerCase()
      const isSameStation =
        stop.station.code === station.code || stopTitle === normalizedStationTitle
      if (!isSameStation) {
        continue
      }

      hasMatchedStop = true

      const arrivalTimestamp = toTimestamp(stop.arrival)
      if (
        arrivalTimestamp !== null &&
        arrivalTimestamp >= nowTimestamp &&
        arrivalTimestamp <= windowEnd
      ) {
        matchedStopArrivalTimestamp = arrivalTimestamp
      }

      const departureTimestamp = toTimestamp(stop.departure)
      if (
        departureTimestamp !== null &&
        departureTimestamp >= nowTimestamp &&
        departureTimestamp <= windowEnd
      ) {
        matchedStopDepartureTimestamp = departureTimestamp
      }
    }

    if (
      hasMatchedStop &&
      (matchedStopArrivalTimestamp !== null || matchedStopDepartureTimestamp !== null)
    ) {
      const sortTimestamp = Math.min(
        matchedStopArrivalTimestamp ?? Number.POSITIVE_INFINITY,
        matchedStopDepartureTimestamp ?? Number.POSITIVE_INFINITY,
      )

      schedule.push({
        key: `${segment.thread.uid}-${sortTimestamp}`,
        timestamp: sortTimestamp,
        arrivalTimeLabel:
          matchedStopArrivalTimestamp !== null
            ? formatScheduleTime(matchedStopArrivalTimestamp)
            : null,
        departureTimeLabel:
          matchedStopDepartureTimestamp !== null
            ? formatScheduleTime(matchedStopDepartureTimestamp)
            : null,
        trainNumber: segment.thread.number,
        trainTitle: segment.thread.title,
        routeLabel,
      })
    }

    if (hasMatchedStop) {
      continue
    }

    const isFromStation =
      segment.from.code === station.code ||
      segment.from.title.trim().toLowerCase() === normalizedStationTitle
    const isToStation =
      segment.to.code === station.code ||
      segment.to.title.trim().toLowerCase() === normalizedStationTitle

    if (isFromStation && segmentDeparture >= nowTimestamp && segmentDeparture <= windowEnd) {
      schedule.push({
        key: `${segment.thread.uid}-segment-departure-${segmentDeparture}`,
        timestamp: segmentDeparture,
        arrivalTimeLabel: null,
        departureTimeLabel: formatScheduleTime(segmentDeparture),
        trainNumber: segment.thread.number,
        trainTitle: segment.thread.title,
        routeLabel,
      })
    }

    if (isToStation && segmentArrival >= nowTimestamp && segmentArrival <= windowEnd) {
      schedule.push({
        key: `${segment.thread.uid}-segment-arrival-${segmentArrival}`,
        timestamp: segmentArrival,
        arrivalTimeLabel: formatScheduleTime(segmentArrival),
        departureTimeLabel: null,
        trainNumber: segment.thread.number,
        trainTitle: segment.thread.title,
        routeLabel,
      })
    }
  }

  schedule.sort((left, right) => left.timestamp - right.timestamp)
  return schedule
}

function trainIconSrc(train: TrainWithCoordinates): string {
  const subtypeTitle = train.thread.transport_subtype?.title?.toLowerCase() ?? ""

  if (subtypeTitle.includes("иволга") || subtypeTitle.includes("ivolga")) {
    return "/leaflet/ivolga.svg"
  }

  if (subtypeTitle.includes("стандарт плюс") || subtypeTitle.includes("standard plus")) {
    return "/leaflet/standart.svg"
  }

  return "/leaflet/standart.svg"
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
  const strictStations = allMatchedStations.filter((item) => item.distanceSq <= strictDistanceSq)
  const stationsToRender =
    strictStations.length >= 2
      ? strictStations
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
  routeDataById,
}: {
  station: RouteStation | null
  routeDataById: RouteDataById
}) {
  const map = useMap()

  useEffect(() => {
    if (!station) {
      return
    }

    const snapped = snapToRoute(
      [station.longitude, station.latitude],
      routeDataById[station.routeId] ?? null,
    )
    const [longitude, latitude] = snapped.point
    const targetZoom = Math.max(map.getZoom(), 13)

    map.flyTo([latitude, longitude], targetZoom, {
      animate: true,
      duration: 0.45,
    })
  }, [map, routeDataById, station])

  return null
}

export function MapExample() {
  const [currentZoom, setCurrentZoom] = useState(10)
  const [clockTimestamp, setClockTimestamp] = useState(() => getNow("real").getTime())
  const [currentStation, setCurrentStation] = useState<RouteStation | null>(null)
  const [stationPhotos, setStationPhotos] = useState<StationPhotoItem[]>([])
  const [isPhotosLoading, setIsPhotosLoading] = useState(false)
  const stationClickLockUntilRef = useRef(0)
  const showPermanentStationLabels = currentZoom >= STATION_LABEL_ZOOM_THRESHOLD
  const trainIconSize = trainIconSizeByZoom(currentZoom)
  const stationMarkerRadius = stationMarkerRadiusByZoom(currentZoom)
  const closeStationSidebar = useCallback(() => {
    setCurrentStation(null)
    setStationPhotos([])
    setIsPhotosLoading(false)
  }, [])

  const shouldIgnoreMapClick = useCallback(() => {
    return Date.now() < stationClickLockUntilRef.current
  }, [])

  const { currentTrain, setCurrentTrain } = useCurrentTrainStore()
  const {
    segments,
    threadsByUid,
    clockMode,
    fetchForToday,
    fetchThreadsForUids,
    error: trainsError,
    threadsError,
  } = useTrainsStore()

  const { routeDataById, routeError } = useMemo(() => {
    try {
      const routeEngine = createRouteEngine(moscowBigGeoJson as GeoJsonObject)
      const nextRoutes: RouteDataById = {}

      for (const routeDefinition of ROUTE_DEFINITIONS) {
        nextRoutes[routeDefinition.id] = routeEngine.findRoute(
          routeDefinition.start,
          routeDefinition.end,
        )
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

  const activeTrainUids = useMemo(() => {
    const now = clockTimestamp
    const uids = new Set<string>()

    for (const segment of segments) {
      const uid = segment.thread?.uid
      if (!uid) {
        continue
      }

      const departureMs = new Date(segment.departure).getTime()
      const arrivalMs = new Date(segment.arrival).getTime()
      if (!Number.isFinite(departureMs) || !Number.isFinite(arrivalMs)) {
        continue
      }

      if (departureMs <= now && now <= arrivalMs) {
        uids.add(uid)
      }
    }

    return Array.from(uids)
  }, [clockTimestamp, segments])

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

  const routeStationsById = useMemo((): RouteStationsById => {
    return {
      mcd1: buildAutoStationsForRoute("mcd1", routeDataById.mcd1 ?? null),
      mcd2: buildAutoStationsForRoute("mcd2", routeDataById.mcd2 ?? null),
      mcd3: buildAutoStationsForRoute("mcd3", routeDataById.mcd3 ?? null),
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

  const stationSchedule = useMemo<StationScheduleItem[]>(() => {
    if (!currentStation) {
      return []
    }

    return buildStationSchedule(currentStation, clockTimestamp, hydratedSegments)
  }, [clockTimestamp, currentStation, hydratedSegments])

  const upcomingStationTrainUids = useMemo(() => {
    if (!currentStation) {
      return []
    }

    const windowEnd = clockTimestamp + STATION_SCHEDULE_WINDOW_MS
    const uids = new Set<string>()

    for (const segment of segments) {
      const uid = segment.thread?.uid
      if (!uid) {
        continue
      }

      if (segment.mcd_route_id && segment.mcd_route_id !== currentStation.routeId) {
        continue
      }

      const departureTimestamp = toTimestamp(segment.departure)
      const arrivalTimestamp = toTimestamp(segment.arrival)
      if (departureTimestamp === null || arrivalTimestamp === null) {
        continue
      }

      if (arrivalTimestamp >= clockTimestamp && departureTimestamp <= windowEnd) {
        uids.add(uid)
      }
    }

    return Array.from(uids)
  }, [clockTimestamp, currentStation, segments])

  useEffect(() => {
    void fetchForToday()
  }, [fetchForToday])

  useEffect(() => {
    if (activeTrainUids.length === 0) {
      return
    }

    void fetchThreadsForUids(activeTrainUids)

    const interval = setInterval(() => {
      void fetchThreadsForUids(activeTrainUids)
    }, 7000)

    return () => {
      clearInterval(interval)
    }
  }, [activeTrainUids, fetchThreadsForUids])

  useEffect(() => {
    if (!currentStation || upcomingStationTrainUids.length === 0) {
      return
    }

    void fetchThreadsForUids(upcomingStationTrainUids)
  }, [currentStation, fetchThreadsForUids, upcomingStationTrainUids])

  useEffect(() => {
    if (!currentStation?.esrCode) {
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
      }),
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) {
          return { photos: [] as StationPhotoItem[] }
        }

        const payload = (await response.json().catch(() => null)) as
          | { photos?: StationPhotoItem[] }
          | null
        return {
          photos: Array.isArray(payload?.photos) ? payload.photos : [],
        }
      })
      .then((result) => {
        setStationPhotos(result.photos)
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
  }, [currentStation?.code, currentStation?.esrCode])

  useEffect(() => {
    if (!currentTrain?.thread.uid) {
      return
    }

    const updated = trains.find((train) => train.thread.uid === currentTrain.thread.uid)
    if (!updated) {
      return
    }

    if (!currentTrain.thread_route && (updated.thread_route || updated.thread_error)) {
      setCurrentTrain(updated)
    }
  }, [currentTrain, trains, setCurrentTrain])

  useEffect(() => {
    const interval = setInterval(() => {
      setClockTimestamp(getNow(clockMode).getTime())
    }, 500)

    return () => {
      clearInterval(interval)
    }
  }, [clockMode])

  return (
    <div className="relative h-full space-y-4">
      {routeError ? <p className="text-sm text-destructive">{routeError}</p> : null}
      {trainsError ? <p className="text-sm text-destructive">{trainsError}</p> : null}
      {threadsError ? <p className="text-sm text-destructive">{threadsError}</p> : null}
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
        photos={currentStation?.esrCode ? stationPhotos : []}
        isPhotosLoading={Boolean(currentStation?.esrCode) && isPhotosLoading}
        onClose={closeStationSidebar}
      />
      <MapContainer
        center={moscowCenter}
        zoom={10}
        className="rzd-map relative z-0 h-full w-full rounded-xl"
        scrollWheelZoom
      >
        <MapControlPositioner />
        <PopupCloserOnSidebarClose isSidebarOpen={Boolean(currentTrain || currentStation)} />
        <StationSidebarMapClickCloser
          onCloseStationSidebar={closeStationSidebar}
          shouldIgnoreMapClick={shouldIgnoreMapClick}
        />
        <MapZoomWatcher onZoomChange={setCurrentZoom} />
        <ZoomToSelectedStation station={currentStation} routeDataById={routeDataById} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url={`https://{s}.basemaps.cartocdn.com/${tileTheme}_all/{z}/{x}/{y}{r}.png`}
        />
        {builtRoutes.length > 0 ? (
          <>
            {ROUTE_DEFINITIONS.map((routeDefinition) => {
              const route = routeDataById[routeDefinition.id]
              if (!route) {
                return null
              }

              return (
                <GeoJSON
                  key={routeDefinition.id}
                  data={route}
                  style={{
                    weight: 4,
                    opacity: 1,
                    color: routeDefinition.color,
                  }}
                />
              )
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

        {routeStations.map((station) => (
          <CircleMarker
            key={`${station.routeId}-${station.code}`}
            center={(() => {
              const snapped = snapToRoute(
                [station.longitude, station.latitude],
                routeDataById[station.routeId] ?? null,
              )
              const [lon, lat] = snapped.point
              return [lat, lon] as [number, number]
            })()}
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
                setCurrentStation(station)
                setStationPhotos([])
                setIsPhotosLoading(Boolean(station.esrCode))
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

        {trains.map((train) => {
          const routeId = train.mcd_route_id ?? "mcd2"
          const routeData = routeDataById[routeId] ?? null
          const snapped = snapToRoute([train.longitude, train.latitude], routeData)
          const [lon, lat] = snapped.point
          const heading = resolveTrainHeading(train, snapped)
          const isSelected = currentTrain?.thread.uid === train.thread.uid
          const selectedColor = ROUTE_COLOR_BY_ID[routeId]

          return (
            <Marker
              position={[lat, lon]}
              icon={createTrainIconWithSelection(
                trainIconSrc(train),
                heading,
                trainIconSize,
                isSelected,
                selectedColor,
              )}
              key={train.thread.uid}
              zIndexOffset={isSelected ? 1000 : 0}
              eventHandlers={{
                click: () => {
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
                {train.thread.number} {train.thread.title}
              </Popup>
            </Marker>
          )
        })}
      </MapContainer>
    </div>
  )
}
