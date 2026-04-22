import type { Train, TrainDelayEvent } from "@/lib/trains"

type DelayKind = "departure" | "arrival"

function formatMinutes(value: number): string {
  const absValue = Math.abs(value)
  const lastTwoDigits = absValue % 100

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return `${value} минут`
  }

  const lastDigit = absValue % 10
  if (lastDigit === 1) {
    return `${value} минута`
  }

  if (lastDigit >= 2 && lastDigit <= 4) {
    return `${value} минуты`
  }

  return `${value} минут`
}

function numericMinutes(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function maxDelayMinutes(event: TrainDelayEvent | null | undefined): number | null {
  if (!event) {
    return null
  }

  const values = [
    numericMinutes(event.minutesFromNew),
    numericMinutes(event.minutesToNew),
    numericMinutes(event.minutesFrom),
    numericMinutes(event.minutesTo),
  ].filter((value): value is number => value !== null)

  if (values.length === 0) {
    return null
  }

  return Math.max(...values)
}

export function formatDelayEvent(event: TrainDelayEvent | null | undefined): string | null {
  if (!event) {
    return null
  }

  const minutes = maxDelayMinutes(event)

  if (event.type === "possible_delay") {
    if (minutes === null || minutes <= 0) {
      return "возможное опоздание"
    }

    return `возможное опоздание до ${formatMinutes(minutes)}`
  }

  if (minutes === null || minutes <= 0) {
    return null
  }

  return `опоздание ${formatMinutes(minutes)}`
}

export function formatTrainDelay(train: Train, kind?: DelayKind): string | null {
  if (kind === "departure") {
    return formatDelayEvent(train.departure_event)
  }

  if (kind === "arrival") {
    return formatDelayEvent(train.arrival_event)
  }

  return formatDelayEvent(train.departure_event) ?? formatDelayEvent(train.arrival_event)
}

export function formatTrainDelayDetails(train: Train): string | null {
  const details = getTrainDelayLabels(train)

  return details.length > 0 ? details.join(", ") : null
}

export function getTrainDelayLabels(train: Train): string[] {
  const details: string[] = []
  const departure = formatTrainDelay(train, "departure")
  const arrival = formatTrainDelay(train, "arrival")

  if (departure) {
    details.push(departure)
  }

  if (arrival) {
    details.push(arrival)
  }

  return details
}
