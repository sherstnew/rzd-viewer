import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getDate() {
  const now = new Date()
  return new Date(
    2026,
    3,
    18,
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    now.getMilliseconds()
  )
}

export function formatDurationToRu(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return ""
  }

  const totalMinutes = Math.floor(ms / 1000 / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []

  if (hours > 0) {
    parts.push(`${hours} ч.`)
  }

  if (minutes > 0) {
    parts.push(`${minutes} мин.`)
  }

  return parts.join(" ")
}