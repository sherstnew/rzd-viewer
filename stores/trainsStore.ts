"use client"

import localTrainsWithThreads from "@/jsons/trains-with-threads.json"
import type { Train, TrainThreadPayload } from "@/lib/trains"
import { ClockMode, getDateKey, isDevMode } from "@/lib/runtime-mode"
import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

type DataSource = "api" | "local-dev" | "local-fallback"

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
  fetchForToday: () => Promise<void>
  fetchThreadsForUids: (uids: string[]) => Promise<void>
}

type ApiError = {
  error?: string
  details?: string
}

type ThreadsApiPayload = Record<string, TrainThreadPayload>
type FallbackPayload = {
  segments?: unknown
}

const THREADS_BATCH_SIZE = 25
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
        // Persist is best-effort. If even reduced payload can't be saved, ignore.
      }
    },
    clear: () => localStorage.clear(),
    key: (index) => localStorage.key(index),
    get length() {
      return localStorage.length
    },
  }
}

function readLocalTrains(dayKey: string): Train[] {
  const segments = extractSegments(localTrainsWithThreads)
  if (!segments) {
    return []
  }

  return normalizeSegmentsToDay(segments, dayKey)
}

export const useTrainsStore = create<TrainsStoreState>()(
  persist(
    (set, get) => ({
      segments: [],
      threadsByUid: {},
      inFlightUids: {},
      cacheDate: null,
      clockMode: "real",
      dataSource: "api",
      isLoading: false,
      isLoadingThreads: false,
      error: null,
      threadsError: null,
      fetchForToday: async () => {
        const devEnabled = isDevMode()
        const desiredClockMode: ClockMode = devEnabled ? "fixed-2026-04-18" : "real"
        const today = getDateKey(desiredClockMode)
        const state = get()

        if (state.cacheDate === today && state.segments.length > 0 && state.clockMode === desiredClockMode) {
          if (state.error) {
            set({ error: null })
          }
          return
        }

        if (state.isLoading) {
          return
        }

        set({ isLoading: true, error: null, clockMode: desiredClockMode })

        if (devEnabled) {
          const localSegments = readLocalTrains(today)
          set({
            segments: localSegments,
            threadsByUid: {},
            inFlightUids: {},
            cacheDate: today,
            dataSource: "local-dev",
            isLoading: false,
            error: null,
            threadsError: null,
          })
          return
        }

        try {
          const response = await fetch("/api/trains", { cache: "no-store" })

          if (!response.ok) {
            const errorPayload = (await response.json().catch(() => null)) as ApiError | null
            const message =
              errorPayload?.details ??
              errorPayload?.error ??
              `Request failed with status ${response.status}`
            throw new Error(message)
          }

          const payload = (await response.json()) as unknown
          const segments = extractSegments(payload)
          if (!segments) {
            throw new Error("Invalid API payload: expected train segments array")
          }

          set({
            segments,
            threadsByUid: {},
            inFlightUids: {},
            cacheDate: today,
            clockMode: "real",
            dataSource: "api",
            isLoading: false,
            error: null,
            threadsError: null,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load train data"
          const fallbackDate = getDateKey("fixed-2026-04-18")
          const localSegments = readLocalTrains(fallbackDate)

          if (localSegments.length > 0) {
            set({
              segments: localSegments,
              threadsByUid: {},
              inFlightUids: {},
              cacheDate: fallbackDate,
              clockMode: "fixed-2026-04-18",
              dataSource: "local-fallback",
              isLoading: false,
              error: `API недоступен, показаны поезда из локального fallback: ${message}`,
              threadsError: null,
            })
            return
          }

          set({
            isLoading: false,
            error: `${message}. Локальный fallback недоступен`,
          })
        }
      },
      fetchThreadsForUids: async (uids: string[]) => {
        const state = get()
        if (state.dataSource !== "api") {
          return
        }

        const today = getDateKey(state.clockMode)
        const pendingUids = Array.from(new Set(uids))
          .map((uid) => uid.trim())
          .filter((uid) => uid.length > 0)
          .filter((uid) => !state.threadsByUid[uid] && !state.inFlightUids[uid])

        if (pendingUids.length === 0) {
          return
        }

        const newInFlight: Record<string, true> = {}
        for (const uid of pendingUids) {
          newInFlight[uid] = true
        }

        set((prev) => ({
          inFlightUids: { ...prev.inFlightUids, ...newInFlight },
          isLoadingThreads: true,
          threadsError: null,
        }))

        try {
          const chunks: string[][] = []
          for (let i = 0; i < pendingUids.length; i += THREADS_BATCH_SIZE) {
            chunks.push(pendingUids.slice(i, i + THREADS_BATCH_SIZE))
          }

          for (const chunk of chunks) {
            try {
              const query = encodeURIComponent(chunk.join(","))
              const response = await fetch(`/api/trains/threads?uids=${query}&date=${today}`, {
                cache: "no-store",
              })

              if (!response.ok) {
                const errorPayload = (await response.json().catch(() => null)) as ApiError | null
                const message =
                  errorPayload?.details ??
                  errorPayload?.error ??
                  `Request failed with status ${response.status}`
                throw new Error(message)
              }

              const payload = (await response.json()) as unknown
              if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
                throw new Error("Invalid API payload: expected object keyed by uid")
              }

              const payloadRecord = payload as ThreadsApiPayload

              set((prev) => {
                const nextThreadsByUid = { ...prev.threadsByUid }
                const nextInFlightUids = { ...prev.inFlightUids }

                for (const uid of chunk) {
                  const item = payloadRecord[uid]
                  nextThreadsByUid[uid] = item ?? {
                    thread_route: null,
                    thread_error: {
                      status_code: null,
                      message: "Нитка не найдена в ответе batch API",
                    },
                  }
                  delete nextInFlightUids[uid]
                }

                return {
                  threadsByUid: nextThreadsByUid,
                  inFlightUids: nextInFlightUids,
                  isLoadingThreads: Object.keys(nextInFlightUids).length > 0,
                  threadsError: null,
                }
              })
            } catch (chunkError) {
              const chunkMessage =
                chunkError instanceof Error ? chunkError.message : "Failed to load thread routes chunk"

              set((prev) => {
                const nextThreadsByUid = { ...prev.threadsByUid }
                const nextInFlightUids = { ...prev.inFlightUids }
                for (const uid of chunk) {
                  nextThreadsByUid[uid] = {
                    thread_route: null,
                    thread_error: {
                      status_code: null,
                      message: chunkMessage,
                    },
                  }
                  delete nextInFlightUids[uid]
                }

                return {
                  threadsByUid: nextThreadsByUid,
                  inFlightUids: nextInFlightUids,
                  isLoadingThreads: Object.keys(nextInFlightUids).length > 0,
                  threadsError: chunkMessage,
                }
              })
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load thread routes"
          set((prev) => {
            const nextInFlightUids = { ...prev.inFlightUids }
            for (const uid of pendingUids) {
              delete nextInFlightUids[uid]
            }

            return {
              inFlightUids: nextInFlightUids,
              isLoadingThreads: Object.keys(nextInFlightUids).length > 0,
              threadsError: message,
            }
          })
        }
      },
    }),
    {
      name: "mcd-trains-cache-v2",
      storage: createJSONStorage(buildSafeLocalStorage),
      partialize: (state) => ({
        segments: state.segments,
        cacheDate: state.cacheDate,
        clockMode: state.clockMode,
        dataSource: state.dataSource,
      }),
    },
  ),
)
