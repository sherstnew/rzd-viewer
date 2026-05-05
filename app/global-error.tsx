"use client"

import { RotateCcw } from "lucide-react"
import { resetPersistedAppStores } from "@/lib/app-reset"
import { logClientError } from "@/lib/client-error-logging"
import { useEffect } from "react"

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logClientError("[app/global-error]", error)
  }, [error])

  return (
    <html lang="ru">
      <body>
        <main className="flex min-h-svh items-center justify-center bg-background px-4 py-8 text-foreground">
          <section className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg">
            <div className="text-sm font-medium text-primary">
              Критическая ошибка
            </div>
            <h1 className="mt-2 text-2xl font-semibold leading-tight">
              Приложение не смогло запуститься
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Очистите локальные данные приложения и загрузите страницу заново.
            </p>
            {error.digest ? (
              <p className="mt-3 break-all text-xs text-muted-foreground">
                Код ошибки: {error.digest}
              </p>
            ) : null}
            <button
              className="mt-5 inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
              type="button"
              onClick={() => {
                resetPersistedAppStores()
                window.location.reload()
              }}
            >
              <RotateCcw className="size-4" />
              Сбросить данные и обновить
            </button>
          </section>
        </main>
      </body>
    </html>
  )
}
