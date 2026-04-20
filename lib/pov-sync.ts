type Nullable<T> = T | null

export type PovEventType = "arrival" | "departure"

export type PovAnchorConfig = {
  stationTitle: string
  eventType: PovEventType
  videoSec: number
}

export type PovTrainStop = {
  station?: {
    title?: string
  }
  arrival?: Nullable<string>
  departure?: Nullable<string>
}

export type PovResolvedAnchor = PovAnchorConfig & {
  trainTimestamp: number
}

export type PovSegment = {
  trainStart: number
  trainEnd: number
  videoStart: number
  videoEnd: number
  basePlaybackRate: number
}

export type PovSyncState =
  | {
      kind: "before-start"
      startTrainTimestamp: number
      targetVideoSec: number
    }
  | {
      kind: "active"
      targetVideoSec: number
      basePlaybackRate: number
      segment: PovSegment
    }
  | {
      kind: "after-end"
      endTrainTimestamp: number
      targetVideoSec: number
    }

const VIDEO_TIME = {
  "00:00": 0,
  "01:36": 96,
  "02:36": 156,
  "05:28": 328,
  "06:28": 388,
  "08:49": 529,
  "09:49": 589,
  "11:46": 706,
  "12:46": 766,
  "14:19": 859,
  "15:19": 919,
  "18:42": 1122,
} as const

export const POV_VIDEO_ANCHORS: readonly PovAnchorConfig[] = [
  {
    stationTitle: "Красный Строитель",
    eventType: "departure",
    videoSec: VIDEO_TIME["00:00"],
  },
  { stationTitle: "Битца", eventType: "arrival", videoSec: VIDEO_TIME["01:36"] },
  { stationTitle: "Битца", eventType: "departure", videoSec: VIDEO_TIME["02:36"] },
  { stationTitle: "Бутово", eventType: "arrival", videoSec: VIDEO_TIME["05:28"] },
  { stationTitle: "Бутово", eventType: "departure", videoSec: VIDEO_TIME["06:28"] },
  {
    stationTitle: "Щербинка",
    eventType: "arrival",
    videoSec: VIDEO_TIME["08:49"],
  },
  {
    stationTitle: "Щербинка",
    eventType: "departure",
    videoSec: VIDEO_TIME["09:49"],
  },
  {
    stationTitle: "Остафьево",
    eventType: "arrival",
    videoSec: VIDEO_TIME["11:46"],
  },
  {
    stationTitle: "Остафьево",
    eventType: "departure",
    videoSec: VIDEO_TIME["12:46"],
  },
  {
    stationTitle: "Силикатная",
    eventType: "arrival",
    videoSec: VIDEO_TIME["14:19"],
  },
  {
    stationTitle: "Силикатная",
    eventType: "departure",
    videoSec: VIDEO_TIME["15:19"],
  },
  {
    stationTitle: "Подольск",
    eventType: "arrival",
    videoSec: VIDEO_TIME["18:42"],
  },
]

function toTimestamp(value: Nullable<string> | undefined): number | null {
  if (!value) {
    return null
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function readStopEventTimestamp(stop: PovTrainStop, eventType: PovEventType): number | null {
  return eventType === "arrival"
    ? toTimestamp(stop.arrival ?? null)
    : toTimestamp(stop.departure ?? null)
}

export function buildPovResolvedAnchors(
  stops: PovTrainStop[],
  anchorConfig: readonly PovAnchorConfig[] = POV_VIDEO_ANCHORS,
): PovResolvedAnchor[] | null {
  const resolved: PovResolvedAnchor[] = []
  let cursor = 0

  for (const anchor of anchorConfig) {
    let matchedIndex = -1
    let matchedTimestamp: number | null = null

    for (let i = cursor; i < stops.length; i += 1) {
      const stop = stops[i]
      const stationTitle = stop.station?.title
      if (stationTitle !== anchor.stationTitle) {
        continue
      }

      const timestamp = readStopEventTimestamp(stop, anchor.eventType)
      if (timestamp === null) {
        continue
      }

      matchedIndex = i
      matchedTimestamp = timestamp
      break
    }

    if (matchedIndex === -1 || matchedTimestamp === null) {
      return null
    }

    const prev = resolved[resolved.length - 1]
    if (prev) {
      if (matchedTimestamp < prev.trainTimestamp) {
        return null
      }
      if (anchor.videoSec < prev.videoSec) {
        return null
      }
    }

    resolved.push({
      ...anchor,
      trainTimestamp: matchedTimestamp,
    })
    cursor = matchedIndex
  }

  return resolved
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function interpolateLinear(a: number, b: number, ratio: number): number {
  return a + (b - a) * ratio
}

export function getPovSyncState(
  nowTimestamp: number,
  anchors: PovResolvedAnchor[],
): PovSyncState | null {
  if (anchors.length === 0) {
    return null
  }

  const first = anchors[0]
  const last = anchors[anchors.length - 1]

  if (nowTimestamp < first.trainTimestamp) {
    return {
      kind: "before-start",
      startTrainTimestamp: first.trainTimestamp,
      targetVideoSec: first.videoSec,
    }
  }

  if (nowTimestamp >= last.trainTimestamp) {
    return {
      kind: "after-end",
      endTrainTimestamp: last.trainTimestamp,
      targetVideoSec: last.videoSec,
    }
  }

  for (let i = 0; i < anchors.length - 1; i += 1) {
    const start = anchors[i]
    const end = anchors[i + 1]
    if (nowTimestamp < start.trainTimestamp || nowTimestamp > end.trainTimestamp) {
      continue
    }

    const trainDeltaMs = end.trainTimestamp - start.trainTimestamp
    const videoDeltaSec = end.videoSec - start.videoSec
    const ratio =
      trainDeltaMs > 0
        ? clamp((nowTimestamp - start.trainTimestamp) / trainDeltaMs, 0, 1)
        : 1
    const targetVideoSec = interpolateLinear(start.videoSec, end.videoSec, ratio)
    const basePlaybackRate =
      trainDeltaMs > 0 ? clamp((videoDeltaSec * 1000) / trainDeltaMs, 0.1, 4) : 1

    return {
      kind: "active",
      targetVideoSec,
      basePlaybackRate,
      segment: {
        trainStart: start.trainTimestamp,
        trainEnd: end.trainTimestamp,
        videoStart: start.videoSec,
        videoEnd: end.videoSec,
        basePlaybackRate,
      },
    }
  }

  return {
    kind: "after-end",
    endTrainTimestamp: last.trainTimestamp,
    targetVideoSec: last.videoSec,
  }
}
