import { Train } from "@/lib/trains"
import type { LongDistanceTrainObject } from "@/lib/long-distance-trains"
import { create } from "zustand"

interface CurrentTrainStore {
  currentTrain: null | Train
  currentStationTitle: string | null
  routeStationTitles: string[]
  showLongDistanceTrains: boolean
  visibleLongDistanceTrains: LongDistanceTrainObject[]
  selectedLongDistanceTrain: LongDistanceTrainObject | null
  setCurrentTrain: (currentTrain: Train | null) => void
  setCurrentStationTitle: (currentStationTitle: string | null) => void
  setRouteStationTitles: (routeStationTitles: string[]) => void
  setShowLongDistanceTrains: (showLongDistanceTrains: boolean) => void
  setVisibleLongDistanceTrains: (trains: LongDistanceTrainObject[]) => void
  setSelectedLongDistanceTrain: (train: LongDistanceTrainObject | null) => void
}

export const useCurrentTrainStore = create<CurrentTrainStore>((set) => ({
  currentTrain: null,
  currentStationTitle: null,
  routeStationTitles: [],
  showLongDistanceTrains: false,
  visibleLongDistanceTrains: [],
  selectedLongDistanceTrain: null,
  setCurrentTrain: (currentTrain) => set({ currentTrain }),
  setCurrentStationTitle: (currentStationTitle) => set({ currentStationTitle }),
  setRouteStationTitles: (routeStationTitles) => set({ routeStationTitles }),
  setShowLongDistanceTrains: (showLongDistanceTrains) => set({ showLongDistanceTrains }),
  setVisibleLongDistanceTrains: (visibleLongDistanceTrains) => set({ visibleLongDistanceTrains }),
  setSelectedLongDistanceTrain: (selectedLongDistanceTrain) => set({ selectedLongDistanceTrain }),
}))
