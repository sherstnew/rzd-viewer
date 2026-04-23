import type { FeatureCollection, LineString } from "geojson"

export type Nullable<T> = T | null
export type LonLat = [number, number]

export type LongDistanceTrainObject = {
  id: string
  uid: string
  date: string | null
  number: string
  longitude: number
  latitude: number
  timestamp: number | null
  expires: number | null
}

export type LongDistanceStation = {
  id: string
  name: string
  railwayId: number | null
  esrCode: number | null
  stationType: string | null
  traversed: boolean
  coordinates: LonLat
  arrivalDate: string | null
  arrivalTime: string | null
  departureDate: string | null
  departureTime: string | null
  arrivalDelayMinutes: number | null
  departureDelayMinutes: number | null
  isInsideRussia: boolean
}

export type LongDistanceRoute = {
  type: "FeatureCollection"
  number: string
  requestedNumber: string
  departureDate: string
  departureDateTime: string | null
  path: string
  origin: string | null
  destination: string | null
  currentDelayMinutes: number | null
  trainOnRoutePosition: string | null
  delayLabel: string
  directionLabel: string
  stations: LongDistanceStation[]
  isInsideRussiaOnly: boolean
  outsideRussiaStations: string[]
  routeGeoJson: FeatureCollection<LineString, { name: string }>
  info: Record<string, unknown>
}

export type YandexLiveObjectsPayload = {
  objects?: Record<string, unknown>
  timestamp?: unknown
  expires?: unknown
  info?: unknown
}

type RzdRouteFeature = {
  id?: unknown
  properties?: Record<string, unknown>
  geometry?: {
    type?: unknown
    coordinates?: unknown
  }
}

type RzdRoutePayload = {
  type?: unknown
  features?: RzdRouteFeature[]
  info?: Record<string, unknown>
}
type RussiaGeoJsonGeometry = {
  type?: unknown
  coordinates?: unknown
}
type RussiaGeoJsonFeature = {
  type?: unknown
  geometry?: RussiaGeoJsonGeometry | null
}
export type RussiaRegionsGeoJson = {
  type?: unknown
  features?: RussiaGeoJsonFeature[]
}
type RussiaPolygon = LonLat[][]
type RussiaIndexedPolygon = {
  polygon: RussiaPolygon
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}
export type RussiaGeoFilter = (longitude: number, latitude: number) => boolean

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/
const TIME_ONLY_REGEX = /^\d{2}:\d{2}:\d{2}$/
const RUSSIA_APPROX_BOUNDS: ReadonlyArray<{
  minLon: number
  minLat: number
  maxLon: number
  maxLat: number
}> = [
  { minLon: 19.5, minLat: 54.2, maxLon: 22.9, maxLat: 55.4 },
  { minLon: 27, minLat: 51, maxLon: 47.5, maxLat: 70 },
  { minLon: 36, minLat: 43, maxLon: 48, maxLat: 57 },
  { minLon: 39, minLat: 41, maxLon: 47.5, maxLat: 48.6 },
  { minLon: 47, minLat: 45.2, maxLon: 49.5, maxLat: 48.7 },
  { minLon: 47, minLat: 50, maxLon: 66, maxLat: 68 },
  { minLon: 66, minLat: 54, maxLon: 76, maxLat: 73 },
  { minLon: 76, minLat: 49, maxLon: 110, maxLat: 75 },
  { minLon: 108, minLat: 42, maxLon: 146, maxLat: 72 },
  { minLon: 141, minLat: 43, maxLon: 157, maxLat: 55 },
  { minLon: 157, minLat: 50, maxLon: 190, maxLat: 72 },
]

export function isLongDistancePointInRussia(longitude: number, latitude: number): boolean {
  return RUSSIA_APPROX_BOUNDS.some(
    (bounds) =>
      longitude >= bounds.minLon &&
      longitude <= bounds.maxLon &&
      latitude >= bounds.minLat &&
      latitude <= bounds.maxLat,
  )
}

