"use client"

type ErrorLike = Error & { digest?: string }

function formatReason(reason: unknown) {
  if (reason instanceof Error) {
    return {
      name: reason.name,
      message: reason.message,
      stack: reason.stack,
      cause: reason.cause,
    }
  }

  return reason
}

function browserContext() {
  return {
    url: window.location.href,
    userAgent: navigator.userAgent,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    buildId: document.documentElement.dataset.nextBuildId ?? null,
  }
}

export function logClientError(scope: string, error: ErrorLike) {
  console.group(scope)
  console.error(error)
  console.info("details", {
    name: error.name,
    message: error.message,
    digest: error.digest ?? null,
    stack: error.stack ?? null,
    cause: error.cause ?? null,
  })
  console.info("context", browserContext())
  console.groupEnd()
}

export function logWindowError(event: ErrorEvent) {
  console.group("[window/error]")
  console.error(event.error ?? event.message)
  console.info("details", {
    message: event.message,
    source: event.filename,
    line: event.lineno,
    column: event.colno,
    error: formatReason(event.error),
  })
  console.info("context", browserContext())
  console.groupEnd()
}

export function logUnhandledRejection(event: PromiseRejectionEvent) {
  console.group("[window/unhandledrejection]")
  console.error(event.reason)
  console.info("details", {
    reason: formatReason(event.reason),
  })
  console.info("context", browserContext())
  console.groupEnd()
}
