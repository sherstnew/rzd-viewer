"use client"

import { useEffect, useMemo, useState } from "react"
import type { FeatureCollection, GeoJsonObject, LineString } from "geojson"
import L from "leaflet"
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
  Marker,
} from "react-leaflet"
import { useTheme } from "next-themes"
import { createRouteEngine } from "@/lib/route-engine"
import { findStationByTitle } from "@/lib/stations"
import { findTrains, TrainWithCoordinates } from "@/lib/trains"
import stationsData from "@/jsons/stations.json"
import { TrainSidebar } from "./train-sidebar"
import { useCurrentTrainStore } from "@/stores/currentTrainStore"
import { getDate } from "@/lib/utils"
import { useTrainsStore } from "@/stores/trainsStore"

const moscowCenter: [number, number] = [55.7558, 37.6173]

type RouteGeoJson = FeatureCollection<LineString, { name: string }>

type LonLat = [number, number]

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

type RouteStation = {
  code: string
  title: string
  longitude: number
  latitude: number
}

const TRAIN_ICON_SIZE_PX = 30
const TRAIN_ICON_MIN_SIZE_PX = 20
const TRAIN_ICON_MAX_SIZE_PX = 54
const STATION_LABEL_ZOOM_THRESHOLD = 13
const TERMINAL_PLATFORM_HIDE_RADIUS_DEG = 0.0025
const VIDEO_SECTION_START_TITLE = "Красный Строитель"
const VIDEO_SECTION_END_TITLE = "Подольск"

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

