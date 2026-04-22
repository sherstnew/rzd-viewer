"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { GitCommitHorizontal, Search, TrainFront } from "lucide-react";
import stationsData from "@/jsons/stations.json";
import { getNow } from "@/lib/runtime-mode";
import { formatTrainDelay } from "@/lib/train-delays";
import type { Train } from "@/lib/trains";
import { useCurrentTrainStore } from "@/stores/currentTrainStore";
import { useTrainsStore } from "@/stores/trainsStore";
import {
    InputGroup,
    InputGroupAddon,
    InputGroupInput,
} from "@/components/ui/input-group";

type StationSearchItem = {
    key: string;
    title: string;
    direction: string | null;
};

type SearchResult =
    | {
          type: "station";
          key: string;
          title: string;
          subtitle: string | null;
          stationTitle: string;
      }
    | {
          type: "train";
          key: string;
          title: string;
          subtitle: string;
          train: Train;
      };

const MAX_VISIBLE_RESULTS = 8;

function toSearchValue(value: string): string {
    return value.trim().toLowerCase();
}

function pluralizeResults(count: number): string {
    const mod10 = count % 10;
    const mod100 = count % 100;

    if (mod10 === 1 && mod100 !== 11) {
        return `${count} результат`;
    }

    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
        return `${count} результата`;
    }

    return `${count} результатов`;
}

function parseStations(): StationSearchItem[] {
    if (!Array.isArray(stationsData)) {
        return [];
    }

    const seen = new Set<string>();
    const stations: StationSearchItem[] = [];

    for (const station of stationsData) {
        if (!station || typeof station !== "object") {
            continue;
        }

        const stationRecord = station as Record<string, unknown>;
        if (
            stationRecord.transport_type !== "train" ||
            typeof stationRecord.title !== "string"
        ) {
            continue;
        }

        const title = stationRecord.title.trim();
        if (!title || seen.has(title)) {
            continue;
        }

        seen.add(title);
        stations.push({
            key: title,
            title,
            direction:
                typeof stationRecord.direction === "string" &&
                stationRecord.direction.trim()
                    ? stationRecord.direction.trim()
                    : null,
        });
    }

    return stations;
}

function trainKey(train: Train): string {
    return `${train.thread.uid}__${train.departure}__${train.arrival}`;
}

function isTrainRunningNow(train: Train, timestamp: number): boolean {
    const departureTimestamp = new Date(train.departure).getTime();
    const arrivalTimestamp = new Date(train.arrival).getTime();

    return (
        Boolean(train.mcd_route_id) &&
        Number.isFinite(departureTimestamp) &&
        Number.isFinite(arrivalTimestamp) &&
        departureTimestamp <= timestamp &&
        timestamp <= arrivalTimestamp
    );
}

const stationSearchItems = parseStations();

export function SearchBox() {
    const [query, setQuery] = useState("");
    const [isOpen, setIsOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement | null>(null);
    const segments = useTrainsStore((state) => state.segments);
    const clockMode = useTrainsStore((state) => state.clockMode);
    const routeStationTitles = useCurrentTrainStore(
        (state) => state.routeStationTitles
    );
    const setCurrentTrain = useCurrentTrainStore(
        (state) => state.setCurrentTrain
    );
    const setCurrentStationTitle = useCurrentTrainStore(
        (state) => state.setCurrentStationTitle
    );
    const normalizedQuery = toSearchValue(query);
    const currentTimestamp = getNow(clockMode).getTime();
    const routeStationTitleSet = useMemo(
        () => new Set(routeStationTitles.map(toSearchValue)),
        [routeStationTitles]
    );

    const results = useMemo<SearchResult[]>(() => {
        if (!normalizedQuery) {
            return [];
        }

        const stationResults: SearchResult[] = stationSearchItems
            .filter((station) => {
                const stationTitle = toSearchValue(station.title);
                return (
                    routeStationTitleSet.has(stationTitle) &&
                    stationTitle.includes(normalizedQuery)
                );
            })
            .map((station) => ({
                type: "station",
                key: `station-${station.key}`,
                title: station.title,
                subtitle: station.direction,
                stationTitle: station.title,
            }));

        const trainResults: SearchResult[] = segments
            .filter(
                (train) =>
                    isTrainRunningNow(train, currentTimestamp) &&
                    toSearchValue(train.thread.number).includes(normalizedQuery)
            )
            .map((train) => ({
                type: "train",
                key: `train-${trainKey(train)}`,
                title: train.thread.number,
                subtitle: train.thread.title,
                train,
            }));

        return [...stationResults, ...trainResults];
    }, [currentTimestamp, normalizedQuery, routeStationTitleSet, segments]);

    const visibleResults = results.slice(0, MAX_VISIBLE_RESULTS);

    useEffect(() => {
        function handlePointerDown(event: PointerEvent) {
            if (
                !rootRef.current ||
                rootRef.current.contains(event.target as Node)
            ) {
                return;
            }

            setIsOpen(false);
        }

        document.addEventListener("pointerdown", handlePointerDown);

        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
        };
    }, []);

    return (
        <div
            ref={rootRef}
            className="absolute top-3 right-5 z-200 w-80 max-w-[calc(100vw-2.5rem)]"
        >
            <InputGroup>
                <InputGroupInput
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onFocus={() => setIsOpen(true)}
                    onClick={() => setIsOpen(true)}
                    placeholder="Поиск"
                    aria-label="Поиск станций и поездов"
                />
                <InputGroupAddon>
                    <Search />
                </InputGroupAddon>
                {results.length > 0 ? (
                    <InputGroupAddon align="inline-end">
                        {pluralizeResults(results.length)}
                    </InputGroupAddon>
                ) : null}
            </InputGroup>

            {normalizedQuery && isOpen ? (
                <div className="mt-2 overflow-hidden rounded-md border bg-card/50 shadow-lg backdrop-blur-xl">
                    {visibleResults.length > 0 ? (
                        <div className="max-h-80 overflow-y-auto">
                            {visibleResults.map((result) => {
                                const Icon =
                                    result.type === "train"
                                        ? TrainFront
                                        : GitCommitHorizontal;
                                const delayLabel =
                                    result.type === "train"
                                        ? formatTrainDelay(result.train)
                                        : null;

                                return (
                                    <button
                                        type="button"
                                        key={result.key}
                                        className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                                        onClick={() => {
                                            if (result.type === "train") {
                                                setCurrentStationTitle(null);
                                                setCurrentTrain(result.train);
                                                return;
                                            }

                                            setCurrentTrain(null);
                                            setCurrentStationTitle(
                                                result.stationTitle
                                            );
                                        }}
                                    >
                                        <Icon className="size-4 shrink-0 text-muted-foreground" />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <div className="truncate font-medium">
                                                    {result.title}
                                                </div>
                                                {delayLabel ? (
                                                    <span className="shrink-0 text-xs text-destructive">
                                                        {delayLabel}
                                                    </span>
                                                ) : null}
                                            </div>
                                            {result.subtitle ? (
                                                <div className="truncate text-xs text-muted-foreground">
                                                    {result.subtitle}
                                                </div>
                                            ) : null}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                            Ничего не найдено
                        </div>
                    )}
                </div>
            ) : null}
        </div>
    );
}
