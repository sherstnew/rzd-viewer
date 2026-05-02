"use client"

import { RotateCcw } from "lucide-react"
import { resetPersistedAppStores } from "@/lib/app-reset"
import { useEffect } from "react"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[app/error]", error)
  }, [error])

  return (
    <main className="flex min-h-0 flex-1 items-center justify-center bg-background px-4 py-8 text-foreground">
      <section className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg">
        <h1 className="mt-2 text-2xl font-semibold leading-tight">
          Произошла небольшая ошибка!
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Попробуйте обновить страницу или нажмите на кнопку сброса.
        </p>
        {error.digest ? (
          <p className="mt-3 break-all text-xs text-muted-foreground">
            Код ошибки: {error.digest}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          <button
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
            type="button"
            onClick={() => {
              resetPersistedAppStores()
              window.location.reload()
            }}
          >
            <RotateCcw className="size-4" />
            Сбросить данные и обновить
          </button>
          <button
            className="inline-flex h-9 items-center justify-center rounded-md border border-border px-3 text-sm font-medium transition-colors hover:bg-muted"
            type="button"
            onClick={reset}
          >
            Повторить без сброса
          </button>
        </div>
      </section>
    </main>
  )
}
