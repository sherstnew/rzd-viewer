import {
    buildPovResolvedAnchors,
    getPovSyncState,
    POV_VIDEO_ANCHORS,
} from "@/lib/pov-sync";
import { resolveTrainProgressByStops } from "@/lib/train-progress";
import { getNow } from "@/lib/runtime-mode";
import { useTrainsStore } from "@/stores/trainsStore";
import { getTrainDelayLabels } from "@/lib/train-delays";
import { formatDurationToRu } from "@/lib/utils";
import { useCurrentTrainStore } from "@/stores/currentTrainStore";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Nullable<T> = T | null;
const PODOLSK_STATION_CODE = "s9600731";

type ExpandState = {
    top: boolean;
    bottom: boolean;
};

function toTimestamp(value: Nullable<string>): number | null {
    if (!value) {
        return null;
    }

    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
}

function formatStationTime(value: Nullable<string>): string {
    if (!value) {
        return "";
    }

    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
        return "";
    }

    return date.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
    });
}

function getStationsWordForm(count: number): "станция" | "станции" | "станций" {
    const absCount = Math.abs(count);
    const lastTwoDigits = absCount % 100;

    if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
        return "станций";
    }

    const lastDigit = absCount % 10;
    if (lastDigit === 1) {
        return "станция";
    }

    if (lastDigit >= 2 && lastDigit <= 4) {
        return "станции";
    }

    return "станций";
}