function isLonLat(value: unknown): value is LonLat {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    Number.isFinite(value[0]) &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  )
}

function normalizeRing(value: unknown): LonLat[] | null {
  if (!Array.isArray(value)) {
    return null
  }

  const ring = value.filter(isLonLat)
  return ring.length >= 4 ? ring : null
}

function normalizePolygon(value: unknown): RussiaPolygon | null {
  if (!Array.isArray(value)) {
    return null
  }

  const rings = value.flatMap((ring): LonLat[][] => {
    const normalizedRing = normalizeRing(ring)
    return normalizedRing ? [normalizedRing] : []
  })

  return rings.length > 0 ? rings : null
}

function geometryToPolygons(geometry: RussiaGeoJsonGeometry | null | undefined): RussiaPolygon[] {
  if (!geometry) {
    return []
  }

  if (geometry.type === "Polygon") {
    const polygon = normalizePolygon(geometry.coordinates)
    return polygon ? [polygon] : []
  }

  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.flatMap((polygon): RussiaPolygon[] => {
      const normalizedPolygon = normalizePolygon(polygon)
      return normalizedPolygon ? [normalizedPolygon] : []
    })
  }

  return []
}

function polygonBounds(polygon: RussiaPolygon): Omit<RussiaIndexedPolygon, "polygon"> | null {
  let minLon = Number.POSITIVE_INFINITY
  let minLat = Number.POSITIVE_INFINITY
  let maxLon = Number.NEGATIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY

  for (const ring of polygon) {
    for (const [longitude, latitude] of ring) {
      minLon = Math.min(minLon, longitude)
      minLat = Math.min(minLat, latitude)
      maxLon = Math.max(maxLon, longitude)
      maxLat = Math.max(maxLat, latitude)
    }
  }

  if (
    !Number.isFinite(minLon) ||
    !Number.isFinite(minLat) ||
    !Number.isFinite(maxLon) ||
    !Number.isFinite(maxLat)
  ) {
    return null
  }

  return { minLon, minLat, maxLon, maxLat }
}

