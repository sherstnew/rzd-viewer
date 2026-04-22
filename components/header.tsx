import { ThemeToggle } from "@/components/theme-toggle"

export function Header() {
  return (
    <header className="border-b bg-background/80 backdrop-blur">
      <div className="flex w-full items-center justify-between px-6 py-4">
        <h1 className="font-serif text-lg font-semibold tracking-tight">Поезда поезда</h1>
        <ThemeToggle />
      </div>
    </header>
  )
}
