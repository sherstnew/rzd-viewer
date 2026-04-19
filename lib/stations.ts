import stationsData from "@/jsons/stations.json"

export type Station = {
  title: string
  longitude: number
  latitude: number
}

const TARGET_STATION_TITLES = [
  "Нахабино",
  "Силикатная",
  "Подольск",
  "Щербинка",
  "Остафьево",
  "Марьина Роща",
] as const

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function toStation(value: unknown): Station | null {
  if (!value || typeof value !== "object") {
    return null
  }

  const station = value as Record<string, unknown>
  if (typeof station.title !== "string") {
    return null
  }

  const longitude = toNumber(station.longitude)
  const latitude = toNumber(station.latitude)

  if (longitude === null || latitude === null) {
    return null
  }

  return {
    title: station.title,
    longitude,
    latitude,
  }
}

const allStations: Station[] = Array.isArray(stationsData)
  ? stationsData.map(toStation).filter((station): station is Station => station !== null)
  : []

const stationByTitle = new Map(allStations.map((station) => [station.title, station]))

export const ROUTE_STATIONS: Station[] = TARGET_STATION_TITLES.map((title) => {
  const station = stationByTitle.get(title)
  if (!station) {
    throw new Error(`Станция "${title}" не найдена в stations.json`)
  }
  return station
})

export function findStationByTitle(title: string): Station | undefined {
  return ROUTE_STATIONS.find((station) => station.title === title)
}
