"use client";

import { ResponsiveSidebarShell } from "@/components/responsive-sidebar-shell";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent } from "react";

type StationScheduleItem = {
    key: string;
    timestamp: number;
    arrivalTimeLabel: string | null;
    departureTimeLabel: string | null;
    arrivalDelayLabel: string | null;
    departureDelayLabel: string | null;
    trainNumber: string;
    trainTitle: string;
    routeLabel: string;
};

export type StationPhotoItem = {
    imageUrl: string;
    photoPageUrl: string;
    caption: string;
};

type StationSidebarProps = {
    station: {
        title: string;
        direction: string | null;
        esrCode: string | null;
    } | null;
    schedule: StationScheduleItem[];
    photos: StationPhotoItem[];
    isPhotosLoading: boolean;
    onClose: () => void;
};

function stationPhotoImageProxyUrl(
    photo: StationPhotoItem,
    stationScope: string,
    index: number
): string {
    if (photo.imageUrl.startsWith("/")) {
        return photo.imageUrl;
    }

    let filename = "photo";
    try {
        filename =
            new URL(photo.imageUrl).pathname.split("/").filter(Boolean).pop() ??
            filename;
    } catch {
        filename = photo.imageUrl.slice(-24) || filename;
    }

    const cacheKey = encodeURIComponent(`${stationScope}-${index}-${filename}`);
    return `/api/stations/photos/image/${cacheKey}?src=${encodeURIComponent(photo.imageUrl)}`;
}

