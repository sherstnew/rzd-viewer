"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type StationScheduleItem = {
    key: string;
    timestamp: number;
    arrivalTimeLabel: string | null;
    departureTimeLabel: string | null;
    trainNumber: string;
    trainTitle: string;
    routeLabel: string;
};

export type StationPhotoItem = {
    thumbUrl: string;
    photoPageUrl: string;
    fullImageUrl: string | null;
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

function toDisplayImageUrl(photo: StationPhotoItem): string {
    const source = photo.fullImageUrl ?? photo.thumbUrl;
    return source.replace(/_s(?=\.(?:webp|jpg|jpeg|png|gif)(?:\?|$))/i, "");
}

export function StationSidebar({
    station,
    schedule,
    photos,
    isPhotosLoading,
    onClose,
}: StationSidebarProps) {
    const [currentPhotoIndex, setCurrentPhotoIndex] = useState(0);
    const [isLightboxOpen, setIsLightboxOpen] = useState(false);
    const [isCurrentImageLoading, setIsCurrentImageLoading] = useState(true);
    const [isLightboxImageLoading, setIsLightboxImageLoading] = useState(true);

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
    }, [station?.title, photos.length]);

    const currentPhoto = useMemo(() => {
        if (photos.length === 0) {
            return null;
        }

        return photos[Math.min(currentPhotoIndex, photos.length - 1)];
    }, [currentPhotoIndex, photos]);

    useEffect(() => {
        if (!isLightboxOpen || photos.length === 0) {
            return;
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setIsLightboxOpen(false);
                return;
            }

            if (event.key === "ArrowLeft") {
                setCurrentPhotoIndex(
                    (prev) => (prev - 1 + photos.length) % photos.length
                );
                setIsCurrentImageLoading(true);
                setIsLightboxImageLoading(true);
                return;
            }

            if (event.key === "ArrowRight") {
                setCurrentPhotoIndex((prev) => (prev + 1) % photos.length);
                setIsCurrentImageLoading(true);
                setIsLightboxImageLoading(true);
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [isLightboxOpen, photos.length]);

    if (!station) {
        return null;
    }

    const canNavigatePhotos = photos.length > 1;
    const currentImageUrl = currentPhoto
        ? toDisplayImageUrl(currentPhoto)
        : null;
    const currentPreviewImageUrl = currentPhoto?.thumbUrl ?? null;

    return (
        <>
            <div className="absolute top-0 left-0 z-1200 flex h-full w-full max-w-full translate-x-0 flex-col overflow-x-hidden overflow-y-auto bg-card p-4 transition sm:p-5 lg:w-1/4">
                <button
                    className="absolute top-3 right-3 z-30 flex size-9 items-center justify-center rounded-full bg-card/95 shadow-md"
                    onClick={onClose}
                    type="button"
                    aria-label="Закрыть station sidebar"
                >
                    <X className="size-4" />
                </button>
                <div className="min-w-0 pr-8">
                    {isPhotosLoading ? (
                        <div className="flex h-52 items-center justify-center rounded-xl border border-border bg-muted/20">
                            <div className="size-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
                        </div>
                    ) : currentPhoto && currentImageUrl ? (
                        <div className="space-y-2">
                            <div className="relative overflow-hidden rounded-xl border border-border bg-muted/20">
                                {isCurrentImageLoading ? (
                                    <div className="absolute inset-0 flex items-center justify-center bg-card/45">
                                        <div className="size-8 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
                                    </div>
                                ) : null}
                                <button
                                    className="block h-56 w-full cursor-zoom-in"
                                    type="button"
                                    onClick={() => {
                                        setIsLightboxOpen(true);
                                        setIsLightboxImageLoading(true);
                                    }}
                                >
                                    {isCurrentImageLoading &&
                                    currentPreviewImageUrl ? (
                                        <img
                                            src={currentPreviewImageUrl}
                                            alt={`Превью станции ${station.title}`}
                                            className="absolute inset-0 h-56 w-full object-cover"
                                            loading="lazy"
                                        />
                                    ) : null}
                                    <img
                                        src={currentImageUrl}
                                        alt={`Фото станции ${station.title}`}
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
                                            onClick={() => {
                                                setCurrentPhotoIndex(
                                                    (prev) =>
                                                        (prev -
                                                            1 +
                                                            photos.length) %
                                                        photos.length
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
                                            onClick={() => {
                                                setCurrentPhotoIndex(
                                                    (prev) =>
                                                        (prev + 1) %
                                                        photos.length
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
                                    {photos.length}
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
                    {station.title}
                </header>
                <div className="text-sm text-muted-foreground break-words">
                    Направление: {station.direction ?? "нет данных"}
                </div>
                <hr className="my-3" />

                <span className="text-xl">Расписание на 3 часа:</span>
                {schedule.length === 0 ? (
                    <div className="mt-2 text-sm text-muted-foreground">
                        Нет поездов в ближайшие три часа
                    </div>
                ) : (
                    <div className="mt-2 space-y-3">
                        {schedule.map((item) => (
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
                                        </span>
                                    ) : null}
                                    {item.departureTimeLabel ? (
                                        <span>
                                            Отправление:{" "}
                                            <span className="font-normal">
                                                {item.departureTimeLabel}
                                            </span>
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
                {station.esrCode ? (
                    <div className="mt-2 text-sm text-muted-foreground break-all">
                        ESR код: {station.esrCode}
                    </div>
                ) : null}
            </div>

            {isLightboxOpen && currentPhoto && currentImageUrl ? (
                <div
                    className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80 p-4"
                    role="dialog"
                    aria-modal="true"
                    onClick={() => setIsLightboxOpen(false)}
                >
                    <div
                        className="relative max-h-full w-full max-w-4xl"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <button
                            className="absolute top-2 right-2 z-10 rounded-full bg-card px-3 py-1 text-sm"
                            type="button"
                            onClick={() => setIsLightboxOpen(false)}
                        >
                            Закрыть
                        </button>

                        {isLightboxImageLoading ? (
                            <div className="relative flex h-[50vh] w-full items-center justify-center rounded-lg bg-black/20">
                                {currentPreviewImageUrl ? (
                                    <img
                                        src={currentPreviewImageUrl}
                                        alt={`Превью станции ${station.title}`}
                                        className="absolute inset-0 h-full w-full object-contain opacity-70"
                                        loading="lazy"
                                    />
                                ) : null}
                                <div className="size-10 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                            </div>
                        ) : null}
                        <img
                            src={currentImageUrl}
                            alt={`Фото станции ${station.title}`}
                            className={`max-h-[80vh] w-full rounded-lg object-contain ${isLightboxImageLoading ? "hidden" : ""}`}
                            onLoad={() => setIsLightboxImageLoading(false)}
                            onError={() => setIsLightboxImageLoading(false)}
                        />

                        <div className="mt-2 flex items-center justify-between gap-2 text-sm text-white">
                            <span>
                                Фото {currentPhotoIndex + 1} из {photos.length}
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
                                    onClick={() => {
                                        setCurrentPhotoIndex(
                                            (prev) =>
                                                (prev - 1 + photos.length) %
                                                photos.length
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
                                    onClick={() => {
                                        setCurrentPhotoIndex(
                                            (prev) => (prev + 1) % photos.length
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
