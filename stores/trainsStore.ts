"use client"

import type { Train, TrainThreadPayload } from "@/lib/trains"
import { getTodayDateKey } from "@/lib/utils"
import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

type TrainsStoreState = {
  segments: Train[]
  threadsByUid: Record<string, TrainThreadPayload>
  inFlightUids: Record<string, true>
  cacheDate: string | null
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

export const useTrainsStore = create<TrainsStoreState>()(
  persist(
    (set, get) => ({
      segments: [],
      threadsByUid: {},
      inFlightUids: {},
      cacheDate: null,
      isLoading: false,
      isLoadingThreads: false,
      error: null,
      threadsError: null,
      fetchForToday: async () => {
        const today = getTodayDateKey()
        const state = get()

        if (state.cacheDate === today && state.segments.length > 0) {
          if (state.error) {
            set({ error: null })
          }
          return
        }

        if (state.isLoading) {
          return
        }

        set({ isLoading: true, error: null })

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
            isLoading: false,
            error: null,
            threadsError: null,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load train data"
          try {
            const fallbackResponse = await fetch("/assets/trains-fallback.json", { cache: "no-store" })
            if (!fallbackResponse.ok) {
              throw new Error(`Fallback request failed with status ${fallbackResponse.status}`)
            }

            const fallbackPayload = (await fallbackResponse.json()) as unknown
            const fallbackSegments = extractSegments(fallbackPayload)
            if (!fallbackSegments) {
              throw new Error("Invalid fallback payload: expected train segments array")
            }

            set({
              segments: fallbackSegments,
              threadsByUid: {},
              inFlightUids: {},
              cacheDate: today,
              isLoading: false,
              error: `API недоступен, показаны поезда из локального кэша: ${message}`,
            })
          } catch (fallbackError) {
            const fallbackMessage =
              fallbackError instanceof Error ? fallbackError.message : "Failed to load fallback train data"
            set({
              isLoading: false,
              error: `${message}. Fallback недоступен: ${fallbackMessage}`,
            })
          }
        }
      },
      fetchThreadsForUids: async (uids: string[]) => {
        const state = get()
        const today = getTodayDateKey()

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
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        cacheDate: state.cacheDate,
      }),
    },
  ),
)
