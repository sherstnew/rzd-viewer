import localFont from "next/font/local"
import { Inter } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { Header } from "@/components/header"
import { cn } from "@/lib/utils"

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  variable: "--font-inter",
  display: "swap",
})

const russianRailSerif = localFont({
  src: [
    {
      path: "../public/fonts/RussianRail G Regular.otf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/RussianRail G Pro Medium.otf",
      weight: "500",
      style: "normal",
    },
    {
      path: "../public/fonts/RussianRail G Pro Bold.otf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-rzd-serif",
  display: "swap",
})

const russianRailHeading = localFont({
  src: [
    {
      path: "../public/fonts/RussianRail G Pro Extend.otf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../public/fonts/RussianRail G Pro Extended Bold.otf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-rzd-heading",
  display: "swap",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "antialiased",
        "font-sans",
        inter.variable,
        russianRailSerif.variable,
        russianRailHeading.variable
      )}
    >
      <body>
        <ThemeProvider>
          <div className="flex h-svh flex-col bg-background text-foreground">
            <Header />
            {children}
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
