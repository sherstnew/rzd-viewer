"use client"

import localScheduleData from "@/public/assets/local-trains-schedule.json"
import type { Train, TrainDelayEvent, TrainThreadPayload } from "@/lib/trains"
import { ClockMode, getDateKey } from "@/lib/runtime-mode"
import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

type DataSource = "local-schedule"

type DelayPayload = {
  departure_event: TrainDelayEvent | null
  arrival_event: TrainDelayEvent | null
}

type DelaysApiPayload = {
  delaysByUid?: Record<string, DelayPayload>
}

type TrainsStoreState = {
  segments: Train[]
  threadsByUid: Record<string, TrainThreadPayload>
  inFlightUids: Record<string, true>
  cacheDate: string | null
  clockMode: ClockMode
  dataSource: DataSource
  isLoading: boolean
  isLoadingThreads: boolean
  error: string | null
  threadsError: string | null
  isLoadingDelays: boolean
  delaysError: string | null
  fetchForToday: (options?: { force?: boolean }) => Promise<void>
  fetchThreadsForUids: (uids: string[]) => Promise<void>
  fetchDelays: () => Promise<void>
}

type FallbackPayload = {
  segments?: unknown
}
type LocalScheduleSection = {
  date?: unknown
  segments?: unknown
}
type LocalSchedulePayload = {
  weekday?: LocalScheduleSection
  weekend?: LocalScheduleSection
}

const ISO_DATE_PREFIX_REGEX = /^(\d{4}-\d{2}-\d{2})([ T].*)$/
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/

function extractSegments(payload: unknown): Train[] | null {
  if (Array.isArray(payload)) {
    return payload as Train[]
  }

  if (payload && typeof payload === "object") {
    const record = payload as FallbackPayload
    if (Array.isArray(record.segments)) {
      return record.segments as Train[]
    }
  }

  return null
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

function normalizeSegmentDatesToDay(segment: Train, dayKey: string): Train {
  const next: Train = {
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

function normalizeSegmentsToDay(segments: Train[], dayKey: string): Train[] {
  return segments.map((segment) => normalizeSegmentDatesToDay(segment, dayKey))
}

function buildSafeLocalStorage(): Storage {
  return {
    getItem: (name) => localStorage.getItem(name),
    removeItem: (name) => localStorage.removeItem(name),
    setItem: (name, value) => {
      try {
        localStorage.setItem(name, value)
        return
      } catch (error) {
        const isQuotaError =
          error instanceof DOMException &&
          (error.name === "QuotaExceededError" || error.code === 22)
        if (!isQuotaError) {
          throw error
        }
      }

      try {
        const parsed = JSON.parse(value) as {
          state?: Record<string, unknown>
          version?: number
        }
        if (!parsed.state || typeof parsed.state !== "object") {
          return
        }

        const reducedState = {
          ...parsed.state,
          segments: [],
        }

        localStorage.setItem(
          name,
          JSON.stringify({
            ...parsed,
            state: reducedState,
          }),
        )
      } catch {
      }
    },
    clear: () => localStorage.clear(),
    key: (index) => localStorage.key(index),
    get length() {
      return localStorage.length
    },
  }
}

function readLocalTrains(payload: unknown, dayKey: string): Train[] {
  const segments = extractSegments(payload)
  if (!segments) {
    return []
  }

  return normalizeSegmentsToDay(segments, dayKey).map((segment) => ({
    ...segment,
    departure_event: null,
    arrival_event: null,
  }))
}

function isWeekendDayKey(dayKey: string): boolean {
  const date = new Date(`${dayKey}T12:00:00+03:00`)
  const day = date.getDay()
  return day === 0 || day === 6
}

function readLocalScheduleTrains(payload: unknown, dayKey: string): Train[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return []
  }

  const schedule = payload as LocalSchedulePayload
  const section = isWeekendDayKey(dayKey) ? schedule.weekend : schedule.weekday
  return readLocalTrains(section, dayKey)
}

function applyDelayPayloads(segments: Train[], delaysByUid: Record<string, DelayPayload>): Train[] {
  return segments.map((segment) => {
    const uid = segment.thread?.uid
    const delay = uid ? delaysByUid[uid] : null

    return {
      ...segment,
      departure_event: delay?.departure_event ?? null,
      arrival_event: delay?.arrival_event ?? null,
    }
  })
}

export const useTrainsStore = create<TrainsStoreState>()(
  persist(
    (set, get) => ({
      segments: [],
      threadsByUid: {},
      inFlightUids: {},
      cacheDate: null,
      clockMode: "real",
      dataSource: "local-schedule",
      isLoading: false,
      isLoadingThreads: false,
      error: null,
      threadsError: null,
      isLoadingDelays: false,
      delaysError: null,
      fetchForToday: async (options) => {
        const desiredClockMode: ClockMode = "real"
        const today = getDateKey(desiredClockMode)
        const state = get()
        const force = options?.force === true

        if (!force && state.cacheDate === today && state.segments.length > 0 && state.clockMode === desiredClockMode) {
          if (state.error) {
            set({ error: null })
          }
          return
        }

        if (state.isLoading) {
          return
        }

        set({ isLoading: true, error: null, clockMode: desiredClockMode })

        const localSegments = readLocalScheduleTrains(localScheduleData, today)
        set({
          segments: localSegments,
          threadsByUid: {},
          inFlightUids: {},
          cacheDate: today,
          dataSource: "local-schedule",
          isLoading: false,
          error: null,
          threadsError: null,
          delaysError: null,
        })
      },
      fetchThreadsForUids: async () => {
        set({ isLoadingThreads: false, threadsError: null })
      },
      fetchDelays: async () => {
        const state = get()
        if (state.isLoadingDelays || state.segments.length === 0) {
          return
        }

        set({ isLoadingDelays: true, delaysError: null })

        try {
          const response = await fetch("/api/trains/delays", { cache: "no-store" })
          if (!response.ok) {
            const errorPayload = (await response.json().catch(() => null)) as
              | { error?: string; details?: string }
              | null
            throw new Error(
              errorPayload?.details ??
                errorPayload?.error ??
                `Delay request failed with status ${response.status}`,
            )
          }

          const payload = (await response.json()) as DelaysApiPayload
          const delaysByUid = payload.delaysByUid
          if (!delaysByUid || typeof delaysByUid !== "object" || Array.isArray(delaysByUid)) {
            throw new Error("Invalid delay payload: expected delaysByUid object")
          }

          set((prev) => ({
            segments: applyDelayPayloads(prev.segments, delaysByUid),
            isLoadingDelays: false,
            delaysError: null,
          }))
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load train delays"
          console.error("[trainsStore] failed to fetch train delays", error)
          set({
            isLoadingDelays: false,
            delaysError: message,
          })
        }
      },
    }),
    {
      name: "mcd-trains-cache-v2",
      version: 3,
      storage: createJSONStorage(buildSafeLocalStorage),
      partialize: (state) => ({
        cacheDate: state.cacheDate,
        clockMode: state.clockMode,
        dataSource: state.dataSource,
      }),
      migrate: (persistedState) => {
        if (!persistedState || typeof persistedState !== "object") {
          return persistedState as TrainsStoreState
        }

        const nextState = { ...(persistedState as Record<string, unknown>) }
        delete nextState.segments

        return nextState as TrainsStoreState
      },
    },
  ),
)
