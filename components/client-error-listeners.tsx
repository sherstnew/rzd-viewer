"use client"

import { useEffect } from "react"

import { logUnhandledRejection, logWindowError } from "@/lib/client-error-logging"

export function ClientErrorListeners() {
  useEffect(() => {
    window.addEventListener("error", logWindowError)
    window.addEventListener("unhandledrejection", logUnhandledRejection)

    return () => {
      window.removeEventListener("error", logWindowError)
      window.removeEventListener("unhandledrejection", logUnhandledRejection)
    }
  }, [])

  return null
}
