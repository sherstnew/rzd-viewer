import { NextRequest, NextResponse } from "next/server"

const RAILWAYZ_BASE_URL = "https://railwayz.info"
const RAILWAYZ_SEARCH_URLS = [
  `${RAILWAYZ_BASE_URL}/photolines/search/`,
  "http://railwayz.info/photolines/search/",
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

type RailwayzAttemptDebug = {
  url: string
  attempt: number
  status: number | null
  error: string | null
  redirected: boolean | null
  finalUrl: string | null
}

type RailwayzDebugInfo = {
  searchQueries: string[]
  attempts: RailwayzAttemptDebug[]
  selectedQuery: string | null
  selectedUrl: string | null
  finalResponseUrl: string | null
  htmlLength: number
  hasPhotosSection: boolean
  figureCountInSection: number
  htmlSnippet: string
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

function countFiguresInPhotosSection(html: string): number {
  const section = extractPhotosSection(html)
  if (!section) {
    return 0
  }

  const figureRegex = /<figure[^>]*class=(["'])[^"']*img_cell[^"']*\1[^>]*>/gi
  let count = 0
  while (figureRegex.exec(section) !== null) {
    count += 1
  }
  return count
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

async function fetchRailwayzSearch(searchBody: string): Promise<{
  response: Response | null
  attempts: RailwayzAttemptDebug[]
  selectedUrl: string | null
}> {
  const errors: string[] = []
  const attempts: RailwayzAttemptDebug[] = []

  for (const url of RAILWAYZ_SEARCH_URLS) {
    for (let attempt = 1; attempt <= RAILWAYZ_MAX_ATTEMPTS_PER_URL; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
            "Cache-Control": "max-age=0",
            "Content-Type": "application/x-www-form-urlencoded",
            Origin: RAILWAYZ_BASE_URL,
            Referer: `${RAILWAYZ_BASE_URL}/photolines/`,
            "Upgrade-Insecure-Requests": "1",
            "User-Agent":
              "Mozilla/5.0 (Linux; Android 8.0.0; SM-G955U Build/R16NW) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36",
          },
          body: searchBody,
          cache: "no-store",
          signal: AbortSignal.timeout(RAILWAYZ_REQUEST_TIMEOUT_MS),
          redirect: "follow",
        })

        attempts.push({
          url,
          attempt,
          status: response.status,
          error: null,
          redirected: response.redirected,
          finalUrl: response.url,
        })

        if (response.ok && new URL(response.url).pathname !== "/photolines/search/") {
          return { response, attempts, selectedUrl: url }
        }

        if (response.ok) {
          errors.push(`${url} (attempt ${attempt}): returned search page`)
          break
        }

        errors.push(`${url} (attempt ${attempt}): HTTP ${response.status}`)
      } catch (error) {
        attempts.push({
          url,
          attempt,
          status: null,
          error: describeFetchError(error),
          redirected: null,
          finalUrl: null,
        })
        errors.push(`${url} (attempt ${attempt}): ${describeFetchError(error)}`)
        if (!shouldRetryFetchError(error)) {
          break
        }
      }
    }
  }

  console.warn(`Railwayz photos search failed. ${errors.join("; ")}`)
  return { response: null, attempts, selectedUrl: null }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { esrCode?: unknown; stationTitle?: unknown }
      | null
    const esrCode = typeof body?.esrCode === "string" ? body.esrCode.trim() : ""
    const stationTitle =
      typeof body?.stationTitle === "string" ? body.stationTitle.trim() : ""
    const searchQueries = Array.from(new Set([esrCode, stationTitle].filter(Boolean)))
    const debugInfo: RailwayzDebugInfo = {
      searchQueries,
      attempts: [],
      selectedQuery: null,
      selectedUrl: null,
      finalResponseUrl: null,
      htmlLength: 0,
      hasPhotosSection: false,
      figureCountInSection: 0,
      htmlSnippet: "",
    }

    if (searchQueries.length === 0) {
      return NextResponse.json({ photos: [] as StationPhotoItem[], debug: debugInfo })
    }

    for (const [queryIndex, query] of searchQueries.entries()) {
      const searchBody = new URLSearchParams({ searchstation: query }).toString()
      const fetchResult = await fetchRailwayzSearch(searchBody)
      debugInfo.attempts.push(...fetchResult.attempts)
      if (!fetchResult.response) {
        continue
      }

      const html = await fetchResult.response.text()
      const photos = parsePhotosFromHtml(html)
      debugInfo.selectedQuery = query
      debugInfo.selectedUrl = fetchResult.selectedUrl
      debugInfo.finalResponseUrl = fetchResult.response.url
      debugInfo.htmlLength = html.length
      debugInfo.hasPhotosSection = Boolean(extractPhotosSection(html))
      debugInfo.figureCountInSection = countFiguresInPhotosSection(html)
      debugInfo.htmlSnippet = html.slice(0, 1200)
      if (photos.length > 0) {
        return NextResponse.json({ photos, debug: debugInfo })
      }

      // If we got HTML but no photos for this query, keep trying next query.
      if (queryIndex < searchQueries.length - 1) {
        continue
      }
    }

    return NextResponse.json({ photos: [] as StationPhotoItem[], debug: debugInfo })
  } catch (err) {
    console.warn(`Station photos parser failed. ${describeFetchError(err)}`)
    return NextResponse.json({
      photos: [] as StationPhotoItem[],
      debug: {
        searchQueries: [],
        attempts: [],
        selectedQuery: null,
        selectedUrl: null,
        finalResponseUrl: null,
        htmlLength: 0,
        hasPhotosSection: false,
        figureCountInSection: 0,
        htmlSnippet: "",
      } satisfies RailwayzDebugInfo,
    })
  }
}
