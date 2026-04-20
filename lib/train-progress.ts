type Nullable<T> = T | null

type TrainProgressStop = {
  arrival: Nullable<string>
  departure: Nullable<string>
}

export type TrainProgressMode = "at_station" | "between_stations" | "unknown"

export type TrainProgressState = {
  mode: TrainProgressMode
  startIndex: number
  endIndex: number
  ratioWithinLeg: number
}

function toTimestamp(value: Nullable<string>): number | null {
  if (!value) {
    return null
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }

  if (value < 0) {
    return 0
  }

  if (value > 1) {
    return 1
  }

  return value
}

export function resolveTrainProgressByStops(
  nowTimestamp: number,
  stops: TrainProgressStop[],
): TrainProgressState {
  const lastStopIndex = Math.max(0, stops.length - 1)
  const fallback: TrainProgressState = {
    mode: "unknown",
    startIndex: 0,
    endIndex: Math.min(1, lastStopIndex),
    ratioWithinLeg: 0,
  }

  if (stops.length < 2) {
    return fallback
  }

  for (let i = 0; i < stops.length; i += 1) {
    const stop = stops[i]
    const stationArrival = toTimestamp(stop.arrival)
    const stationDeparture = toTimestamp(stop.departure)

    if (
      stationArrival !== null &&
      stationDeparture !== null &&
      stationArrival <= nowTimestamp &&
      nowTimestamp <= stationDeparture
    ) {
      return {
        mode: "at_station",
        startIndex: i,
        endIndex: Math.min(i + 1, lastStopIndex),
        ratioWithinLeg: 0,
      }
    }
  }

  for (let i = 0; i < stops.length - 1; i += 1) {
    const start = stops[i]
    const end = stops[i + 1]
    const startTime = toTimestamp(start.departure) ?? toTimestamp(start.arrival)
    const endTime = toTimestamp(end.arrival) ?? toTimestamp(end.departure)

    if (startTime === null || endTime === null || endTime <= startTime) {
      continue
    }

    if (startTime <= nowTimestamp && nowTimestamp <= endTime) {
      return {
        mode: "between_stations",
        startIndex: i,
        endIndex: i + 1,
        ratioWithinLeg: clampRatio((nowTimestamp - startTime) / (endTime - startTime)),
      }
    }
  }

  return fallback
}
