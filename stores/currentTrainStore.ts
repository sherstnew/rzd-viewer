import { Train } from "@/lib/trains"
import { create } from "zustand"

interface CurrentTrainStore {
  currentTrain: null | Train
  currentStationTitle: string | null
  routeStationTitles: string[]
  setCurrentTrain: (currentTrain: Train | null) => void
  setCurrentStationTitle: (currentStationTitle: string | null) => void
  setRouteStationTitles: (routeStationTitles: string[]) => void
}

export const useCurrentTrainStore = create<CurrentTrainStore>((set) => ({
  currentTrain: null,
  currentStationTitle: null,
  routeStationTitles: [],
  setCurrentTrain: (currentTrain) => {
    set({ currentTrain: currentTrain })
  },
  setCurrentStationTitle: (currentStationTitle) => {
    set({ currentStationTitle })
  },
  setRouteStationTitles: (routeStationTitles) => {
    set({ routeStationTitles })
  },
}))
