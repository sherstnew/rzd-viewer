import type { LongDistanceRoute, LongDistanceTrainObject } from "@/lib/long-distance-trains"
import { formatLongDistanceDate, formatLongDistanceTime } from "@/lib/long-distance-trains"
import { ResponsiveSidebarShell } from "@/components/responsive-sidebar-shell"
import { AlertTriangle, CalendarDays, Clock3, MapPin, Route, TrainFront, X } from "lucide-react"

type LongDistanceTrainSidebarProps = {
  train: LongDistanceTrainObject | null
  route: LongDistanceRoute | null
  isLoading: boolean
  error: string | null
  onClose: () => void
}

function formatDelay(minutes: number | null): string | null {
  if (minutes === null || minutes === 0) {
    return null
  }

  return `+${minutes} мин`
}

function stationTimeLine(label: string, date: string | null, time: string | null, delay: number | null) {
  const value = formatLongDistanceTime(date, time)
  if (!value) {
    return null
  }

  const delayLabel = formatDelay(delay)
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-12 text-muted-foreground">{label}</span>
      <span>{value}</span>
      {delayLabel ? <span className="text-destructive">{delayLabel}</span> : null}
    </div>
  )
}

function getRouteDateLabel(route: LongDistanceRoute | null, train: LongDistanceTrainObject | null): string {
  const date = route?.departureDate ?? train?.date ?? null
  return formatLongDistanceDate(date) || "дата неизвестна"
}

export function LongDistanceTrainSidebar({
  train,
  route,
  isLoading,
  error,
  onClose,
}: LongDistanceTrainSidebarProps) {
  const isOpen = Boolean(train)
  const routeTitle = route?.directionLabel ?? "Маршрут загружается..."
  const trainNumber = route?.number ?? train?.number ?? ""
  const stations = route?.stations ?? []
  const traversedCount = stations.filter((station) => station.traversed).length
  const outsideRussiaStations = route?.outsideRussiaStations ?? []

  return (
    <ResponsiveSidebarShell
      open={isOpen}
      onClose={onClose}
      title="сайдбар поезда дальнего следования"
      mobileClassName="border-0 bg-transparent shadow-none"
    >
      <button
        className="absolute top-2 right-2 z-30 flex size-9 items-center justify-center rounded-full bg-card/95 shadow-md"
        onClick={onClose}
        type="button"
        aria-label="Закрыть сайдбар дальнего поезда"
      >
        <X className="size-4" />
      </button>

      <div className="mb-4 flex items-center gap-3 pr-10">
        <div className="flex size-11 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
          <TrainFront className="size-5" />
        </div>
        <div>
          <div className="text-sm text-muted-foreground">Поезд дальнего следования</div>
          <h2 className="text-2xl leading-tight font-semibold">Поезд {trainNumber}</h2>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-background/60 p-4">
        <div className="flex gap-3">
          <Route className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <div className="text-sm text-muted-foreground">Направление</div>
            <div className="font-medium">{routeTitle}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-md bg-muted p-3">
            <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
              <CalendarDays className="size-3.5" />
              Дата
            </div>
            <div>{getRouteDateLabel(route, train)}</div>
          </div>
          <div className="rounded-md bg-muted p-3">
            <div className="mb-1 flex items-center gap-1.5 text-muted-foreground">
              <Clock3 className="size-3.5" />
              Задержка
            </div>
            <div>{route?.delayLabel ?? "нет данных"}</div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="mt-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          Загружаем маршрут РЖД...
        </div>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {outsideRussiaStations.length > 0 ? (
        <div className="mt-4 flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <div className="font-medium">Часть станций маршрута не в РФ</div>
            <div className="mt-1">
              По ним данные могут быть недоступны или неполны, поэтому маршрут и расписание
              показываются только по тому ответу, который удалось получить.
            </div>
            <div className="mt-2 text-xs opacity-80">
              {outsideRussiaStations.slice(0, 4).join(", ")}
              {outsideRussiaStations.length > 4 ? ` и еще ${outsideRussiaStations.length - 4}` : ""}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex items-end justify-between gap-3">
        <div>
          <div className="text-xl font-medium">Маршрут</div>
          {stations.length > 0 ? (
            <div className="text-sm text-muted-foreground">
              {stations.length} остановок
              {traversedCount > 0 ? `, пройдено ${traversedCount}` : ""}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-4 pr-1">
        {stations.length === 0 && !isLoading ? (
          <div className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
            Маршрут пока недоступен.
          </div>
        ) : null}

        <div className="relative">
          {stations.map((station, index) => {
            const isLast = index === stations.length - 1
            const isTraversed = station.traversed
            const isCurrent =
              !isTraversed &&
              (index === 0 || stations[index - 1]?.traversed === true || route?.trainOnRoutePosition === "AT_START")
            const arrivalLine = stationTimeLine(
              "приб.",
              station.arrivalDate,
              station.arrivalTime,
              station.arrivalDelayMinutes,
            )
            const departureLine = stationTimeLine(
              "отпр.",
              station.departureDate,
              station.departureTime,
              station.departureDelayMinutes,
            )

            return (
              <div key={`${station.id}-${index}`} className={`relative pl-8 ${isLast ? "" : "pb-5"}`}>
                {!isLast ? (
                  <div
                    className={`absolute top-4 bottom-0 left-[7px] w-0.5 rounded-full ${
                      isTraversed ? "bg-primary" : "bg-sidebar-ring"
                    }`}
                  />
                ) : null}
                <div
                  className={`absolute top-1 left-0 flex size-4 items-center justify-center rounded-full ${
                    isCurrent ? "bg-primary" : isTraversed ? "bg-primary/70" : "bg-sidebar-ring"
                  }`}
                >
                  <div className="size-2 rounded-full bg-white" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <div className="font-medium leading-snug">{station.name}</div>
                  </div>
                  <div className="space-y-0.5 pl-5">
                    {arrivalLine}
                    {departureLine}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </ResponsiveSidebarShell>
  )
}
