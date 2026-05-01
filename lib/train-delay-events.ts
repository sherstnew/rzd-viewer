import type { Train, TrainDelayEvent } from "@/lib/trains"

function numericMinutes(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

export function getDelayEventMinutes(event: TrainDelayEvent | null | undefined): number | null {
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

export function getTrainDelayCorrectionMinutes(train: Train): number {
  const values = [
    getDelayEventMinutes(train.departure_event),
    getDelayEventMinutes(train.arrival_event),
  ].filter((value): value is number => value !== null && value > 0)

  return values.length > 0 ? Math.max(...values) : 0
}