function isPointInRing(longitude: number, latitude: number, ring: LonLat[]): boolean {
  let inside = false

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersects =
      (yi > latitude) !== (yj > latitude) &&
      longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function isPointInPolygon(longitude: number, latitude: number, polygon: RussiaPolygon): boolean {
  const [outerRing, ...holes] = polygon
  if (!outerRing || !isPointInRing(longitude, latitude, outerRing)) {
    return false
  }

  return !holes.some((hole) => isPointInRing(longitude, latitude, hole))
}

export function createRussiaGeoFilter(geoJson: RussiaRegionsGeoJson): RussiaGeoFilter {
  const indexedPolygons = (geoJson.features ?? []).flatMap((feature): RussiaIndexedPolygon[] =>
    geometryToPolygons(feature.geometry).flatMap((polygon): RussiaIndexedPolygon[] => {
      const bounds = polygonBounds(polygon)
      return bounds ? [{ polygon, ...bounds }] : []
    }),
  )

  if (indexedPolygons.length === 0) {
    return isLongDistancePointInRussia
  }

  return (longitude, latitude) =>
    indexedPolygons.some(
      ({ polygon, minLon, minLat, maxLon, maxLat }) =>
        longitude >= minLon &&
        longitude <= maxLon &&
        latitude >= minLat &&
        latitude <= maxLat &&
        isPointInPolygon(longitude, latitude, polygon),
    )
}

function toStringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function toBooleanValue(value: unknown): boolean {
  return typeof value === "boolean" ? value : false
}

function toRouteDate(value: unknown): string | null {
  const date = toStringValue(value)
  return date && DATE_ONLY_REGEX.test(date) ? date : null
}

function toRouteTime(value: unknown): string | null {
  const time = toStringValue(value)
  return time && TIME_ONLY_REGEX.test(time) ? time : null
}

function normalizeCoordinates(value: unknown): LonLat | null {
  if (!Array.isArray(value) || value.length < 2) {
    return null
  }

  const longitude = toFiniteNumber(value[0])
  const latitude = toFiniteNumber(value[1])
  if (longitude === null || latitude === null) {
    return null
  }

  return [longitude, latitude]
}

function buildDelayLabel(minutes: number | null): string {
  if (minutes === null) {
    return "по расписанию"
  }

  if (minutes === 0) {
    return "по расписанию"
  }

  return `задержка ${minutes} мин`
}

function buildDirectionLabel(path: string | null, origin: string | null, destination: string | null): string {
  if (path) {
    return path
  }

  if (origin && destination) {
    return `${origin} → ${destination}`
  }

  return "направление неизвестно"
}

function formatObjectDate(value: string): string | null {
  if (!/^\d{8}$/.test(value)) {
    return null
  }

  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

function parseObjectKey(id: string): { uid: string; date: string | null; number: string } | null {
  const match = id.match(/^(.+)-(\d{8})$/)
  if (!match) {
    return null
  }

  const uid = match[1]
  return {
    uid,
    date: formatObjectDate(match[2]),
    number: uid.split("_")[0] || uid,
  }
}

export function normalizeLongDistanceLiveObjects(
  payload: YandexLiveObjectsPayload,
): LongDistanceTrainObject[] {
  const timestamp = typeof payload.timestamp === "number" && Number.isFinite(payload.timestamp) ? payload.timestamp : null
  const expires = typeof payload.expires === "number" && Number.isFinite(payload.expires) ? payload.expires : null
  const objects = payload.objects

  if (!objects || typeof objects !== "object") {
    return []
  }

  return Object.entries(objects).flatMap(([id, value]): LongDistanceTrainObject[] => {
    if (!Array.isArray(value) || value[0] !== 0 || !Array.isArray(value[1])) {
      return []
    }

    const parsedKey = parseObjectKey(id)
    const firstPoint = value[1][0]
    if (!parsedKey || !Array.isArray(firstPoint)) {
      return []
    }

    const longitude = toFiniteNumber(firstPoint[1])
    const latitude = toFiniteNumber(firstPoint[2])
    if (longitude === null || latitude === null) {
      return []
    }

    return [
      {
        id,
        uid: parsedKey.uid,
        date: parsedKey.date,
        number: parsedKey.number,
        longitude,
        latitude,
        timestamp,
        expires,
      },
    ]
  })
}

function stationFromFeature(
  feature: RzdRouteFeature,
  isPointInRussia: RussiaGeoFilter,
): LongDistanceStation | null {
  const properties = feature.properties ?? {}
  const coordinates = normalizeCoordinates(feature.geometry?.coordinates)
  const name = toStringValue(properties.name)

  if (!coordinates || !name) {
    return null
  }

  return {
    id: toStringValue(feature.id) ?? `${name}-${coordinates.join(",")}`,
    name,
    railwayId: toFiniteNumber(properties.railwayId),
    esrCode: toFiniteNumber(properties.esr_code),
    stationType: toStringValue(properties.stationType),
    traversed: toBooleanValue(properties.traversed),
    coordinates,
    arrivalDate: toRouteDate(properties.arrivalDate),
    arrivalTime: toRouteTime(properties.arrivalTime),
    departureDate: toRouteDate(properties.departureDate),
    departureTime: toRouteTime(properties.departureTime),
    arrivalDelayMinutes: toFiniteNumber(properties.arrivalDelayMinutes),
    departureDelayMinutes: toFiniteNumber(properties.departureDelayMinutes),
    isInsideRussia: isPointInRussia(coordinates[0], coordinates[1]),
  }
}

function buildRouteGeoJson(
  stations: LongDistanceStation[],
  name: string,
): FeatureCollection<LineString, { name: string }> {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name },
        geometry: {
          type: "LineString",
          coordinates: stations.map((station) => station.coordinates),
        },
      },
    ],
  }
}

