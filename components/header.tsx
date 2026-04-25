"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, Bell, Loader2 } from "lucide-react"
import Image from "next/image"

import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

type TrainNotice = {
  direction?: {
    from?: string
    to?: string
  }
  lines?: string[]
}

type DelaysResponse = {
  notices?: TrainNotice[]
}

const NOTICES_REFRESH_MS = 5 * 60_000

const TERMINAL_STATION_BY_CODE: Readonly<Record<string, string>> = {
  s9600731: "Подольск",
  s9601122: "Нахабино",
  s9600721: "Одинцово",
  s9600781: "Лобня",
  s9600212: "Зеленоград-Крюково",
  s9601197: "Ипподром",
  s9601102: "Апрелевка",
  s9601675: "Железнодорожная",
  s2000005: "Москва (Павелецкий вокзал)",
  s9600811: "Домодедово",
  s2000002: "Москва (Ярославский вокзал)",
  s9600701: "Пушкино",
  s9600681: "Мытищи",
  s9602217: "Болшево",
}

function stationLabel(codeOrName: string): string {
  return TERMINAL_STATION_BY_CODE[codeOrName] ?? codeOrName
}

function noticeTitle(notice: TrainNotice): string {
  const from = notice.direction?.from
  const to = notice.direction?.to

  if (from && to) {
    return `${stationLabel(from)} -> ${stationLabel(to)}`
  }

  return "Предупреждение"
}

function normalizeNotices(payload: DelaysResponse): TrainNotice[] {
  if (!Array.isArray(payload.notices)) {
    return []
  }

  return payload.notices
    .map((notice) => ({
      direction: notice.direction,
      lines: Array.isArray(notice.lines)
        ? notice.lines.filter((line) => typeof line === "string" && line.trim().length > 0)
        : [],
    }))
    .filter((notice) => notice.lines.length > 0)
}

export function Header() {
  const [open, setOpen] = useState(false)
  const [notices, setNotices] = useState<TrainNotice[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadNotices() {
      setIsLoading(true)
      try {
        const response = await fetch("/api/trains/delays", { cache: "no-store" })
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string; details?: string }
            | null
          throw new Error(
            payload?.details ?? payload?.error ?? `Request failed with status ${response.status}`,
          )
        }

        const payload = (await response.json()) as DelaysResponse
        if (!cancelled) {
          setNotices(normalizeNotices(payload))
          setError(null)
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : "Не удалось загрузить предупреждения",
          )
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadNotices()
    const interval = window.setInterval(() => {
      void loadNotices()
    }, NOTICES_REFRESH_MS)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  const hasNotices = notices.length > 0
  const statusText = hasNotices
    ? `${notices.length} активных`
    : isLoading
      ? "Обновляем..."
      : "Нет активных"

  return (
    <header className="relative z-50 border-b bg-background/80 backdrop-blur">
      <div className="flex w-full items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <h1 className="flex min-w-0 items-center gap-2 truncate font-serif text-base font-medium sm:text-lg">
          <Image
            src="/leaflet/rzd.svg"
            alt=""
            aria-hidden="true"
            width={32}
            height={14}
            className="h-[0.9rem] w-auto shrink-0 sm:h-[1rem]"
            priority
          />
          <span className="truncate">Карта поездов</span>
        </h1>

        <div className="flex shrink-0 items-center gap-2">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                aria-label="Предупреждения"
                className="relative gap-2 size-10 rounded-full"
              >
                <Bell className="size-4.5" />
                {hasNotices ? (
                  <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-red-500 ring-2 ring-background" />
                ) : null}
              </Button>
            </PopoverTrigger>

            <PopoverContent align="end" className="w-[min(92vw,26rem)] p-0">
              <div className="border-b px-4 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <AlertTriangle className="size-4 text-amber-500" />
                  Предупреждения
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{statusText}</p>
              </div>

              <div className="max-h-[min(65vh,24rem)] overflow-y-auto p-3 sm:max-h-[24rem]">
                {isLoading && !hasNotices ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Обновляем...
                  </div>
                ) : null}

                {error ? (
                  <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </div>
                ) : null}

                {!error && hasNotices ? (
                  <div className="space-y-2">
                    {notices.map((notice, index) => (
                      <article
                        key={`${noticeTitle(notice)}-${index}`}
                        className="rounded-lg border bg-card p-3 shadow-xs"
                      >
                        <h3 className="mb-2 text-xs font-semibold text-muted-foreground">
                          {noticeTitle(notice)}
                        </h3>
                        <div className="space-y-1.5 text-sm leading-snug text-foreground/90">
                          {notice.lines?.map((line, lineIndex) => (
                            <p key={`${line}-${lineIndex}`}>{line}</p>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}

                {!error && !isLoading && !hasNotices ? (
                  <div className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
                    Сейчас предупреждений нет
                  </div>
                ) : null}
              </div>
            </PopoverContent>
          </Popover>

          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
