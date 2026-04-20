import {
  buildPovResolvedAnchors,
  getPovSyncState,
  POV_VIDEO_ANCHORS,
} from "@/lib/pov-sync"
import { formatDurationToRu, getDate } from "@/lib/utils"
import { useCurrentTrainStore } from "@/stores/currentTrainStore"
import { StepBack } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

type Nullable<T> = T | null

type ExpandState = {
  top: boolean
  bottom: boolean
}

function toTimestamp(value: Nullable<string>): number | null {
  if (!value) {
    return null
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function formatStationTime(value: Nullable<string>): string {
  if (!value) {
    return ""
  }

  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    return ""
  }

  return date.toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function TrainSidebar() {
  const { currentTrain, setCurrentTrain } = useCurrentTrainStore()
  const [expandedByTrain, setExpandedByTrain] = useState<Record<string, ExpandState>>({})
  const [nowTimestamp, setNowTimestamp] = useState(() => getDate().getTime())

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowTimestamp(getDate().getTime())
    }, 250)

    return () => {
      window.clearInterval(id)
    }
  }, [])

  const trainUid = currentTrain?.thread.uid ?? null
  const expansion = trainUid
    ? (expandedByTrain[trainUid] ?? { top: false, bottom: false })
    : { top: false, bottom: false }

  const updateExpansion = useCallback(
    (next: Partial<ExpandState>) => {
      if (!trainUid) {
        return
      }

      setExpandedByTrain((prev) => {
        const prevState = prev[trainUid] ?? { top: false, bottom: false }
        return {
          ...prev,
          [trainUid]: {
            ...prevState,
            ...next,
          },
        }
      })
    },
    [trainUid],
  )

  const departureTimestamp = new Date(currentTrain?.departure ?? "").getTime()
  const arrivalTimestamp = new Date(currentTrain?.arrival ?? "").getTime()

  const allTime = arrivalTimestamp - departureTimestamp
  const passedTime = Math.min(Math.max(nowTimestamp - departureTimestamp, 0), allTime)
  const passedTimeLabel = formatDurationToRu(passedTime)
  const totalTimeLabel = formatDurationToRu(allTime)

  const videoRef = useRef<HTMLVideoElement>(null)

  const routeStops = useMemo(() => currentTrain?.thread_route.stops ?? [], [currentTrain?.thread_route.stops])

  const povAnchors = useMemo(
    () => buildPovResolvedAnchors(routeStops, POV_VIDEO_ANCHORS),
    [routeStops],
  )
  const povSyncState = useMemo(
    () => (povAnchors ? getPovSyncState(nowTimestamp, povAnchors) : null),
    [nowTimestamp, povAnchors],
  )
  const isVideoStationLeft = povSyncState?.kind !== "before-start" && Boolean(povSyncState)

  const lastStopIndex = Math.max(0, routeStops.length - 1)

  let currentSegment = { startIndex: 0, endIndex: Math.min(1, lastStopIndex) }

  for (let i = 0; i < routeStops.length; i += 1) {
    const stop = routeStops[i]
    const stationArrival = toTimestamp(stop.arrival)
    const stationDeparture = toTimestamp(stop.departure)

    if (
      stationArrival !== null &&
      stationDeparture !== null &&
      stationArrival <= nowTimestamp &&
      nowTimestamp <= stationDeparture
    ) {
      currentSegment = {
        startIndex: i,
        endIndex: Math.min(i + 1, lastStopIndex),
      }
      break
    }
  }

  if (
    currentSegment.startIndex === 0 &&
    currentSegment.endIndex === Math.min(1, lastStopIndex)
  ) {
    for (let i = 0; i < routeStops.length - 1; i += 1) {
      const start = routeStops[i]
      const end = routeStops[i + 1]
      const startTime = toTimestamp(start.departure) ?? toTimestamp(start.arrival)
      const endTime = toTimestamp(end.arrival) ?? toTimestamp(end.departure)

      if (startTime === null || endTime === null) {
        continue
      }

      if (startTime <= nowTimestamp && nowTimestamp <= endTime) {
        currentSegment = {
          startIndex: i,
          endIndex: i + 1,
        }
        break
      }
    }
  }

  const topHiddenIndexes: number[] = []
  for (let i = 1; i < currentSegment.startIndex; i += 1) {
    topHiddenIndexes.push(i)
  }

  const bottomHiddenIndexes: number[] = []
  for (let i = currentSegment.endIndex + 1; i < lastStopIndex; i += 1) {
    bottomHiddenIndexes.push(i)
  }

  const mapIndexToStationView = (index: number) => {
    const stop = routeStops[index]
    const isCurrentStart = index === currentSegment.startIndex
    const isCurrentEnd = index === currentSegment.endIndex
    const timeValue = isCurrentEnd
      ? (stop?.arrival ?? stop?.departure ?? null)
      : (stop?.departure ?? stop?.arrival ?? null)

    return {
      index,
      title: stop?.station.title ?? "",
      timeLabel: formatStationTime(timeValue),
      isCurrentSegment: isCurrentStart || isCurrentEnd,
    }
  }

  const topHiddenStations = topHiddenIndexes.map(mapIndexToStationView)
  const bottomHiddenStations = bottomHiddenIndexes.map(mapIndexToStationView)
  const firstStation = routeStops.length > 0 ? mapIndexToStationView(0) : null
  const lastStation = routeStops.length > 0 ? mapIndexToStationView(lastStopIndex) : null
  const currentStartStation = mapIndexToStationView(currentSegment.startIndex)
  const currentEndStation = mapIndexToStationView(currentSegment.endIndex)

  const syncVideoToSegmentProgress = useCallback(() => {
    const video = videoRef.current

    if (!video || !povSyncState || !Number.isFinite(video.duration) || video.duration <= 0) {
      return
    }

    const maxPlayableTime = Math.min(video.duration, povSyncState.targetVideoSec)
    const drift = maxPlayableTime - video.currentTime

    if (povSyncState.kind === "after-end") {
      if (Math.abs(drift) > 0.2) {
        video.currentTime = maxPlayableTime
      }
      video.playbackRate = 1
      if (!video.paused) {
        video.pause()
      }
      return
    }

    if (povSyncState.kind !== "active") {
      return
    }

    const hardSeekThresholdSec = 0.45
    if (Math.abs(drift) > hardSeekThresholdSec) {
      video.currentTime = maxPlayableTime
    }

    const minRate = 0.85
    const maxRate = 1.15
    const driftCorrectionFactor = 0.35
    const correctedRate = Math.max(
      minRate,
      Math.min(maxRate, povSyncState.basePlaybackRate + drift * driftCorrectionFactor),
    )

    if (Math.abs(video.playbackRate - correctedRate) > 0.01) {
      video.playbackRate = correctedRate
    }

    if (video.paused) {
      const playPromise = video.play()
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {})
      }
    }
  }, [povSyncState])

  useEffect(() => {
    syncVideoToSegmentProgress()
  }, [syncVideoToSegmentProgress])

  const renderStationRow = (
    station: {
      index: number
      title: string
      timeLabel: string
      isCurrentSegment: boolean
    },
    hasConnector: boolean,
  ) => (
    <div key={`station-${station.index}`} className={`relative pl-8 ${hasConnector ? "pb-4" : ""}`}>
      {hasConnector ? (
        <div className="absolute top-4 bottom-0 left-[7px] w-0.5 rounded-full bg-sidebar-ring" />
      ) : null}
      <div
        className={`absolute top-1 left-0 flex size-4 items-center justify-center rounded-full ${
          station.isCurrentSegment ? "bg-primary" : "bg-sidebar-ring"
        }`}
      >
        <div className="size-2 rounded-full bg-white" />
      </div>

      <div>
        <div className="font-medium">{station.title}</div>
        {station.timeLabel ? (
          <div className="text-sm text-muted-foreground">{station.timeLabel}</div>
        ) : null}
      </div>
    </div>
  )

  const renderToggleRow = (
    key: string,
    label: string,
    onClick: () => void,
    hasConnector: boolean,
  ) => (
    <div key={key} className={`relative pl-8 ${hasConnector ? "pb-4" : ""}`}>
      {hasConnector ? (
        <div className="absolute top-0 bottom-0 left-[7px] w-0.5 rounded-full bg-sidebar-ring" />
      ) : null}
      <button
        className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground transition-colors hover:bg-accent"
        onClick={onClick}
        type="button"
      >
        {label}
      </button>
    </div>
  )

  type RouteItem =
    | {
        type: "station"
        station: {
          index: number
          title: string
          timeLabel: string
          isCurrentSegment: boolean
        }
      }
    | { type: "toggle"; key: string; label: string; onClick: () => void }

  const routeItems: RouteItem[] = []

  if (firstStation) {
    routeItems.push({ type: "station", station: firstStation })
  }

  if (!expansion.top && topHiddenStations.length > 0) {
    routeItems.push({
      type: "toggle",
      key: "top-expand",
      label: `еще ${topHiddenStations.length} станций`,
      onClick: () => updateExpansion({ top: true }),
    })
  }

  if (expansion.top) {
    for (const station of topHiddenStations) {
      routeItems.push({ type: "station", station })
    }

    if (topHiddenStations.length > 0) {
      routeItems.push({
        type: "toggle",
        key: "top-collapse",
        label: "свернуть",
        onClick: () => updateExpansion({ top: false }),
      })
    }
  }

  if (currentStartStation.index !== 0) {
    routeItems.push({ type: "station", station: currentStartStation })
  }

  if (
    currentEndStation.index !== currentStartStation.index &&
    currentEndStation.index !== lastStopIndex
  ) {
    routeItems.push({ type: "station", station: currentEndStation })
  }

  if (!expansion.bottom && bottomHiddenStations.length > 0) {
    routeItems.push({
      type: "toggle",
      key: "bottom-expand",
      label: `еще ${bottomHiddenStations.length} станций`,
      onClick: () => updateExpansion({ bottom: true }),
    })
  }

  if (expansion.bottom) {
    for (const station of bottomHiddenStations) {
      routeItems.push({ type: "station", station })
    }

    if (bottomHiddenStations.length > 0) {
      routeItems.push({
        type: "toggle",
        key: "bottom-collapse",
        label: "свернуть",
        onClick: () => updateExpansion({ bottom: false }),
      })
    }
  }

  if (lastStation) {
    routeItems.push({ type: "station", station: lastStation })
  }

  return (
    <>
      {currentTrain ? (
        <button
          className="absolute left-1/4 ml-4 rounded-full bg-card p-2 z-1200 top-4"
          onClick={() => setCurrentTrain(null)}
          type="button"
        >
          <StepBack className="size-6 cursor-pointer" />
        </button>
      ) : null}
      <div
        className={`absolute top-0 left-0 z-1200 h-full bg-card ${
          currentTrain
            ? "pointer-events-auto translate-x-0"
            : "pointer-events-none -translate-x-full"
        } flex w-full flex-col overflow-y-auto p-5 lg:w-1/4 transition`}
      >
        {isVideoStationLeft ? (
          <video
            src="/assets/pov.mp4"
            ref={videoRef}
            className="mb-5 w-full rounded-xl"
            onLoadedMetadata={syncVideoToSegmentProgress}
            autoPlay
            muted
            playsInline
          ></video>
        ) : null}
        <div className="flex gap-3">
          <span style={{ color: currentTrain?.thread.transport_subtype?.color }}>
            {currentTrain?.thread.number}
          </span>
          <div
            className="mb-2 w-fit px-2 text-white"
            style={{
              background: currentTrain?.thread.transport_subtype?.color,
            }}
          >
            {currentTrain?.thread.transport_subtype?.title}
          </div>
        </div>
        <header className="mb-1 text-xl">{currentTrain?.thread.title}</header>
        <span>
          В пути уже {passedTimeLabel} из {totalTimeLabel}
        </span>
        <hr className="my-3" />
        <span className="text-xl">Маршрут</span>

        <div className="mt-5 pr-1">
          <div className="relative">
            {routeItems.map((item, index) => {
              const hasConnector = index < routeItems.length - 1
              if (item.type === "station") {
                return renderStationRow(item.station, hasConnector)
              }

              return renderToggleRow(item.key, item.label, item.onClick, hasConnector)
            })}
          </div>
        </div>
      </div>
    </>
  )
}
