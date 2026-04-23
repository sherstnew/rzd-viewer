import { NextRequest, NextResponse } from "next/server"

const RAILWAYZ_BASE_URL = "https://railwayz.info"
const RAILWAYZ_SEARCH_URLS = [
  "http://railwayz.info/photolines/search/",
  `${RAILWAYZ_BASE_URL}/photolines/search/`,
]
const MAX_PHOTOS = 30
const RAILWAYZ_REQUEST_TIMEOUT_MS = 15000
const RAILWAYZ_MAX_ATTEMPTS_PER_URL = 2

type StationPhotoItem = {
  thumbUrl: string
  photoPageUrl: string
  fullImageUrl: string | null
  caption: string
}

function decodeHtmlEntities(value: string): string {
  const namedEntities: Record<string, string> = {
    "&nbsp;": " ",
    "&amp;": "&",
    "&quot;": '"',
    "&#39;": "'",
    "&lt;": "<",
    "&gt;": ">",
  }

  const withNamedEntities = value.replace(
    /&nbsp;|&amp;|&quot;|&#39;|&lt;|&gt;/g,
    (entity) => namedEntities[entity] ?? entity,
  )

  return withNamedEntities
    .replace(/&#(\d+);/g, (_, code) => {
      const parsed = Number(code)
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : ""
    })
    .replace(/&#x([a-fA-F0-9]+);/g, (_, hex) => {
      const parsed = Number.parseInt(hex, 16)
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : ""
    })
}

function stripTags(value: string): string {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
}

function normalizeUrl(rawUrl: string): string | null {
  try {
    return new URL(rawUrl, RAILWAYZ_BASE_URL).toString()
  } catch {
    return null
  }
}

function extractPhotosSection(html: string): string | null {
  const sectionStartMatch = /<section[^>]*id=(["'])photos\1[^>]*>/i.exec(html)
  if (!sectionStartMatch || sectionStartMatch.index < 0) {
    return null
  }

  const start = sectionStartMatch.index
  const end = html.indexOf("</section>", start)
  if (end < 0) {
    return null
  }

  return html.slice(start, end + "</section>".length)
}

function extractImageLikeHref(figureHtml: string): string | null {
  const hrefRegex = /<a[^>]*href=(["'])([^"']+)\1[^>]*>/gi
  let match: RegExpExecArray | null

  while ((match = hrefRegex.exec(figureHtml)) !== null) {
    const href = match[2]
    if (/\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(href)) {
      return href
    }
  }

  return null
}

function parsePhotosFromHtml(html: string): StationPhotoItem[] {
  const section = extractPhotosSection(html)
  if (!section) {
    return []
  }

  const figureRegex = /<figure[^>]*class=(["'])[^"']*img_cell[^"']*\1[^>]*>([\s\S]*?)<\/figure>/gi
  const photos: StationPhotoItem[] = []
  const seenPhotoPages = new Set<string>()

  let figureMatch: RegExpExecArray | null
  while ((figureMatch = figureRegex.exec(section)) !== null && photos.length < MAX_PHOTOS) {
    const figureHtml = figureMatch[2]

    const pageHrefMatch = /<a[^>]*href=(["'])([^"']+)\1[^>]*>/i.exec(figureHtml)
    const imgMatch = /<img[^>]*src=(["'])([^"']+)\1[^>]*>/i.exec(figureHtml)
    if (!pageHrefMatch || !imgMatch) {
      continue
    }

    const photoPageUrl = normalizeUrl(pageHrefMatch[2])
    const thumbUrl = normalizeUrl(imgMatch[2])
    if (!photoPageUrl || !thumbUrl || seenPhotoPages.has(photoPageUrl)) {
      continue
    }

    const imgAltMatch = /<img[^>]*alt=(["'])([^"']*)\1[^>]*>/i.exec(figureHtml)
    const figCaptionMatch = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(figureHtml)
    const captionSource = figCaptionMatch?.[1] ?? imgAltMatch?.[2] ?? ""
    const caption = stripTags(captionSource)

    const fullImageHref = extractImageLikeHref(figureHtml)
    const fullImageUrl = fullImageHref ? normalizeUrl(fullImageHref) : null

    seenPhotoPages.add(photoPageUrl)
    photos.push({
      thumbUrl,
      photoPageUrl,
      fullImageUrl,
      caption,
    })
  }

  return photos
}

function describeFetchError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "unknown error"
  }

  const cause = error.cause as { code?: unknown; reason?: unknown } | undefined
  const causeCode = typeof cause?.code === "string" ? ` (${cause.code})` : ""
  const causeReason = typeof cause?.reason === "string" ? `: ${cause.reason}` : ""
  return `${error.name}: ${error.message}${causeCode}${causeReason}`
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError"
}

function getFetchErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null
  }

  const cause = error.cause as { code?: unknown } | undefined
  return typeof cause?.code === "string" ? cause.code : null
}

function shouldRetryFetchError(error: unknown): boolean {
  if (isTimeoutError(error)) {
    return true
  }

  const code = getFetchErrorCode(error)
  if (!code) {
    return false
  }

  return code === "ECONNRESET" || code === "ETIMEDOUT"
}

async function fetchRailwayzSearch(searchBody: string): Promise<Response | null> {
  const errors: string[] = []

  for (const url of RAILWAYZ_SEARCH_URLS) {
    for (let attempt = 1; attempt <= RAILWAYZ_MAX_ATTEMPTS_PER_URL; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0 (compatible; rzd-viewer/1.0)",
          },
          body: searchBody,
          cache: "no-store",
          signal: AbortSignal.timeout(RAILWAYZ_REQUEST_TIMEOUT_MS),
        })

        if (response.ok) {
          return response
        }

        errors.push(`${url} (attempt ${attempt}): HTTP ${response.status}`)
      } catch (error) {
        errors.push(`${url} (attempt ${attempt}): ${describeFetchError(error)}`)
        if (!shouldRetryFetchError(error)) {
          break
        }
      }
    }
  }

  console.warn(`Railwayz photos search failed. ${errors.join("; ")}`)
  return null
}

export async function POST(request: NextRequest) {
  const emptyResponse = NextResponse.json({ photos: [] as StationPhotoItem[] })

  try {
    const body = (await request.json().catch(() => null)) as { esrCode?: unknown } | null
    const esrCode = typeof body?.esrCode === "string" ? body.esrCode.trim() : ""
    if (!esrCode) {
      return emptyResponse
    }

    const searchBody = new URLSearchParams({ searchstation: esrCode }).toString()

    const response = await fetchRailwayzSearch(searchBody)
    if (!response) {
      return emptyResponse
    }

    const html = await response.text()
    const photos = parsePhotosFromHtml(html)
    return NextResponse.json({ photos })
  } catch (err) {
    console.warn(`Station photos parser failed. ${describeFetchError(err)}`)
    return emptyResponse
  }
}
