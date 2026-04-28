import { NextRequest, NextResponse } from "next/server"
import { fetchBufferWithProxy } from "@/lib/proxy-http"

const ALLOWED_HOSTS = new Set(["railwayz.info", "www.railwayz.info"])
const IMAGE_FETCH_TIMEOUT_MS = 15_000
const DEFAULT_CONTENT_TYPE = "application/octet-stream"

function getAllowedRailwayzImageUrl(rawUrl: string | null): URL | null {
  if (!rawUrl) {
    return null
  }

  try {
    const url = new URL(rawUrl)
    if (!ALLOWED_HOSTS.has(url.hostname)) {
      return null
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null
    }

    return url
  } catch {
    return null
  }
}

export async function GET(request: NextRequest) {
  const upstreamUrl = getAllowedRailwayzImageUrl(request.nextUrl.searchParams.get("src"))
  if (!upstreamUrl) {
    return NextResponse.json({ error: "Invalid Railwayz image URL" }, { status: 400 })
  }

  try {
    const response = await fetchBufferWithProxy(upstreamUrl, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
        Referer: "https://railwayz.info/photolines/",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      },
      timeoutMs: IMAGE_FETCH_TIMEOUT_MS,
      useProxy: false,
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch Railwayz image" },
        { status: response.status >= 400 ? response.status : 502 },
      )
    }

    return new NextResponse(new Uint8Array(response.buffer), {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
        "Content-Type":
          typeof response.headers["content-type"] === "string"
            ? response.headers["content-type"]
            : DEFAULT_CONTENT_TYPE,
      },
    })
  } catch {
    return NextResponse.json({ error: "Failed to fetch Railwayz image" }, { status: 502 })
  }
}
