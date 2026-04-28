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

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export const useCurrentTrainStore = create<CurrentTrainStore>((set, get) => ({
  currentTrain: null,
  currentStationTitle: null,
  routeStationTitles: [],
  showLongDistanceTrains: false,
  visibleLongDistanceTrains: [],
  selectedLongDistanceTrain: null,
  setCurrentTrain: (currentTrain) => {
    if (get().currentTrain === currentTrain) {
      return
    }
    set({ currentTrain })
  },
  setCurrentStationTitle: (currentStationTitle) => {
    if (get().currentStationTitle === currentStationTitle) {
      return
    }
    set({ currentStationTitle })
  },
  setRouteStationTitles: (routeStationTitles) => {
    if (stringArraysEqual(get().routeStationTitles, routeStationTitles)) {
      return
    }
    set({ routeStationTitles })
  },
  setShowLongDistanceTrains: (showLongDistanceTrains) => {
    if (get().showLongDistanceTrains === showLongDistanceTrains) {
      return
    }
    set({ showLongDistanceTrains })
  },
  setVisibleLongDistanceTrains: (visibleLongDistanceTrains) => {
    if (get().visibleLongDistanceTrains === visibleLongDistanceTrains) {
      return
    }
    set({ visibleLongDistanceTrains })
  },
  setSelectedLongDistanceTrain: (selectedLongDistanceTrain) => {
    if (get().selectedLongDistanceTrain === selectedLongDistanceTrain) {
      return
    }
    set({ selectedLongDistanceTrain })
  },
}))
