import { Train } from "@/lib/trains"
import { create } from "zustand"

interface CurrentTrainStore {
  currentTrain: null | Train
  setCurrentTrain: (currentTrain: Train | null) => void
}

export const useCurrentTrainStore = create<CurrentTrainStore>((set) => ({
  currentTrain: null,
  setCurrentTrain: (currentTrain) => {
    set({ currentTrain: currentTrain })
  },
}))
