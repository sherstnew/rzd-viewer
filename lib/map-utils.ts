import type { FeatureCollection, LineString } from "geojson"

import { formatTrainDelay } from "@/lib/train-delays"
import type { Train } from "@/lib/trains"

export type RouteGeoJson = FeatureCollection<LineString, { name: string }>
export type LonLat = [number, number]

export type RouteId =
  | "mcd1"
  | "mcd2"
  | "mcd3"
  | "mcd4"
  | "mcd5_south"
  | "mcd5_north"
  | "mcd5_korolev"

export type StationCoordinates = {
  longitude: number
  latitude: number
}

export type StationCandidate = {
  code: string
  title: string
  longitude: number
  latitude: number
  direction: string | null
  esrCode: string | null
}

export type RouteStation = {
  routeId: RouteId
  code: string
  title: string
  longitude: number
  latitude: number
  direction: string | null
  esrCode: string | null
}

export type RouteDataById = Partial<Record<RouteId, RouteGeoJson>>

export type StationScheduleItem = {
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

type NearestProjection = {
  point: LonLat
  distanceSq: number
  segmentIndex: number
  t: number
  segmentStart: LonLat
  segmentEnd: LonLat
  headingDeg: number
}

const STATION_SCHEDULE_WINDOW_MS = 60 * 60 * 1000

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

export function buildStationIndexes(stationsData: unknown): {
  stationCoordinatesByCode: Map<string, StationCoordinates>
  stationCoordinatesByTitle: Map<string, StationCoordinates>
  stationCandidates: StationCandidate[]
} {
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

  return {
    stationCoordinatesByCode,
    stationCoordinatesByTitle,
    stationCandidates,
  }
}

export function distanceSq(a: LonLat, b: LonLat): number {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy
}

export function nearestCoordinateIndex(target: LonLat, coordinates: LonLat[]): number {
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

export function coordinateIndexValueFromProjection(projection: {
  segmentIndex: number
  t: number
}): number {
  return projection.segmentIndex + projection.t
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

export function findNearestProjection(
  point: LonLat,
  routeData: RouteGeoJson | null,
): NearestProjection | null {
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

export function buildStationSchedule(
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
