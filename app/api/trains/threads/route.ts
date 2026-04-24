import { NextRequest, NextResponse } from "next/server"
import localScheduleData from "@/public/assets/local-trains-schedule.json"

type Nullable<T> = T | null

type ThreadError = {
  status_code: Nullable<number>
  message: string
}

type ThreadResponsePayload = {
  thread_route: Record<string, unknown> | null
  thread_error: ThreadError | null
}

type TrainSegmentLike = {
  thread?: {
    uid?: unknown
  }
  thread_route?: unknown
  thread_error?: unknown
}

type LocalSchedulePayload = {
  weekday?: {
    segments?: unknown
  }
  weekend?: {
    segments?: unknown
  }
}

const localThreadPayloadByUid = buildLocalThreadPayloadMap()

function toThreadRouteRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function toThreadError(value: unknown): ThreadError | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null
  }

  const record = value as { status_code?: unknown; message?: unknown }
  if (typeof record.message !== "string") {
    return null
  }

  return {
    status_code: typeof record.status_code === "number" ? record.status_code : null,
    message: record.message,
  }
}

function collectSegments(source: unknown): TrainSegmentLike[] {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return []
  }

  const schedule = source as LocalSchedulePayload
  const weekdaySegments = Array.isArray(schedule.weekday?.segments) ? schedule.weekday.segments : []
  const weekendSegments = Array.isArray(schedule.weekend?.segments) ? schedule.weekend.segments : []

  return [...weekdaySegments, ...weekendSegments] as TrainSegmentLike[]
}

function buildLocalThreadPayloadMap(): Map<string, ThreadResponsePayload> {
  const map = new Map<string, ThreadResponsePayload>()

  for (const segment of collectSegments(localScheduleData)) {
    const uid = typeof segment.thread?.uid === "string" ? segment.thread.uid : null
    if (!uid || map.has(uid)) {
      continue
    }

    const route = toThreadRouteRecord(segment.thread_route)
    const error = toThreadError(segment.thread_error)
    map.set(uid, {
      thread_route: route,
      thread_error: route ? null : error,
    })
  }

  return map
}

function uniqueUids(rawUids: string): string[] {
  const result: string[] = []
  const seen = new Set<string>()

  for (const uid of rawUids.split(",").map((part) => part.trim()).filter(Boolean)) {
    if (seen.has(uid)) {
      continue
    }

    seen.add(uid)
    result.push(uid)
  }

  return result
}

export async function GET(request: NextRequest) {
  const rawUids = request.nextUrl.searchParams.get("uids") ?? ""
  const uids = uniqueUids(rawUids)

  if (uids.length === 0) {
    return NextResponse.json(
      { error: "Missing uids query parameter" },
      { status: 400 },
    )
  }

  const responseByUid: Record<string, ThreadResponsePayload> = {}

  for (const uid of uids) {
    responseByUid[uid] = localThreadPayloadByUid.get(uid) ?? {
      thread_route: null,
      thread_error: {
        status_code: null,
        message: "Thread route is unavailable in local schedule",
      },
    }
  }

  return NextResponse.json(responseByUid)
}
