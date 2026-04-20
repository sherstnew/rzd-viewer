import stationsData from "@/jsons/stations.json"

type Nullable<T> = T | null

interface CarrierCodes {
  sirena: Nullable<string>
  iata: Nullable<string>
  icao: Nullable<string>
}

interface Carrier {
  code: number
  title: string
  codes: CarrierCodes
  address?: string
  url?: string
  email?: string
  contacts?: string
  phone?: string
  logo?: string
  logo_svg?: Nullable<string>
  offices?: unknown[]
}

interface TransportSubtype {
  title: string
  code: string
  color: string
}

interface Station {
  type: string
  title: string
  short_title: Nullable<string>
  popular_title: Nullable<string>
  code: string
  station_type: string
  station_type_name: string
  transport_type: string
}

interface Stop {
  station: Station
  departure: Nullable<string>
  arrival: Nullable<string>
  duration: number
  stop_time: Nullable<number>
  platform: Nullable<string>
  terminal: Nullable<string>
}

interface Thread {
  number: string
  title: string
  short_title: string
  express_type: Nullable<string>
  transport_type: string
  carrier: Carrier
  uid: string
  vehicle: Nullable<string>
  transport_subtype: Nullable<TransportSubtype>
  thread_method_link?: string
  days?: string
  except_days?: string
  stops?: Stop[]
}

export interface Train {
  thread: Thread
  stops: string
  from: Station
  to: Station
  departure_platform: Nullable<string>
  arrival_platform: Nullable<string>
  departure_terminal: Nullable<string>
  arrival_terminal: Nullable<string>
  duration: number
  has_transfers: boolean
  tickets_info: Nullable<unknown>
  departure: string
  arrival: string
  start_date: string
  thread_route: Nullable<Thread>
  thread_error?: Nullable<{
    status_code: Nullable<number>
    message: string
  }>
}

type TrainsData = Train[]

export interface TrainRoutePoint {
  station: Station
  departure: Nullable<string>
  arrival: Nullable<string>
}

export type TrainWithCoordinates = Train & {
  longitude: number
  latitude: number
  departure_station: TrainRoutePoint
  arrival_station: TrainRoutePoint
}

type StationCoordinates = {
  longitude: number
  latitude: number
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

export function findTrains(time: Date, trainsData: TrainsData): TrainWithCoordinates[] {
  const currentTimeMs = time.getTime()

  function toTimeMs(value: Nullable<string>): number | null {
    if (!value) {
      return null
    }
    const parsed = new Date(value).getTime()
    return Number.isFinite(parsed) ? parsed : null
  }

  function toRoutePoint(stop: Stop): TrainRoutePoint {
    return {
      station: stop.station,
      departure: stop.departure,
      arrival: stop.arrival,
    }
  }

  const trains = trainsData.filter(
    (train) =>
      new Date(train.departure).getTime() <= currentTimeMs &&
      currentTimeMs <= new Date(train.arrival).getTime(),
  )

  return trains.flatMap((train): TrainWithCoordinates[] => {
    const stops = train.thread_route?.stops ?? []

    // If the train is currently dwelling at a station (arrival..departure),
    // keep it visible at that station coordinates.
    for (let i = 0; i < stops.length; i += 1) {
      const stop = stops[i]
      const stationArrivalTime = toTimeMs(stop.arrival)
      const stationDepartureTime = toTimeMs(stop.departure)

      if (
        stationArrivalTime !== null &&
        stationDepartureTime !== null &&
        stationArrivalTime <= currentTimeMs &&
        currentTimeMs <= stationDepartureTime
      ) {
        const stationCoordinates = stationCoordinatesByCode.get(stop.station.code)
        if (!stationCoordinates) {
          return []
        }

        return [
          {
            ...train,
            longitude: stationCoordinates.longitude,
            latitude: stationCoordinates.latitude,
            departure_station: toRoutePoint(stop),
            arrival_station: toRoutePoint(stops[i + 1] ?? stop),
          },
        ]
      }
    }

    let segmentStart: Stop | undefined
    let segmentEnd: Stop | undefined

    for (let i = 0; i < stops.length - 1; i += 1) {
      const start = stops[i]
      const end = stops[i + 1]

      const startTime = toTimeMs(start.departure) ?? toTimeMs(start.arrival)
      const endTime = toTimeMs(end.arrival) ?? toTimeMs(end.departure)

      if (startTime === null || endTime === null) {
        continue
      }

      if (startTime <= currentTimeMs && currentTimeMs <= endTime) {
        segmentStart = start
        segmentEnd = end
        break
      }
    }

    if (!segmentStart || !segmentEnd) {
      return []
    }

    const depTime = toTimeMs(segmentStart.departure) ?? toTimeMs(segmentStart.arrival)
    const arrTime = toTimeMs(segmentEnd.arrival) ?? toTimeMs(segmentEnd.departure)

    if (depTime === null || arrTime === null) {
      return []
    }

    const per = ((currentTimeMs - depTime) / (arrTime - depTime)) * 100

    if (!Number.isFinite(depTime) || !Number.isFinite(arrTime) || arrTime <= depTime) {
      return []
    }

    const departureCoordinates = stationCoordinatesByCode.get(segmentStart.station.code)
    const arrivalCoordinates = stationCoordinatesByCode.get(segmentEnd.station.code)
    if (!departureCoordinates || !arrivalCoordinates) {
      return []
    }

    const ratio = Math.min(1, Math.max(0, per / 100))
    const longitude =
      departureCoordinates.longitude +
      (arrivalCoordinates.longitude - departureCoordinates.longitude) * ratio
    const latitude =
      departureCoordinates.latitude +
      (arrivalCoordinates.latitude - departureCoordinates.latitude) * ratio

    return [
      {
        ...train,
        longitude,
        latitude,
        departure_station: toRoutePoint(segmentStart),
        arrival_station: toRoutePoint(segmentEnd),
      },
    ]
  })
}
