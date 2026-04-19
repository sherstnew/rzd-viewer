'use client'

import dynamic from "next/dynamic"

const MapExample = dynamic(
  () => import("@/components/map-example").then((mod) => mod.MapExample),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-muted text-sm text-muted-foreground">
        Загружаем карту...
      </div>
    ),
  },
)

export default function Page() {
  return (
    <main className="flex w-full flex-col gap-6 flex-1">
        <MapExample />
    </main>
  )
}
