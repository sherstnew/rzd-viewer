import { NextResponse } from "next/server"
import localScheduleData from "@/public/assets/local-trains-schedule.json"

type TrainSegment = Record<string, unknown> & {
  departure?: unknown
  arrival?: unknown
  start_date?: unknown
  thread_route?: {
    stops?: Array<Record<string, unknown>>
  } | null
}

type LocalScheduleSection = {
  segments?: unknown
}

type LocalSchedulePayload = {
  weekday?: LocalScheduleSection
  weekend?: LocalScheduleSection
}

const ISO_DATE_PREFIX_REGEX = /^(\d{4}-\d{2}-\d{2})([ T].*)$/
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/

function getTodayMoscowDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

function isWeekendDayKey(dayKey: string): boolean {
  const date = new Date(`${dayKey}T12:00:00+03:00`)
  const day = date.getDay()
  return day === 0 || day === 6
}

function replaceIsoDatePrefix(value: string, dayKey: string): string {
  const isoMatch = value.match(ISO_DATE_PREFIX_REGEX)
  if (isoMatch) {
    return `${dayKey}${isoMatch[2]}`
  }

  if (DATE_ONLY_REGEX.test(value)) {
    return dayKey
  }

  return value
}

function normalizeSegmentDatesToDay(segment: TrainSegment, dayKey: string): TrainSegment {
  const next: TrainSegment = {
    ...segment,
    departure:
      typeof segment.departure === "string"
        ? replaceIsoDatePrefix(segment.departure, dayKey)
        : segment.departure,
    arrival:
      typeof segment.arrival === "string"
        ? replaceIsoDatePrefix(segment.arrival, dayKey)
        : segment.arrival,
    start_date:
      typeof segment.start_date === "string"
        ? replaceIsoDatePrefix(segment.start_date, dayKey)
        : segment.start_date,
  }

  const stops = segment.thread_route?.stops
  if (Array.isArray(stops) && segment.thread_route) {
    next.thread_route = {
      ...segment.thread_route,
      stops: stops.map((stop) => ({
        ...stop,
        departure:
          typeof stop.departure === "string"
            ? replaceIsoDatePrefix(stop.departure, dayKey)
            : stop.departure,
        arrival:
          typeof stop.arrival === "string"
            ? replaceIsoDatePrefix(stop.arrival, dayKey)
            : stop.arrival,
      })),
    }
  }

  return next
}

function getLocalSegments(dayKey: string): TrainSegment[] {
  const schedule = localScheduleData as LocalSchedulePayload
  const section = isWeekendDayKey(dayKey) ? schedule.weekend : schedule.weekday
  const segments = Array.isArray(section?.segments) ? section.segments : []

  return (segments as TrainSegment[]).map((segment) => normalizeSegmentDatesToDay(segment, dayKey))
}

export async function GET() {
  const today = getTodayMoscowDate()
  return NextResponse.json(getLocalSegments(today))
}
