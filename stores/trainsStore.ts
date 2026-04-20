"use client"

import type { Train } from "@/lib/trains"
import { getTodayDateKey } from "@/lib/utils"
import { create } from "zustand"
import { createJSONStorage, persist } from "zustand/middleware"

type TrainsStoreState = {
  segments: Train[]
  cacheDate: string | null
  isLoading: boolean
  error: string | null
  fetchForToday: () => Promise<void>
}

type ApiError = {
  error?: string
  details?: string
}

export const useTrainsStore = create<TrainsStoreState>()(
  persist(
    (set, get) => ({
      segments: [],
      cacheDate: null,
      isLoading: false,
      error: null,
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
          if (!Array.isArray(payload)) {
            throw new Error("Invalid API payload: expected train segments array")
          }

          set({
            segments: payload as Train[],
            cacheDate: today,
            isLoading: false,
            error: null,
          })
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to load train data"
          set({ isLoading: false, error: message })
        }
      },
    }),
    {
      name: "mcd2-trains-cache",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        segments: state.segments,
        cacheDate: state.cacheDate,
      }),
    },
  ),
)
