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
import { resolveTrainProgressByStops } from "@/lib/train-progress"
import { findTrains, Train, TrainWithCoordinates } from "@/lib/trains"
import { formatTrainDelay, getTrainDelayLabels } from "@/lib/train-delays"
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
type RouteId =
  | "mcd1"
  | "mcd2"
  | "mcd3"
  | "mcd4"
  | "mcd5_south"
  | "mcd5_north"
  | "mcd5_korolev"
  | "mck"

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
  start?: LonLat
  end?: LonLat
  stationCodes?: readonly string[]
  isCircular?: boolean
}

type NearestProjection = {
  point: LonLat
  distanceSq: number
  segmentIndex: number
  t: number
  segmentStart: LonLat
  segmentEnd: LonLat
  headingDeg: number
}

type RouteDataById = Partial<Record<RouteId, RouteGeoJson>>
type RouteStationsById = Record<RouteId, RouteStation[]>
type RouteProgressOverlay = {
  routeId: RouteId
  passedRoute: RouteGeoJson | null
  upcomingRoute: RouteGeoJson | null
}

const TRAIN_ICON_SIZE_PX = 25
const TRAIN_ICON_MIN_SIZE_PX = 10
const TRAIN_ICON_MAX_SIZE_PX = 54
const STATION_MARKER_SIZE_PX = 3
const STATION_MARKER_MIN_SIZE_PX = 2
const STATION_MARKER_MAX_SIZE_PX = 7
const STATION_LABEL_ZOOM_THRESHOLD = 13
const ROUTE_STATION_DISTANCE_THRESHOLD = 0.00025
const STATION_SCHEDULE_WINDOW_MS = 60 * 60 * 1000
const MCD1_ROUTE_COLOR = "#F6A500"
const MCD2_ROUTE_COLOR = "#d55384"
const MCD3_ROUTE_COLOR = "#E95B0C"
const MCD4_ROUTE_COLOR = "#41B384"
const MCD5_ROUTE_COLOR = "#77B729"
const MCK_ROUTE_COLOR = "#E42D24"
const PODOLSK_STATION_CODE = "s9600731"
const LOBNYA_STATION_CODE = "s9600781"
const IPPODROM_STATION_CODE = "s9601197"
const ZHELEZNODOROZHNAYA_STATION_CODE = "s9601675"
const DOMODEDOVO_STATION_CODE = "s9600811"
const PUSHKINO_STATION_CODE = "s9600701"
const BOLSHEVO_STATION_CODE = "s9602217"
const ANDRONOVKA_MCK_STATION_CODE = "s9855157"
const LYUBLINO_STATION_CODE = "s9601788"
const VIDEO_SECTION_START_TITLE = "Красный Строитель"
const VIDEO_SECTION_END_TITLE = "Подольск"
const MCK_STATION_CODES = [
  "s9855157",
  "s9855163",
  "s9855164",
  "s9855165",
  "s9855166",
  "s9855167",
  "s9855168",
  "s9855169",
  "s9855170",
  "s9855171",
  "s9855172",
  "s9855158",
  "s9855173",
  "s9855174",
  "s9855175",
  "s9855176",
  "s9855177",
  "s9855178",
  "s9855179",
  "s9855180",
  "s9855181",
  "s9855182",
  "s9855159",
  "s9855184",
  "s9855186",
  "s9601063",
  "s9855187",
  "s9601334",
  "s9855160",
  "s9855161",
  "s9855162",
] as const

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
  {
    id: "mcd4",
    label: "МЦД-4",
    color: MCD4_ROUTE_COLOR,
    start: [37.066874, 55.550152],
    end: [38.00832, 55.752306],
  },
  {
    id: "mcd5_south",
    label: "МЦД-5",
    color: MCD5_ROUTE_COLOR,
    start: [37.640771, 55.729498],
    end: [37.773381, 55.4399],
  },
  {
    id: "mcd5_north",
    label: "МЦД-5",
    color: MCD5_ROUTE_COLOR,
    start: [37.657484, 55.777685],
    end: [37.839165, 56.012485],
  },
  {
    id: "mcd5_korolev",
    label: "МЦД-5",
    color: MCD5_ROUTE_COLOR,
    start: [37.761228, 55.914823],
    end: [37.861022, 55.926201],
  },
  {
    id: "mck",
    label: "МЦК",
    color: MCK_ROUTE_COLOR,
    stationCodes: MCK_STATION_CODES,
    isCircular: true,
  },
]
const FORWARD_TERMINAL_BY_ROUTE: Record<RouteId, string> = {
  mcd1: LOBNYA_STATION_CODE,
  mcd2: PODOLSK_STATION_CODE,
  mcd3: IPPODROM_STATION_CODE,
  mcd4: ZHELEZNODOROZHNAYA_STATION_CODE,
  mcd5_south: DOMODEDOVO_STATION_CODE,
  mcd5_north: PUSHKINO_STATION_CODE,
  mcd5_korolev: BOLSHEVO_STATION_CODE,
  mck: ANDRONOVKA_MCK_STATION_CODE,
}
const ROUTE_COLOR_BY_ID: Record<RouteId, string> = {
  mcd1: MCD1_ROUTE_COLOR,
  mcd2: MCD2_ROUTE_COLOR,
  mcd3: MCD3_ROUTE_COLOR,
  mcd4: MCD4_ROUTE_COLOR,
  mcd5_south: MCD5_ROUTE_COLOR,
  mcd5_north: MCD5_ROUTE_COLOR,
  mcd5_korolev: MCD5_ROUTE_COLOR,
  mck: MCK_ROUTE_COLOR,
}
const FORCED_STATION_CODES_BY_ROUTE: Partial<Record<RouteId, readonly string[]>> = {
  mcd2: [LYUBLINO_STATION_CODE],
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
const stationCandidateByCode = new Map(stationCandidates.map((station) => [station.code, station]))

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

function coordinateIndexValueFromProjection(projection: NearestProjection): number {
  return projection.segmentIndex + projection.t
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
  let bestSegmentT = 0
  let bestStart: LonLat = point
  let bestEnd: LonLat = point

  for (let i = 0; i < coordinates.length - 1; i += 1) {
    const a: LonLat = [coordinates[i][0], coordinates[i][1]]
    const b: LonLat = [coordinates[i + 1][0], coordinates[i + 1][1]]
    const abx = b[0] - a[0]
    const aby = b[1] - a[1]
    const abLenSq = abx * abx + aby * aby
    const apx = point[0] - a[0]
    const apy = point[1] - a[1]
    const rawT = abLenSq === 0 ? 0 : (apx * abx + apy * aby) / abLenSq
    const t = Math.max(0, Math.min(1, rawT))
    const projected = projectPointToSegment(point, a, b)
    const d = distanceSq(point, projected)

    if (d < bestDistanceSq) {
      bestDistanceSq = d
      bestProjection = projected
      bestSegmentIndex = i
      bestSegmentT = t
      bestStart = a
      bestEnd = b
    }
  }

  return {
    point: bestProjection,
    distanceSq: bestDistanceSq,
    segmentIndex: bestSegmentIndex,
    t: bestSegmentT,
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
  const isRzdIcon = iconSrc.endsWith("/rzd.svg")
  const isMostransIcon = iconSrc.endsWith("/mostrans.svg")
  const logoMarkerSize = Math.round(sizePx * 0.78)
  const logoMarkerBorderWidth = Math.max(1, Math.round(logoMarkerSize * 0.08))
  const rzdLogoWidth = Math.round(logoMarkerSize * 0.6)
  const mostransLogoSize = Math.round(logoMarkerSize * 0.46)
  const mostransLogoPadding = Math.max(2, Math.round(logoMarkerSize * 0.1))
  const iconHtml = isRzdIcon
    ? `<div style="width:${sizePx}px;height:${sizePx}px;display:flex;align-items:center;justify-content:center;"><div style="width:${logoMarkerSize}px;height:${logoMarkerSize}px;transform:rotate(${correctedHeading - 45}deg);transform-origin:center center;border:${logoMarkerBorderWidth}px solid #000;border-radius:50% 50% 50% 0;background:#fff;display:flex;align-items:center;justify-content:center;box-sizing:border-box;${shadow}"><img src="${iconSrc}" alt="Train" style="width:${rzdLogoWidth}px;height:auto;transform:rotate(45deg);object-fit:contain;" /></div></div>`
    : isMostransIcon
      ? `<div style="width:${sizePx}px;height:${sizePx}px;display:flex;align-items:center;justify-content:center;"><div style="width:${logoMarkerSize}px;height:${logoMarkerSize}px;transform:rotate(${correctedHeading - 45}deg);transform-origin:center center;border:${logoMarkerBorderWidth}px solid #000;border-radius:50% 50% 50% 0;background:#fff;display:flex;align-items:center;justify-content:center;box-sizing:border-box;${shadow}"><div style="width:${mostransLogoSize + mostransLogoPadding * 2}px;height:${mostransLogoSize + mostransLogoPadding * 2}px;border-radius:999px;background:#fff;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:${mostransLogoPadding}px;transform:rotate(45deg);"><img src="${iconSrc}" alt="Train" style="width:${mostransLogoSize}px;height:${mostransLogoSize}px;object-fit:contain;" /></div></div>`
    : `<img src="${iconSrc}" alt="Train" style="width:${sizePx}px;height:${sizePx}px;transform:rotate(${correctedHeading}deg);transform-origin:center center;object-fit:contain;${shadow}" />`

  return L.divIcon({
    className: "train-marker-wrapper",
    iconSize: [sizePx, sizePx],
    iconAnchor: [sizePx / 2, sizePx / 2],
    html: iconHtml,
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
  arrivalDelayLabel: string | null
  departureDelayLabel: string | null
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

function routeGroup(routeId: RouteId | undefined): string {
  return routeId?.startsWith("mcd5_") ? "mcd5" : (routeId ?? "mcd2")
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
    if (segment.mcd_route_id && routeGroup(segment.mcd_route_id) !== routeGroup(station.routeId)) {
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
    let matchedStopArrivalDelayLabel: string | null = null
    let matchedStopDepartureDelayLabel: string | null = null
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
        matchedStopArrivalDelayLabel =
          stop.station.code === segment.to.code ? formatTrainDelay(segment, "arrival") : null
      }

      const departureTimestamp = toTimestamp(stop.departure)
      if (
        departureTimestamp !== null &&
        departureTimestamp >= nowTimestamp &&
        departureTimestamp <= windowEnd
      ) {
        matchedStopDepartureTimestamp = departureTimestamp
        matchedStopDepartureDelayLabel =
          stop.station.code === segment.from.code ? formatTrainDelay(segment, "departure") : null
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
        arrivalDelayLabel: matchedStopArrivalDelayLabel,
        departureDelayLabel: matchedStopDepartureDelayLabel,
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
        arrivalDelayLabel: null,
        departureDelayLabel: formatTrainDelay(segment, "departure"),
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
        arrivalDelayLabel: formatTrainDelay(segment, "arrival"),
        departureDelayLabel: null,
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

  if (subtypeTitle.includes("ласточка") || subtypeTitle.includes("lastochka")) {
    return "/leaflet/mostrans.svg"
  }

  return "/leaflet/rzd.svg"
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

function buildExactStationsForRoute(routeId: RouteId, stationCodes: readonly string[]): RouteStation[] {
  return stationCodes.flatMap((code): RouteStation[] => {
    const station = stationCandidateByCode.get(code)
    if (!station) {
      return []
    }

    return [
      {
        routeId,
        code: station.code,
        title: station.title,
        longitude: station.longitude,
        latitude: station.latitude,
        direction: station.direction,
        esrCode: station.esrCode,
      },
    ]
  })
}

function buildStationCodeRoute(
  routeEngine: ReturnType<typeof createRouteEngine>,
  routeDefinition: RouteDefinition,
): RouteGeoJson {
  const stationCodes = routeDefinition.stationCodes ?? []
  const stationCoordinates = stationCodes.map((code) => {
    const coordinates = stationCoordinatesByCode.get(code)
    if (!coordinates) {
      throw new Error(`Не найдены координаты станции ${code} для ${routeDefinition.label}`)
    }

    return [coordinates.longitude, coordinates.latitude] as LonLat
  })
  const pairs = routeDefinition.isCircular
    ? stationCoordinates.map((coordinates, index) => [
        coordinates,
        stationCoordinates[(index + 1) % stationCoordinates.length],
      ])
    : stationCoordinates.slice(0, -1).map((coordinates, index) => [
        coordinates,
        stationCoordinates[index + 1],
      ])
  const coordinates: LonLat[] = []

  for (const [start, end] of pairs) {
    const segment = routeEngine.findRoute(start, end)
    const segmentCoordinates = segment.features[0]?.geometry.coordinates as LonLat[] | undefined
    if (!segmentCoordinates || segmentCoordinates.length < 2) {
      continue
    }

    coordinates.push(...(coordinates.length === 0 ? segmentCoordinates : segmentCoordinates.slice(1)))
  }

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: routeDefinition.label },
        geometry: {
          type: "LineString",
          coordinates,
        },
      },
    ],
  }
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

  const {
    currentTrain,
    currentStationTitle,
    setCurrentTrain,
    setCurrentStationTitle,
    setRouteStationTitles,
  } =
    useCurrentTrainStore()
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
        if (routeDefinition.stationCodes) {
          nextRoutes[routeDefinition.id] = buildStationCodeRoute(routeEngine, routeDefinition)
          continue
        }

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

  const currentTrainKey = currentTrain ? trainInstanceKey(currentTrain) : null
  const selectedTrainForZoom = useMemo(
    () => (currentTrainKey ? trains.find((train) => trainInstanceKey(train) === currentTrainKey) ?? null : null),
    [currentTrainKey, trains],
  )

  const selectedTrainRouteOverlay = useMemo(
    () => buildTrainRouteProgressOverlay(selectedTrainForZoom ?? currentTrain, routeDataById, clockTimestamp),
    [clockTimestamp, currentTrain, routeDataById, selectedTrainForZoom],
  )

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
      mck: buildExactStationsForRoute("mck", MCK_STATION_CODES),
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

  useEffect(() => {
    setRouteStationTitles(Array.from(new Set(routeStations.map((station) => station.title))))
  }, [routeStations, setRouteStationTitles])

  useEffect(() => {
    if (!currentStationTitle) {
      return
    }

    const station = routeStations.find((routeStation) => routeStation.title === currentStationTitle)

    setCurrentTrain(null)
    setCurrentStation(station ?? null)
    setStationPhotos([])
    setIsPhotosLoading(Boolean(station?.esrCode))
  }, [currentStationTitle, routeStations, setCurrentTrain])

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

      if (
        segment.mcd_route_id &&
        routeGroup(segment.mcd_route_id) !== routeGroup(currentStation.routeId)
      ) {
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
    const interval = setInterval(() => {
      void fetchForToday({ force: true })
    }, 30_000)

    return () => {
      clearInterval(interval)
    }
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

    if (shouldSyncThreadRoute || shouldSyncDelay) {
      setCurrentTrain(updated)
    }
  }, [currentTrain, currentTrainKey, trains, setCurrentTrain])

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
              const isSelectedRoute = selectedTrainRouteOverlay?.routeId === routeDefinition.id
              const upcomingRoute = isSelectedRoute ? selectedTrainRouteOverlay?.upcomingRoute : null
              const passedRoute = isSelectedRoute ? selectedTrainRouteOverlay?.passedRoute : null
              const overlayKeySuffix = currentTrainKey ?? "no-train"

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
                    key={`${routeDefinition.id}-upcoming-progress-${overlayKeySuffix}`}
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
                    key={`${routeDefinition.id}-passed-progress-${overlayKeySuffix}`}
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
                setCurrentStationTitle(station.title)
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
          const trainKey = trainInstanceKey(train)
          const routeId = train.mcd_route_id ?? "mcd2"
          const routeData = routeDataById[routeId] ?? null
          const snapped = snapToRoute([train.longitude, train.latitude], routeData)
          const [lon, lat] = snapped.point
          const heading = resolveTrainHeading(train, snapped)
          const isSelected = currentTrainKey === trainKey
          const selectedColor = ROUTE_COLOR_BY_ID[routeId]
          const delayDetails = getTrainDelayLabels(train)

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
      </MapContainer>
    </div>
  )
}
