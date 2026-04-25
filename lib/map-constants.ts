import type { LonLat, RouteId } from "@/lib/map-utils"

export type RouteDefinition = {
  id: RouteId
  label: string
  color: string
  start?: LonLat
  end?: LonLat
}

export const MOSCOW_CENTER: [number, number] = [55.7558, 37.6173]

export const LONG_DISTANCE_TRAINS_CACHE_TTL_MS = 60_000
export const LONG_DISTANCE_TRAINS_DEBOUNCE_MS = 350
export const LONG_DISTANCE_VIEWPORT_PRECISION = 3
export const CLOCK_TICK_MS = 1_000
export const TRAIN_HEADING_BUCKET_DEG = 10

export const TRAIN_ICON_SIZE_PX = 25
export const TRAIN_ICON_MIN_SIZE_PX = 10
export const TRAIN_ICON_MAX_SIZE_PX = 54
export const STATION_MARKER_SIZE_PX = 3
export const STATION_MARKER_MIN_SIZE_PX = 2
export const STATION_MARKER_MAX_SIZE_PX = 7
export const STATION_LABEL_ZOOM_THRESHOLD = 13
export const ROUTE_STATION_DISTANCE_THRESHOLD = 0.00025

export const YANDEX_LIVE_OBJECTS_URL = "https://rasp.yandex.ru/maps/train/objects"
export const OPENRAILWAYMAP_ATTRIBUTION =
  '<a href="https://www.openstreetmap.org/copyright">� OpenStreetMap contributors</a>, Style: <a href="https://creativecommons.org/licenses/by-sa/2.0/">CC-BY-SA 2.0</a> <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a> and OpenStreetMap'

export const MCD1_ROUTE_COLOR = "#F6A500"
export const MCD2_ROUTE_COLOR = "#d55384"
export const MCD3_ROUTE_COLOR = "#E95B0C"
export const MCD4_ROUTE_COLOR = "#41B384"
export const MCD5_ROUTE_COLOR = "#77B729"

const PODOLSK_STATION_CODE = "s9600731"
const LOBNYA_STATION_CODE = "s9600781"
const IPPODROM_STATION_CODE = "s9601197"
const ZHELEZNODOROZHNAYA_STATION_CODE = "s9601675"
const DOMODEDOVO_STATION_CODE = "s9600811"
const PUSHKINO_STATION_CODE = "s9600701"
const BOLSHEVO_STATION_CODE = "s9602217"
const LYUBLINO_STATION_CODE = "s9601788"

export const VIDEO_SECTION_START_TITLE = "������� ���������"
export const VIDEO_SECTION_END_TITLE = "��������"

export const ROUTE_DEFINITIONS: RouteDefinition[] = [
  {
    id: "mcd1",
    label: "���-1",
    color: MCD1_ROUTE_COLOR,
    start: [37.28264496693386, 55.672407632018555],
    end: [37.484721474868444, 56.01327444797851],
  },
  {
    id: "mcd2",
    label: "���-2",
    color: MCD2_ROUTE_COLOR,
    start: [37.18482251289728, 55.841658030144124],
    end: [37.56539830422924, 55.43156562773968],
  },
  {
    id: "mcd3",
    label: "���-3",
    color: MCD3_ROUTE_COLOR,
    start: [37.173888, 55.980039],
    end: [38.23932639021258, 55.560367089788535],
  },
  {
    id: "mcd4",
    label: "���-4",
    color: MCD4_ROUTE_COLOR,
    start: [37.066874, 55.550152],
    end: [38.00832, 55.752306],
  },
  {
    id: "mcd5_south",
    label: "���-5",
    color: MCD5_ROUTE_COLOR,
    start: [37.640771, 55.729498],
    end: [37.773381, 55.4399],
  },
  {
    id: "mcd5_north",
    label: "���-5",
    color: MCD5_ROUTE_COLOR,
    start: [37.657484, 55.777685],
    end: [37.839165, 56.012485],
  },
  {
    id: "mcd5_korolev",
    label: "���-5",
    color: MCD5_ROUTE_COLOR,
    start: [37.761228, 55.914823],
    end: [37.861022, 55.926201],
  },
]

export const FORWARD_TERMINAL_BY_ROUTE: Record<RouteId, string> = {
  mcd1: LOBNYA_STATION_CODE,
  mcd2: PODOLSK_STATION_CODE,
  mcd3: IPPODROM_STATION_CODE,
  mcd4: ZHELEZNODOROZHNAYA_STATION_CODE,
  mcd5_south: DOMODEDOVO_STATION_CODE,
  mcd5_north: PUSHKINO_STATION_CODE,
  mcd5_korolev: BOLSHEVO_STATION_CODE,
}

export const ROUTE_COLOR_BY_ID: Record<RouteId, string> = {
  mcd1: MCD1_ROUTE_COLOR,
  mcd2: MCD2_ROUTE_COLOR,
  mcd3: MCD3_ROUTE_COLOR,
  mcd4: MCD4_ROUTE_COLOR,
  mcd5_south: MCD5_ROUTE_COLOR,
  mcd5_north: MCD5_ROUTE_COLOR,
  mcd5_korolev: MCD5_ROUTE_COLOR,
}

export const FORCED_STATION_CODES_BY_ROUTE: Partial<Record<RouteId, readonly string[]>> = {
  mcd2: [LYUBLINO_STATION_CODE],
}

export function trainIconSizeByZoom(zoom: number): number {
  const baselineZoom = 10
  const size = TRAIN_ICON_SIZE_PX + (zoom - baselineZoom) * 2.4
  return Math.round(Math.min(TRAIN_ICON_MAX_SIZE_PX, Math.max(TRAIN_ICON_MIN_SIZE_PX, size)))
}

export function stationMarkerRadiusByZoom(zoom: number): number {
  const baselineZoom = 10
  const size = STATION_MARKER_SIZE_PX + (zoom - baselineZoom) * 0.32
  return Math.min(STATION_MARKER_MAX_SIZE_PX, Math.max(STATION_MARKER_MIN_SIZE_PX, size))
}

export function bucketHeading(heading: number): number {
  return Math.round(heading / TRAIN_HEADING_BUCKET_DEG) * TRAIN_HEADING_BUCKET_DEG
}
