"use client"

import { type ReactNode, useEffect, useState } from "react"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { cn } from "@/lib/utils"

type ResponsiveSidebarShellProps = {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  desktopClassName?: string
  mobileClassName?: string
}

const DESKTOP_PANEL_CLASSES =
  "hidden md:flex fixed top-2 bottom-2 left-2 z-[1300] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-2xl transition-transform duration-300 lg:top-0 lg:bottom-0 lg:left-0 lg:w-[min(28vw,28rem)] lg:rounded-none lg:border-none lg:shadow-none"

const MOBILE_PANEL_CLASSES =
  "flex max-h-[85svh] w-full flex-col overflow-y-auto rounded-t-2xl border border-border bg-card p-5 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl"

export function ResponsiveSidebarShell({
  open,
  onClose,
  title,
  children,
  desktopClassName,
  mobileClassName,
}: ResponsiveSidebarShellProps) {
  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 768px)")
    const updateDesktopState = () => {
      setIsDesktop(mediaQuery.matches)
    }

    updateDesktopState()
    mediaQuery.addEventListener("change", updateDesktopState)

    return () => {
      mediaQuery.removeEventListener("change", updateDesktopState)
    }
  }, [])

  return (
    <>
      <button
        type="button"
        aria-label={`Закрыть ${title}`}
        className={cn(
          "hidden md:block fixed inset-0 z-[1290] bg-black/10 transition-opacity",
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
      />

      <div
        className={cn(
          DESKTOP_PANEL_CLASSES,
          open ? "pointer-events-auto translate-x-0" : "pointer-events-none -translate-x-full",
          desktopClassName,
        )}
      >
        {children}
      </div>

      <Drawer open={!isDesktop && open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
        <DrawerContent className={cn("p-0", mobileClassName)}>
          <DrawerTitle className="sr-only">{title}</DrawerTitle>
          <div className={MOBILE_PANEL_CLASSES}>{children}</div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