export function StationSidebar({
    station,
    schedule,
    photos,
    isPhotosLoading,
    onClose,
}: StationSidebarProps) {
    const [isDesktop, setIsDesktop] = useState(false);
    const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
    const [isLightboxOpen, setIsLightboxOpen] = useState(false);
    const [isCurrentImageLoading, setIsCurrentImageLoading] = useState(true);
    const [isLightboxImageLoading, setIsLightboxImageLoading] = useState(true);

    const isOpen = Boolean(station);
    const visibleStation = station;
    const visibleSchedule = schedule;
    const visiblePhotos = photos;
    const visibleIsPhotosLoading = isPhotosLoading;

    const closeLightbox = () => {
        setIsLightboxOpen(false);
        setIsLightboxImageLoading(true);
    };

    const handleLightboxDismiss = (event: MouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        closeLightbox();
    };

    useEffect(() => {
        const mediaQuery = window.matchMedia("(min-width: 768px)");
        const updateDesktopState = () => {
            setIsDesktop(mediaQuery.matches);
        };

        updateDesktopState();
        mediaQuery.addEventListener("change", updateDesktopState);

        return () => {
            mediaQuery.removeEventListener("change", updateDesktopState);
        };
    }, []);

    useEffect(() => {
        const resetId = window.setTimeout(() => {
            setCurrentPhotoIndex(0);
            setIsLightboxOpen(false);
            setIsCurrentImageLoading(true);
            setIsLightboxImageLoading(true);
        }, 0);

        return () => {
            window.clearTimeout(resetId);
        };
    }, [visibleStation?.title, visiblePhotos.length]);

    useEffect(() => {
        if (isDesktop || !isLightboxOpen) {
            return;
        }

        const closeId = window.setTimeout(() => {
            setIsLightboxOpen(false);
            setIsLightboxImageLoading(true);
        }, 0);

        return () => {
            window.clearTimeout(closeId);
        };
    }, [isDesktop, isLightboxOpen]);

    const currentPhoto = useMemo(() => {
        if (visiblePhotos.length === 0) {
            return null;
        }

        return visiblePhotos[
            Math.min(currentPhotoIndex, visiblePhotos.length - 1)
        ];
    }, [currentPhotoIndex, visiblePhotos]);

    useEffect(() => {
        if (!isLightboxOpen || visiblePhotos.length === 0) {
            return;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setIsLightboxOpen(false);
                return;
            }

            if (event.key === "ArrowLeft") {
                setCurrentPhotoIndex(
                    (prev) =>
                        (prev - 1 + visiblePhotos.length) %
                        visiblePhotos.length
                );
                setIsCurrentImageLoading(true);
                setIsLightboxImageLoading(true);
                return;
            }

            if (event.key === "ArrowRight") {
                setCurrentPhotoIndex(
                    (prev) => (prev + 1) % visiblePhotos.length
                );
                setIsCurrentImageLoading(true);
                setIsLightboxImageLoading(true);
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [isLightboxOpen, visiblePhotos.length]);

    useEffect(() => {
        if (!isLightboxOpen) {
            return;
        }

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [isLightboxOpen]);

    const canNavigatePhotos = visiblePhotos.length > 1;
    const stationImageScope = visibleStation
        ? (visibleStation.esrCode ?? visibleStation.title)
        : "";
    const currentImageUrl = currentPhoto
        ? stationPhotoImageProxyUrl(
              currentPhoto,
              stationImageScope,
              currentPhotoIndex
          )
        : null;

    useEffect(() => {
        const resetId = window.setTimeout(() => {
            setIsCurrentImageLoading(Boolean(currentImageUrl));
            setIsLightboxImageLoading(Boolean(currentImageUrl));
        }, 0);

        return () => {
            window.clearTimeout(resetId);
        };
    }, [currentImageUrl]);

    if (!visibleStation) {
        return null;
    }

    return (
        <>
            <ResponsiveSidebarShell
                open={isOpen}
                onClose={onClose}
                title="сайдбар станции"
                mobileClassName="border-0 bg-transparent shadow-none"
            >
                <button
                    className="absolute top-2 right-2 z-30 flex size-9 items-center justify-center rounded-full bg-card/95 shadow-md"
                    onClick={onClose}
                    type="button"
                    aria-label="Закрыть station sidebar"
                >
                    <X className="size-4" />
                </button>
                <div className="w-full min-w-0">
                    {visibleIsPhotosLoading ? (
                        <div className="flex h-52 w-full items-center justify-center rounded-xl border border-border bg-muted/20">
                            <div className="size-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
                        </div>
                    ) : currentPhoto && currentImageUrl ? (
                        <div className="w-full space-y-2">
                            <div className="relative overflow-hidden rounded-xl border border-border bg-muted/20">
                                {isCurrentImageLoading ? (
                                    <div className="absolute inset-0 flex items-center justify-center bg-card/45">
                                        <div className="size-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
                                    </div>
                                ) : null}
                                <button
                                    className={`block h-56 w-full ${isDesktop ? "cursor-zoom-in" : "cursor-default"}`}
                                    type="button"
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        if (!isDesktop) {
                                            return;
                                        }
                                        setIsLightboxOpen(true);
                                        setIsLightboxImageLoading(true);
                                    }}
                                >
                                    <img
                                        key={currentImageUrl}
                                        src={currentImageUrl}
                                        alt={`Фото станции ${visibleStation.title}`}
                                        className="h-56 w-full object-cover"
                                        loading="lazy"
                                        onLoad={() =>
                                            setIsCurrentImageLoading(false)
                                        }
                                        onError={() =>
                                            setIsCurrentImageLoading(false)
                                        }
                                    />
                                </button>

                                {canNavigatePhotos ? (
                                    <>
                                        <button
                                            className="absolute top-1/2 left-2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-card/95 shadow-md"
                                            type="button"
                                            onClick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                setCurrentPhotoIndex(
                                                    (prev) =>
                                                        (prev -
                                                            1 +
                                                            visiblePhotos.length) %
                                                        visiblePhotos.length
                                                );
                                                setIsCurrentImageLoading(true);
                                                setIsLightboxImageLoading(true);
                                            }}
                                        >
                                            <ChevronLeft className="size-5" />
                                        </button>
                                        <button
                                            className="absolute top-1/2 right-2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-card/95 shadow-md"
                                            type="button"
                                            onClick={(event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                setCurrentPhotoIndex(
                                                    (prev) =>
                                                        (prev + 1) %
                                                        visiblePhotos.length
                                                );
                                                setIsCurrentImageLoading(true);
                                                setIsLightboxImageLoading(true);
                                            }}
                                        >
                                            <ChevronRight className="size-5" />
                                        </button>
                                    </>
                                ) : null}
                            </div>

                            <div className="flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
                                <span>
                                    Фото {currentPhotoIndex + 1} из{" "}
                                    {visiblePhotos.length}
                                </span>
                                <a
                                    href={currentPhoto.photoPageUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="underline hover:no-underline break-all text-right"
                                >
                                    Открыть на Railwayz
                                </a>
                            </div>
                        </div>
                    ) : (
                        <div className="text-sm text-muted-foreground">
                            Фото недоступны
                        </div>
                    )}
                </div>
                <header className="text-xl mt-3 break-words">
                    {visibleStation.title}
                </header>
                <div className="text-sm text-muted-foreground break-words">
                    Направление: {visibleStation.direction ?? "нет данных"}
                </div>
                <hr className="my-3" />

                <span className="text-xl">Расписание на 1 час:</span>
                {visibleSchedule.length === 0 ? (
                    <div className="mt-2 text-sm text-muted-foreground">
                        Нет поездов в ближайший час
                    </div>
                ) : (
                    <div className="mt-2 space-y-3">
                        {visibleSchedule.map((item) => (
                            <div
                                key={item.key}
                                className="rounded-lg border border-border p-3"
                            >
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                                    {item.arrivalTimeLabel ? (
                                        <span>
                                            Прибытие:{" "}
                                            <span className="font-normal">
                                                {item.arrivalTimeLabel}
                                            </span>
                                            {item.arrivalDelayLabel ? (
                                                <span className="ml-1 text-xs text-destructive">
                                                    {item.arrivalDelayLabel}
                                                </span>
                                            ) : null}
                                        </span>
                                    ) : null}
                                    {item.departureTimeLabel ? (
                                        <span>
                                            Отправление:{" "}
                                            <span className="font-normal">
                                                {item.departureTimeLabel}
                                            </span>
                                            {item.departureDelayLabel ? (
                                                <span className="ml-1 text-xs text-destructive">
                                                    {item.departureDelayLabel}
                                                </span>
                                            ) : null}
                                        </span>
                                    ) : null}
                                </div>
                                <div className="mt-1 font-medium">
                                    {item.trainNumber} {item.trainTitle}
                                </div>
                                <div className="text-sm text-muted-foreground break-words">
                                    {item.routeLabel}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                {visibleStation.esrCode ? (
                    <div className="mt-2 text-sm text-muted-foreground break-all">
                        ESR код: {visibleStation.esrCode}
                    </div>
                ) : null}
            </ResponsiveSidebarShell>

            {isLightboxOpen && currentPhoto && currentImageUrl ? (
                <div
                    className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 p-4"
                    role="dialog"
                    aria-modal="true"
                    onClick={handleLightboxDismiss}
                >
                    <div
                        className="relative w-full max-w-4xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <button
                            className="absolute top-3 right-3 z-20 rounded-full bg-card px-3 py-1 text-sm shadow-md"
                            type="button"
                            onClick={handleLightboxDismiss}
                        >
                            Закрыть
                        </button>

                        <div className="relative h-[80vh] max-h-[42rem] min-h-[18rem] w-full overflow-hidden rounded-lg bg-black/20">
                            {isLightboxImageLoading ? (
                                <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                                    <div className="size-10 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                                </div>
                            ) : null}
                            <img
                                key={currentImageUrl}
                                src={currentImageUrl}
                                alt={`Фото станции ${visibleStation.title}`}
                                className={`absolute inset-0 h-full w-full object-contain transition-opacity ${isLightboxImageLoading ? "opacity-0" : "opacity-100"}`}
                                onLoad={() => setIsLightboxImageLoading(false)}
                                onError={() => setIsLightboxImageLoading(false)}
                            />
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-2 text-sm text-white">
                            <span>
                                Фото {currentPhotoIndex + 1} из{" "}
                                {visiblePhotos.length}
                            </span>
                            <a
                                href={currentPhoto.photoPageUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="underline hover:no-underline"
                            >
                                Открыть страницу фото
                            </a>
                        </div>

                        {canNavigatePhotos ? (
                            <>
                                <button
                                    className="absolute top-1/2 left-2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-card/95"
                                    type="button"
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setCurrentPhotoIndex(
                                            (prev) =>
                                                (prev -
                                                    1 +
                                                    visiblePhotos.length) %
                                                visiblePhotos.length
                                        );
                                        setIsCurrentImageLoading(true);
                                        setIsLightboxImageLoading(true);
                                    }}
                                >
                                    <ChevronLeft className="size-6" />
                                </button>
                                <button
                                    className="absolute top-1/2 right-2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-card/95"
                                    type="button"
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setCurrentPhotoIndex(
                                            (prev) =>
                                                (prev + 1) %
                                                visiblePhotos.length
                                        );
                                        setIsCurrentImageLoading(true);
                                        setIsLightboxImageLoading(true);
                                    }}
                                >
                                    <ChevronRight className="size-6" />
                                </button>
                            </>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </>
    );
}
