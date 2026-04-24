import { getDate } from "./utils"

export type ClockMode = "real" | "fixed-2026-04-18"

const FIXED_DATE_UTC = {
  year: 2026,
  monthIndex: 3,
  day: 18,
}

function getMoscowTimeParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now)

  const partByType = new Map(parts.map((part) => [part.type, part.value]))
  const hour = Number(partByType.get("hour") ?? "0")
  const minute = Number(partByType.get("minute") ?? "0")
  const second = Number(partByType.get("second") ?? "0")

  return { hour, minute, second }
}

export function getNow(clockMode: ClockMode): Date {
  if (clockMode === "real") {
    return getDate()
  }

  const now = getDate()
  const { hour, minute, second } = getMoscowTimeParts(now)
  const utcTimestamp = Date.UTC(
    FIXED_DATE_UTC.year,
    FIXED_DATE_UTC.monthIndex,
    FIXED_DATE_UTC.day,
    hour - 3,
    minute,
    second,
    now.getMilliseconds(),
  )

  return new Date(utcTimestamp)
}

export function getDateKey(clockMode: ClockMode): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(getNow(clockMode))
}