export function TrainSidebar() {
    const { currentTrain, setCurrentTrain } = useCurrentTrainStore();
    const { clockMode } = useTrainsStore();
    const [expandedByTrain, setExpandedByTrain] = useState<
        Record<string, ExpandState>
    >({});
    const [nowTimestamp, setNowTimestamp] = useState(() =>
        getNow("real").getTime()
    );

    useEffect(() => {
        const id = window.setInterval(() => {
            setNowTimestamp(getNow(clockMode).getTime());
        }, 250);

        return () => {
            window.clearInterval(id);
        };
    }, [clockMode]);

    const trainUid = currentTrain?.thread.uid ?? null;
    const expansion = trainUid
        ? (expandedByTrain[trainUid] ?? { top: false, bottom: false })
        : { top: false, bottom: false };

    const updateExpansion = useCallback(
        (next: Partial<ExpandState>) => {
            if (!trainUid) {
                return;
            }

            setExpandedByTrain((prev) => {
                const prevState = prev[trainUid] ?? {
                    top: false,
                    bottom: false,
                };
                return {
                    ...prev,
                    [trainUid]: {
                        ...prevState,
                        ...next,
                    },
                };
            });
        },
        [trainUid]
    );

    const departureTimestamp = new Date(
        currentTrain?.departure ?? ""
    ).getTime();
    const arrivalTimestamp = new Date(currentTrain?.arrival ?? "").getTime();

    const allTime = arrivalTimestamp - departureTimestamp;
    const passedTime = Math.min(
        Math.max(nowTimestamp - departureTimestamp, 0),
        allTime
    );
    const passedTimeLabel = formatDurationToRu(passedTime);
    const totalTimeLabel = formatDurationToRu(allTime);

    const videoRef = useRef<HTMLVideoElement>(null);

    const routeStops = useMemo(
        () => currentTrain?.thread_route?.stops ?? [],
        [currentTrain?.thread_route?.stops]
    );
    const threadRouteErrorMessage = currentTrain?.thread_error?.message ?? null;
    const isThreadRouteLoading =
        Boolean(currentTrain) &&
        routeStops.length === 0 &&
        !threadRouteErrorMessage;

    const povAnchors = useMemo(
        () => buildPovResolvedAnchors(routeStops, POV_VIDEO_ANCHORS),
        [routeStops]
    );
    const povSyncState = useMemo(
        () => (povAnchors ? getPovSyncState(nowTimestamp, povAnchors) : null),
        [nowTimestamp, povAnchors]
    );
    const isTrainToPodolsk = currentTrain?.to.code === PODOLSK_STATION_CODE;
    const isVideoStationLeft =
        isTrainToPodolsk &&
        povSyncState?.kind !== "before-start" &&
        Boolean(povSyncState);

    const lastStopIndex = Math.max(0, routeStops.length - 1);
    const currentSegment = resolveTrainProgressByStops(nowTimestamp, routeStops);

    const runtimeStatusText = (() => {
        const STATUS_EDGE_WINDOW_CAP_MS = 30_000;
        const STATUS_EDGE_WINDOW_MIN_MS = 5_000;
        const STATUS_EDGE_WINDOW_RATIO = 0.2;
        const activeStop = routeStops[currentSegment.startIndex];
        const nextStop = routeStops[currentSegment.endIndex];

        for (let i = 0; i < routeStops.length; i += 1) {
            const stop = routeStops[i];
            const stationArrival = toTimestamp(stop.arrival);
            const stationDeparture = toTimestamp(stop.departure);

            if (
                stationArrival === null ||
                stationDeparture === null ||
                stationArrival > nowTimestamp ||
                nowTimestamp > stationDeparture
            ) {
                continue;
            }

            const dwellDuration = Math.max(
                0,
                stationDeparture - stationArrival
            );
            const adaptiveEdgeWindow = Math.min(
                STATUS_EDGE_WINDOW_CAP_MS,
                Math.max(
                    STATUS_EDGE_WINDOW_MIN_MS,
                    dwellDuration * STATUS_EDGE_WINDOW_RATIO
                )
            );
            const stationTitle = stop.station.title;

            if (dwellDuration <= adaptiveEdgeWindow * 2) {
                return `стоит на станции ${stationTitle}`;
            }

            if (
                i > 0 &&
                nowTimestamp - stationArrival <= adaptiveEdgeWindow
            ) {
                return `прибывает к станции ${stationTitle}`;
            }

            if (
                i < lastStopIndex &&
                stationDeparture - nowTimestamp <= adaptiveEdgeWindow
            ) {
                return `отправляется со станции ${stationTitle}`;
            }

            return `стоит на станции ${stationTitle}`;
        }

        if (activeStop && nextStop && currentSegment.endIndex > currentSegment.startIndex) {
            const startTime =
                toTimestamp(activeStop.departure) ??
                toTimestamp(activeStop.arrival);
            const endTime =
                toTimestamp(nextStop.arrival) ??
                toTimestamp(nextStop.departure);
            const nextStationTitle = nextStop.station.title;

            if (startTime !== null && endTime !== null && startTime < endTime) {
                const legProgress = (nowTimestamp - startTime) / (endTime - startTime);
                if (legProgress <= 0.1) {
                    return `отправляется со станции ${activeStop.station.title}`;
                }
                if (legProgress >= 0.9) {
                    return `прибывает к станции ${nextStationTitle}`;
                }
            }

            return `едет до станции ${nextStationTitle}`;
        }

        if (
            Number.isFinite(departureTimestamp) &&
            Number.isFinite(arrivalTimestamp)
        ) {
            if (nowTimestamp <= departureTimestamp + 60_000) {
                return `отправляется со станции ${currentTrain?.from.title ?? ""}`.trim();
            }
            if (nowTimestamp >= arrivalTimestamp - 60_000) {
                return `прибывает к станции ${currentTrain?.to.title ?? ""}`.trim();
            }
        }

        return "едет";
    })();
    const delayDetails = currentTrain ? getTrainDelayLabels(currentTrain) : [];

    const topHiddenIndexes: number[] = [];
    for (let i = 1; i < currentSegment.startIndex; i += 1) {
        topHiddenIndexes.push(i);
    }

    const bottomHiddenIndexes: number[] = [];
    for (let i = currentSegment.endIndex + 1; i < lastStopIndex; i += 1) {
        bottomHiddenIndexes.push(i);
    }

    const mapIndexToStationView = (index: number) => {
        const stop = routeStops[index];
        const isCurrentStart = index === currentSegment.startIndex;
        const isCurrentEnd = index === currentSegment.endIndex;
        const timeValue = isCurrentEnd
            ? (stop?.arrival ?? stop?.departure ?? null)
            : (stop?.departure ?? stop?.arrival ?? null);

        return {
            index,
            title: stop?.station.title ?? "",
            timeLabel: formatStationTime(timeValue),
            isCurrentSegment: isCurrentStart || isCurrentEnd,
        };
    };

    const topHiddenStations = topHiddenIndexes.map(mapIndexToStationView);
    const bottomHiddenStations = bottomHiddenIndexes.map(mapIndexToStationView);
    const firstStation =
        routeStops.length > 0 ? mapIndexToStationView(0) : null;
    const lastStation =
        routeStops.length > 0 ? mapIndexToStationView(lastStopIndex) : null;
    const currentStartStation = mapIndexToStationView(
        currentSegment.startIndex
    );
    const currentEndStation = mapIndexToStationView(currentSegment.endIndex);

    const syncVideoToSegmentProgress = useCallback(() => {
        const video = videoRef.current;

        if (
            !video ||
            !povSyncState ||
            !Number.isFinite(video.duration) ||
            video.duration <= 0
        ) {
            return;
        }

        const maxPlayableTime = Math.min(
            video.duration,
            povSyncState.targetVideoSec
        );
        const drift = maxPlayableTime - video.currentTime;

        if (povSyncState.kind === "after-end") {
            if (Math.abs(drift) > 0.2) {
                video.currentTime = maxPlayableTime;
            }
            video.playbackRate = 1;
            if (!video.paused) {
                video.pause();
            }
            return;
        }

        if (povSyncState.kind !== "active") {
            return;
        }

        const hardSeekThresholdSec = 0.45;
        if (Math.abs(drift) > hardSeekThresholdSec) {
            video.currentTime = maxPlayableTime;
        }

        const minRate = 0.85;
        const maxRate = 1.15;
        const driftCorrectionFactor = 0.35;
        const correctedRate = Math.max(
            minRate,
            Math.min(
                maxRate,
                povSyncState.basePlaybackRate + drift * driftCorrectionFactor
            )
        );

        if (Math.abs(video.playbackRate - correctedRate) > 0.01) {
            video.playbackRate = correctedRate;
        }

        if (video.paused) {
            const playPromise = video.play();
            if (playPromise && typeof playPromise.catch === "function") {
                playPromise.catch(() => {});
            }
        }
    }, [povSyncState]);

    useEffect(() => {
        syncVideoToSegmentProgress();
    }, [syncVideoToSegmentProgress]);

    const renderStationRow = (
        station: {
            index: number;
            title: string;
            timeLabel: string;
            isCurrentSegment: boolean;
        },
        hasConnector: boolean
    ) => (
        <div
            key={`station-${station.index}`}
            className={`relative pl-8 ${hasConnector ? "pb-4" : ""}`}
        >
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
                    <div className="text-sm text-muted-foreground">
                        {station.timeLabel}
                    </div>
                ) : null}
            </div>
        </div>
    );

    const renderToggleRow = (
        key: string,
        label: string,
        onClick: () => void,
        hasConnector: boolean
    ) => (
        <div
            key={key}
            className={`relative pl-8 ${hasConnector ? "pb-4" : ""}`}
        >
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
    );

    type RouteItem =
        | {
              type: "station";
              station: {
                  index: number;
                  title: string;
                  timeLabel: string;
                  isCurrentSegment: boolean;
              };
          }
        | { type: "toggle"; key: string; label: string; onClick: () => void };

    const routeItems: RouteItem[] = [];

    if (firstStation) {
        routeItems.push({ type: "station", station: firstStation });
    }

    if (!expansion.top && topHiddenStations.length > 0) {
        routeItems.push({
            type: "toggle",
            key: "top-expand",
            label: `еще ${topHiddenStations.length} ${getStationsWordForm(
                topHiddenStations.length
            )}`,
            onClick: () => updateExpansion({ top: true }),
        });
    }

    if (expansion.top) {
        for (const station of topHiddenStations) {
            routeItems.push({ type: "station", station });
        }

        if (topHiddenStations.length > 0) {
            routeItems.push({
                type: "toggle",
                key: "top-collapse",
                label: "свернуть",
                onClick: () => updateExpansion({ top: false }),
            });
        }
    }

    if (currentStartStation.index !== 0) {
        routeItems.push({ type: "station", station: currentStartStation });
    }

    if (
        currentEndStation.index !== currentStartStation.index &&
        currentEndStation.index !== lastStopIndex
    ) {
        routeItems.push({ type: "station", station: currentEndStation });
    }

    if (!expansion.bottom && bottomHiddenStations.length > 0) {
        routeItems.push({
            type: "toggle",
            key: "bottom-expand",
            label: `еще ${bottomHiddenStations.length} ${getStationsWordForm(
                bottomHiddenStations.length
            )}`,
            onClick: () => updateExpansion({ bottom: true }),
        });
    }

    if (expansion.bottom) {
        for (const station of bottomHiddenStations) {
            routeItems.push({ type: "station", station });
        }

        if (bottomHiddenStations.length > 0) {
            routeItems.push({
                type: "toggle",
                key: "bottom-collapse",
                label: "свернуть",
                onClick: () => updateExpansion({ bottom: false }),
            });
        }
    }

    if (lastStation) {
        routeItems.push({ type: "station", station: lastStation });
    }

    return (
        <>
            <div
                className={`fixed inset-x-0 bottom-0 z-[1300] flex max-h-[85svh] w-full flex-col overflow-y-auto rounded-t-2xl border border-border bg-card p-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl transition-transform duration-300 md:absolute md:top-2 md:bottom-2 md:left-2 md:inset-x-auto md:max-h-none md:w-[min(24rem,calc(100vw-1.5rem))] md:rounded-xl md:p-5 md:pb-5 lg:top-0 lg:bottom-0 lg:left-0 lg:w-[min(28vw,28rem)] lg:rounded-none lg:border-none lg:shadow-none ${
                    currentTrain
                        ? "pointer-events-auto translate-y-0 md:translate-y-0 md:translate-x-0"
                        : "pointer-events-none translate-y-full md:translate-y-0 md:-translate-x-full"
                }`}
            >
                <button
                    className="absolute top-2 right-2 z-30 flex size-9 items-center justify-center rounded-full bg-card/95 shadow-md"
                    onClick={() => setCurrentTrain(null)}
                    type="button"
                    aria-label="Закрыть train sidebar"
                >
                    <X className="size-4" />
                </button>
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
                    <span
                        style={{
                            color: currentTrain?.thread.transport_subtype
                                ?.color,
                        }}
                    >
                        {currentTrain?.thread.number}
                    </span>
                    <div
                        className="mb-2 w-fit px-2 text-white"
                        style={{
                            background:
                                currentTrain?.thread.transport_subtype?.color,
                        }}
                    >
                        {currentTrain?.thread.transport_subtype?.title}
                    </div>
                </div>
                <header className="mb-1 text-xl">
                    {currentTrain?.thread.title}
                </header>
                <span>В пути уже {passedTimeLabel} из {totalTimeLabel}</span>
                <div className="text-sm text-muted-foreground">
                    {runtimeStatusText}
                </div>
                {delayDetails.length > 0 ? (
                    <div className="mt-2 space-y-1 text-sm">
                        {delayDetails.map((detail) => (
                            <div key={detail} className="text-destructive">
                                {detail}
                            </div>
                        ))}
                    </div>
                ) : null}
                <hr className="my-3" />
                <span className="text-xl">Маршрут</span>
                {isThreadRouteLoading ? (
                    <div className="mt-3 text-sm text-muted-foreground">
                        Загружаем маршрут по станциям...
                    </div>
                ) : null}
                {threadRouteErrorMessage ? (
                    <div className="mt-3 text-sm text-destructive">
                        Не удалось загрузить маршрут по станциям: {threadRouteErrorMessage}
                    </div>
                ) : null}

                <div className="mt-5 pr-1">
                    <div className="relative">
                        {routeItems.map((item, index) => {
                            const hasConnector = index < routeItems.length - 1;
                            if (item.type === "station") {
                                return renderStationRow(
                                    item.station,
                                    hasConnector
                                );
                            }

                            return renderToggleRow(
                                item.key,
                                item.label,
                                item.onClick,
                                hasConnector
                            );
                        })}
                    </div>
                </div>
            </div>
        </>
    );
}