const stationCoordinatesByCode = new Map<string, StationCoordinates>(
  Array.isArray(stationsData)
    ? stationsData.flatMap((station): Array<[string, StationCoordinates]> => {
        const stationRecord = station as Record<string, unknown>
        const codes = stationRecord.codes as { yandex_code?: unknown } | undefined
        const code = typeof codes?.yandex_code === "string" ? codes.yandex_code : null
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

function createTrainIcon(iconSrc: string, headingDeg: number, sizePx: number): L.DivIcon {
  const correctedHeading = (headingDeg + 180) % 360

  return L.divIcon({
    className: "train-marker-wrapper",
    iconSize: [sizePx, sizePx],
    iconAnchor: [sizePx / 2, sizePx / 2],
    html: `<img src="${iconSrc}" alt="Train" style="width:${sizePx}px;height:${sizePx}px;transform:rotate(${correctedHeading}deg);transform-origin:center center;object-fit:contain;" />`,
  })
}

function trainIconSizeByZoom(zoom: number): number {
  const baselineZoom = 10
  const size = TRAIN_ICON_SIZE_PX + (zoom - baselineZoom) * 2.4
  return Math.round(Math.min(TRAIN_ICON_MAX_SIZE_PX, Math.max(TRAIN_ICON_MIN_SIZE_PX, size)))
}

function trainIconSrc(train: TrainWithCoordinates): string {
  const subtypeTitle = train.thread.transport_subtype?.title?.toLowerCase() ?? ""

  if (subtypeTitle.includes("иволга")) {
    return "/leaflet/ivolga.svg"
  }

  if (subtypeTitle.includes("стандарт плюс")) {
    return "/leaflet/standart.svg"
  }

  return "/leaflet/standart.svg"
}

function snapToRoute(point: LonLat, routeData: RouteGeoJson | null): SnappedPoint {
  if (!routeData || routeData.features.length === 0) {
    return { point, headingDeg: 0, segmentStart: point, segmentEnd: point }
  }

  const coordinates = routeData.features[0]?.geometry.coordinates ?? []
  if (coordinates.length < 2) {
    return { point, headingDeg: 0, segmentStart: point, segmentEnd: point }
  }

  let best = point
  let bestDist = Number.POSITIVE_INFINITY
  let bestHeading = 0
  let bestStart: LonLat = point
  let bestEnd: LonLat = point

  for (let i = 0; i < coordinates.length - 1; i += 1) {
    const a: LonLat = [coordinates[i][0], coordinates[i][1]]
    const b: LonLat = [coordinates[i + 1][0], coordinates[i + 1][1]]
    const projected = projectPointToSegment(point, a, b)
    const d = distanceSq(point, projected)

    if (d < bestDist) {
      bestDist = d
      best = projected
      bestHeading = headingFromSegment(a, b)
      bestStart = a
      bestEnd = b
    }
  }

  return { point: best, headingDeg: bestHeading, segmentStart: bestStart, segmentEnd: bestEnd }
}

function resolveTrainHeading(train: TrainWithCoordinates, snapped: SnappedPoint): number {
  const routeDx = snapped.segmentEnd[0] - snapped.segmentStart[0]
  const routeDy = snapped.segmentEnd[1] - snapped.segmentStart[1]
  const startCoordinates = stationCoordinatesByCode.get(train.departure_station.station.code)
  const endCoordinates = stationCoordinatesByCode.get(train.arrival_station.station.code)

  const isDwellingAtStation = train.departure_station.station.code === train.arrival_station.station.code
  const trainDx = isDwellingAtStation
    ? train.to.code === "s9600731"
      ? routeDx
      : -routeDx
    : (endCoordinates?.longitude ?? 0) - (startCoordinates?.longitude ?? 0)
  const trainDy = isDwellingAtStation
    ? train.to.code === "s9600731"
      ? routeDy
      : -routeDy
    : (endCoordinates?.latitude ?? 0) - (startCoordinates?.latitude ?? 0)

  const dot = routeDx * trainDx + routeDy * trainDy
  if (dot < 0) {
    return (snapped.headingDeg + 180) % 360
  }

  return snapped.headingDeg
}

function RouteBounds({ routeData }: { routeData: RouteGeoJson | null }) {
  const map = useMap()

  useEffect(() => {
    if (!routeData) {
      return
    }

    const bounds = L.geoJSON(routeData).getBounds()
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [24, 24] })
    }
  }, [map, routeData])

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

export function MapExample() {
  const [routeData, setRouteData] = useState<RouteGeoJson | null>(null)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [currentZoom, setCurrentZoom] = useState(10)
  const showPermanentStationLabels = currentZoom >= STATION_LABEL_ZOOM_THRESHOLD
  const trainIconSize = trainIconSizeByZoom(currentZoom)

  const [trains, setTrains] = useState<TrainWithCoordinates[]>([])
  const { setCurrentTrain } = useCurrentTrainStore()
  const { segments, fetchForToday, error: trainsError } = useTrainsStore()

  const { resolvedTheme } = useTheme()
  const tileTheme = resolvedTheme === "dark" ? "dark" : "light"
  const videoSectionRouteData = useMemo(() => buildVideoSectionRoute(routeData), [routeData])

  const routeStations = useMemo((): RouteStation[] => {
    const stops = trains[0]?.thread_route?.stops ?? []
    const seen = new Set<string>()
    const firstStopCode = stops[0]?.station.code
    const lastStopCode = stops[stops.length - 1]?.station.code
    const firstStopCoordinates = firstStopCode ? stationCoordinatesByCode.get(firstStopCode) : undefined
    const lastStopCoordinates = lastStopCode ? stationCoordinatesByCode.get(lastStopCode) : undefined

    function isNearTerminalPlatform(stop: (typeof stops)[number], coordinates: StationCoordinates) {
      if (stop.station.station_type !== "platform") {
        return false
      }

      const nearFirstTerminal =
        firstStopCoordinates &&
        distanceSq(
          [coordinates.longitude, coordinates.latitude],
          [firstStopCoordinates.longitude, firstStopCoordinates.latitude],
        ) <=
          TERMINAL_PLATFORM_HIDE_RADIUS_DEG * TERMINAL_PLATFORM_HIDE_RADIUS_DEG

      const nearLastTerminal =
        lastStopCoordinates &&
        distanceSq(
          [coordinates.longitude, coordinates.latitude],
          [lastStopCoordinates.longitude, lastStopCoordinates.latitude],
        ) <=
          TERMINAL_PLATFORM_HIDE_RADIUS_DEG * TERMINAL_PLATFORM_HIDE_RADIUS_DEG

      return Boolean(nearFirstTerminal || nearLastTerminal)
    }

    return stops.flatMap((stop): RouteStation[] => {
      const code = stop.station.code
      if (seen.has(code)) {
        return []
      }

      const coordinates = stationCoordinatesByCode.get(code)
      if (!coordinates) {
        return []
      }

      if (isNearTerminalPlatform(stop, coordinates)) {
        return []
      }

      seen.add(code)
      return [
        {
          code,
          title: stop.station.title,
          longitude: coordinates.longitude,
          latitude: coordinates.latitude,
        },
      ]
    })
  }, [trains])

  useEffect(() => {
    let isMounted = true

    async function loadNetwork() {
      const response = await fetch("/assets/moscow.geojson")
      if (!response.ok) {
        if (isMounted) {
          setRouteError("Не удалось загрузить железнодорожную сеть")
        }
        return
      }

      const data = (await response.json()) as GeoJsonObject
      if (isMounted) {
        try {
          const routeEngine = createRouteEngine(data)
          const startStation = findStationByTitle("Нахабино")
          const endStation = findStationByTitle("Подольск")

          if (!startStation || !endStation) {
            setRouteError("Не удалось найти стартовую или конечную станцию")
            return
          }

          const route = routeEngine.findRoute(
            [startStation.longitude, startStation.latitude],
            [endStation.longitude, endStation.latitude],
          )
          setRouteData(route)
        } catch (calculationError) {
          const message =
            calculationError instanceof Error
              ? calculationError.message
              : "Не удалось построить маршрут"
          setRouteError(message)
        }
      }
    }

    void loadNetwork()
    void fetchForToday()

    return () => {
      isMounted = false
    }
  }, [fetchForToday])

  useEffect(() => {
    setTrains(findTrains(getDate(), segments))

    const interval = setInterval(() => {
      setTrains(findTrains(getDate(), segments))
    }, 500)

    return () => {
      clearInterval(interval)
    }
  }, [segments])

  return (
    <div className="relative h-full space-y-4">
      {routeError ? <p className="text-sm text-destructive">{routeError}</p> : null}
      {trainsError ? <p className="text-sm text-destructive">{trainsError}</p> : null}
      <TrainSidebar />
      <MapContainer
        center={moscowCenter}
        zoom={10}
        className="rzd-map relative z-0 h-full w-full rounded-xl"
        scrollWheelZoom
      >
        <MapControlPositioner />
        <MapZoomWatcher onZoomChange={setCurrentZoom} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url={`https://{s}.basemaps.cartocdn.com/${tileTheme}_all/{z}/{x}/{y}{r}.png`}
        />
        {routeData ? (
          <>
            <GeoJSON
              data={routeData}
              style={{
                weight: 4,
                opacity: 1,
                color: "#d55384",
              }}
            />
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
            <RouteBounds routeData={routeData} />
          </>
        ) : null}
        {routeStations.map((station) => (
          <CircleMarker
            key={station.code}
            center={(() => {
              const snapped = snapToRoute([station.longitude, station.latitude], routeData)
              const [lon, lat] = snapped.point
              return [lat, lon] as [number, number]
            })()}
            radius={3}
            pathOptions={{
              color: "#d55384",
              fillColor: "#d55384",
              fillOpacity: 1,
              weight: 1,
            }}
          >
            <Tooltip
              key={`${station.code}-${showPermanentStationLabels ? "permanent" : "hover"}`}
              direction="top"
              offset={[0, -6]}
              opacity={1}
              permanent={showPermanentStationLabels}
            >
              {station.title}
            </Tooltip>
          </CircleMarker>
        ))}
        {trains.map((train) => (
          (() => {
            const snapped = snapToRoute([train.longitude, train.latitude], routeData)
            const [lon, lat] = snapped.point
            const heading = resolveTrainHeading(train, snapped)

            return (
              <Marker
                position={[lat, lon]}
                icon={createTrainIcon(trainIconSrc(train), heading, trainIconSize)}
                key={train.thread.uid}
                eventHandlers={{
                  click: () => setCurrentTrain(train),
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
          })()
        ))}
      </MapContainer>
    </div>
  )
}