export function normalizeLongDistanceRoutePayload(
  payload: RzdRoutePayload,
  requestedNumber: string,
  departureDate: string,
  isPointInRussia: RussiaGeoFilter = isLongDistancePointInRussia,
): LongDistanceRoute {
  const info = payload.info ?? {}
  const stations = Array.isArray(payload.features)
    ? payload.features.flatMap((feature): LongDistanceStation[] => {
        const station = stationFromFeature(feature, isPointInRussia)
        return station ? [station] : []
      })
    : []

  const origin = stations[0]?.name ?? null
  const destination = stations[stations.length - 1]?.name ?? null
  const number = toStringValue(info.number) ?? requestedNumber
  const path = buildDirectionLabel(toStringValue(info.path), origin, destination)
  const position = toStringValue(info.trainOnRoutePosition)
  const currentDelayMinutes = toFiniteNumber(info.currentDelayMinutes)
  const outsideRussiaStations = stations
    .filter((station) => !station.isInsideRussia)
    .map((station) => station.name)

  return {
    type: "FeatureCollection",
    number,
    requestedNumber,
    departureDate,
    departureDateTime: toStringValue(info.dateTimeDepatrure),
    path,
    origin,
    destination,
    currentDelayMinutes,
    trainOnRoutePosition: position,
    delayLabel: buildDelayLabel(currentDelayMinutes),
    directionLabel: path,
    stations,
    isInsideRussiaOnly: outsideRussiaStations.length === 0,
    outsideRussiaStations,
    routeGeoJson: buildRouteGeoJson(stations, path),
    info,
  }
}

export function formatLongDistanceDate(value: string | null): string {
  if (!value) {
    return ""
  }

  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) {
    return value
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

export function formatLongDistanceTime(date: string | null, time: string | null): string {
  if (!time) {
    return ""
  }

  const shortTime = time.slice(0, 5)
  const dateLabel = formatLongDistanceDate(date)
  return dateLabel ? `${shortTime}, ${dateLabel}` : shortTime
}

export function longDistanceTrainKey(train: Pick<LongDistanceTrainObject, "id" | "date">): string {
  return `${train.id}__${train.date ?? "no-date"}`
}

const RZD_ROUTE_NUMBER_SUFFIXES: Record<string, string> = {
  SHHJ: "SZ",
  YE: "EI",
  YA: "JA",
  QI: "YJ",
  ZH: "JI",
  Ж: "JI",
  A: "AJ",
  S: "SJ",
  U: "UJ",
}
const RZD_ROUTE_NUMBER_SINGLE_CONSONANTS = new Set([
  "B",
  "C",
  "D",
  "F",
  "G",
  "H",
  "K",
  "L",
  "M",
  "N",
  "P",
  "R",
  "S",
  "T",
  "V",
  "X",
  "Z",
])
const RZD_ROUTE_NUMBER_STABLE_DIGRAPHS = ["ZH", "CH", "SH", "SHCH"]

export function normalizeLongDistanceRouteRequestNumber(number: string): string {
  const trimmed = number.trim().toUpperCase()
  const suffixes = Object.entries(RZD_ROUTE_NUMBER_SUFFIXES).sort(
    ([left], [right]) => right.length - left.length,
  )

  for (const [sourceSuffix, rzdSuffix] of suffixes) {
    if (trimmed.endsWith(rzdSuffix)) {
      return trimmed
    }

    if (trimmed.endsWith(sourceSuffix)) {
      return `${trimmed.slice(0, -sourceSuffix.length)}${rzdSuffix}`
    }
  }

  if (RZD_ROUTE_NUMBER_STABLE_DIGRAPHS.some((suffix) => trimmed.endsWith(suffix))) {
    return trimmed
  }

  if (trimmed.endsWith("J")) {
    const beforeJ = trimmed.at(-2)
    if (beforeJ && RZD_ROUTE_NUMBER_SINGLE_CONSONANTS.has(beforeJ)) {
      return trimmed
    }

    return `${trimmed}I`
  }

  const lastLetter = trimmed.at(-1)
  if (lastLetter && RZD_ROUTE_NUMBER_SINGLE_CONSONANTS.has(lastLetter)) {
    return `${trimmed}J`
  }

  return trimmed
}

