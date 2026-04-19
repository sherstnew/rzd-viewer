"use client"

import { useMemo, useSyncExternalStore } from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"

const themeOrder = ["light", "dark"] as const
type ThemeValue = (typeof themeOrder)[number]

export function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  const currentTheme: ThemeValue = useMemo(() => {
    if (theme === "light" || theme === "dark") {
      return theme
    }
    return "light"
  }, [theme])

  function handleToggle() {
    const currentIndex = themeOrder.indexOf(currentTheme)
    const nextTheme = themeOrder[(currentIndex + 1) % themeOrder.length]
    setTheme(nextTheme)
  }

  const visualTheme = isClient
    ? resolvedTheme === "dark"
      ? "dark"
      : "light"
    : "light"

  return (
    <Button variant="outline" onClick={handleToggle} className="gap-2 size-10 rounded-full">
      {visualTheme === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
    </Button>
  )
}
