import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const ROOT_DIR = process.cwd()
const STATIONS_PATH = path.join(ROOT_DIR, "public", "assets", "stations.json")
const DEFAULT_OUTPUT_DIR = process.env.STATION_PHOTOS_OUTPUT_DIR ?? "D:/stations"
let outputDir = path.resolve(DEFAULT_OUTPUT_DIR)
let manifestPath = path.join(outputDir, "manifest.json")
const RAILWAYZ_BASE_URL = "https://railwayz.info"
const RAILWAYZ_SEARCH_URLS = [
  `${RAILWAYZ_BASE_URL}/photolines/search/`,
  "http://railwayz.info/photolines/search/",
]
const DEFAULT_LIMIT = 10
const DEFAULT_DELAY_MS = 500
const REQUEST_TIMEOUT_MS = 15000
const MAX_ATTEMPTS_PER_URL = 2

function parseArgs(argv) {
  const options = {
    delayMs: DEFAULT_DELAY_MS,
    dryRun: false,
    limit: DEFAULT_LIMIT,
    maxStations: null,
    outputDir: DEFAULT_OUTPUT_DIR,
    refresh: false,
    station: null,
  }

  for (const arg of argv) {
    if (arg === "--dry-run") {
      options.dryRun = true
      continue
    }

    if (arg === "--refresh") {
      options.refresh = true
      continue
    }

    const [key, rawValue] = arg.split("=", 2)
    if (!rawValue) {
      continue
    }

    if (key === "--delay-ms") {
      options.delayMs = Math.max(0, Number(rawValue) || DEFAULT_DELAY_MS)
    }

    if (key === "--limit") {
      options.limit = Math.max(1, Number(rawValue) || DEFAULT_LIMIT)
    }

    if (key === "--max-stations") {
      options.maxStations = Math.max(1, Number(rawValue) || 1)
    }

    if (key === "--output") {
      options.outputDir = rawValue.trim() || DEFAULT_OUTPUT_DIR
    }

    if (key === "--station") {
      options.station = rawValue.trim().toLowerCase()
    }
  }

  return options
}

function parseFirstEsrCode(value) {
  if (typeof value === "string" && value.trim()) {
    return value.trim()
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value)
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseFirstEsrCode(item)
      if (parsed) {
        return parsed
      }
    }
  }

  return null
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}0-9]+/giu, "-")
    .replace(/^-+|-+$/g, "")
}

function stationManifestKey(station) {
  if (station.esrCode) {
    return `esr:${station.esrCode.toLowerCase()}`
  }

  return `title:${station.title.toLowerCase()}`
}

function stationDirectoryName(station) {
  return station.esrCode ?? station.yandexCode ?? slugify(station.title)
}

function toStationList(stationsPayload, selectedStation) {
  if (!Array.isArray(stationsPayload)) {
    return []
  }

  return stationsPayload
    .flatMap((item) => {
      if (!item || typeof item !== "object" || item.transport_type !== "train") {
        return []
      }

      const title = typeof item.title === "string" ? item.title.trim() : ""
      if (!title) {
        return []
      }

      const codes = item.codes && typeof item.codes === "object" ? item.codes : {}
      const esrCode = parseFirstEsrCode(codes.esr_code)
      const yandexCode = typeof codes.yandex_code === "string" ? codes.yandex_code : null
      const key = stationManifestKey({ esrCode, title })
      const directory = stationDirectoryName({ esrCode, title, yandexCode })
      return [{ directory, esrCode, key, title, yandexCode }]
    })
    .filter((station) => {
      if (!selectedStation) {
        return true
      }

      return (
        station.title.toLowerCase().includes(selectedStation) ||
        station.esrCode?.toLowerCase() === selectedStation ||
        station.yandexCode?.toLowerCase() === selectedStation
      )
    })
}

function decodeHtmlEntities(value) {
  const namedEntities = {
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

function stripTags(value) {
  return decodeHtmlEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
}

function normalizeUrl(rawUrl) {
  try {
    return new URL(rawUrl, RAILWAYZ_BASE_URL).toString()
  } catch {
    return null
  }
}

function toFullSizeRailwayzImageUrl(imageUrl) {
  return imageUrl.replace(/_s(?=\.(?:webp|jpg|jpeg|png|gif)(?:\?|$))/i, "")
}

function extractPhotosSection(html) {
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

function readHtmlAttribute(html, attributeName) {
  const match = new RegExp(`${attributeName}=(["'])([^"']+)\\1`, "i").exec(html)
  return match?.[2] ?? null
}

function firstSrcsetUrl(srcset) {
  if (!srcset) {
    return null
  }

  return (
    srcset
      .split(",")
      .map((candidate) => candidate.trim().split(/\s+/)[0])
      .find(Boolean) ?? null
  )
}

function extractImageLikeHref(figureHtml) {
  const hrefRegex = /<a[^>]*href=(["'])([^"']+)\1[^>]*>/gi
  let match

  while ((match = hrefRegex.exec(figureHtml)) !== null) {
    const href = match[2]
    if (/\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(href)) {
      return href
    }
  }

  return null
}

function extractImageSource(figureHtml) {
  const imgMatch = /<img\b[^>]*>/i.exec(figureHtml)
  if (!imgMatch) {
    return null
  }

  const imgHtml = imgMatch[0]
  return (
    readHtmlAttribute(imgHtml, "data-src") ??
    readHtmlAttribute(imgHtml, "data-original") ??
    readHtmlAttribute(imgHtml, "data-lazy-src") ??
    firstSrcsetUrl(readHtmlAttribute(imgHtml, "data-srcset")) ??
    firstSrcsetUrl(readHtmlAttribute(imgHtml, "srcset")) ??
    readHtmlAttribute(imgHtml, "src")
  )
}

function parsePhotoSourcesFromHtml(html, limit) {
  const section = extractPhotosSection(html)
  if (!section) {
    return []
  }

  const figureRegex = /<figure[^>]*class=(["'])[^"']*img_cell[^"']*\1[^>]*>([\s\S]*?)<\/figure>/gi
  const photos = []
  const seenPhotoPages = new Set()
  const seenImageUrls = new Set()

  let figureMatch
  while ((figureMatch = figureRegex.exec(section)) !== null && photos.length < limit) {
    const figureHtml = figureMatch[2]
    const pageHrefMatch = /<a[^>]*href=(["'])([^"']+)\1[^>]*>/i.exec(figureHtml)
    const imageSource = extractImageSource(figureHtml)
    if (!pageHrefMatch || !imageSource) {
      continue
    }

    const photoPageUrl = normalizeUrl(pageHrefMatch[2])
    const thumbUrl = normalizeUrl(imageSource)
    if (!photoPageUrl || !thumbUrl || seenPhotoPages.has(photoPageUrl)) {
      continue
    }

    const imgAltMatch = /<img[^>]*alt=(["'])([^"']*)\1[^>]*>/i.exec(figureHtml)
    const figCaptionMatch = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(figureHtml)
    const captionSource = figCaptionMatch?.[1] ?? imgAltMatch?.[2] ?? ""
    const caption = stripTags(captionSource)
    const fullImageHref = extractImageLikeHref(figureHtml)
    const fullImageUrl = fullImageHref ? normalizeUrl(fullImageHref) : null
    const imageUrl = fullImageUrl ?? toFullSizeRailwayzImageUrl(thumbUrl)

    if (seenImageUrls.has(imageUrl)) {
      continue
    }

    seenPhotoPages.add(photoPageUrl)
    seenImageUrls.add(imageUrl)
    photos.push({ caption, imageUrl, photoPageUrl })
  }

  return photos
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(url, options = {}) {
  let lastError = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_URL; attempt += 1) {
    try {
      return await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
    } catch (error) {
      lastError = error
      if (attempt < MAX_ATTEMPTS_PER_URL) {
        await wait(500)
      }
    }
  }

  throw lastError
}

async function fetchRailwayzSearch(query, limit) {
  const body = new URLSearchParams({ searchstation: query }).toString()

  for (const url of RAILWAYZ_SEARCH_URLS) {
    const response = await fetchWithRetry(url, {
      body,
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
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      },
      method: "POST",
      redirect: "follow",
    })

    if (!response.ok) {
      continue
    }

    const finalPath = new URL(response.url).pathname
    if (finalPath === "/photolines/search/") {
      continue
    }

    const html = await response.text()
    const photos = parsePhotoSourcesFromHtml(html, limit)
    if (photos.length > 0) {
      return photos
    }
  }

  return []
}

async function fetchStationPhotoSources(station, limit) {
  const queries = Array.from(new Set([station.esrCode, station.title].filter(Boolean)))

  for (const query of queries) {
    const photos = await fetchRailwayzSearch(query, limit)
    if (photos.length > 0) {
      return photos
    }
  }

  return []
}

function extensionFromContentType(contentType) {
  const normalized = contentType.toLowerCase().split(";", 1)[0].trim()
  if (normalized === "image/webp") {
    return "webp"
  }
  if (normalized === "image/jpeg" || normalized === "image/jpg") {
    return "jpg"
  }
  if (normalized === "image/png") {
    return "png"
  }
  if (normalized === "image/gif") {
    return "gif"
  }
  return null
}

function extensionFromUrl(value) {
  try {
    const ext = path.extname(new URL(value).pathname).replace(".", "").toLowerCase()
    return ext || null
  } catch {
    return null
  }
}

async function downloadPhoto(source, destinationBase) {
  const response = await fetchWithRetry(source.imageUrl, {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
      Referer: "https://railwayz.info/photolines/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    },
    redirect: "follow",
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const contentType = response.headers.get("content-type") ?? ""
  const extension = extensionFromContentType(contentType) ?? extensionFromUrl(source.imageUrl) ?? "webp"
  const destinationPath = `${destinationBase}.${extension}`
  const buffer = Buffer.from(await response.arrayBuffer())
  await writeFile(destinationPath, buffer)

  return {
    caption: source.caption,
    imageUrl: path
      .posix
      .join("/assets/station-photos", path.basename(path.dirname(destinationPath)), path.basename(destinationPath)),
    photoPageUrl: source.photoPageUrl,
  }
}

async function readManifest() {
  try {
    const text = await readFile(manifestPath, "utf8")
    const manifest = JSON.parse(text)
    if (manifest && typeof manifest === "object" && manifest.stations) {
      return manifest
    }
  } catch {
    // First run creates the manifest.
  }

  return {
    generatedAt: null,
    limit: DEFAULT_LIMIT,
    stations: {},
  }
}

async function writeManifest(manifest, limit) {
  manifest.generatedAt = new Date().toISOString()
  manifest.limit = limit
  await mkdir(outputDir, { recursive: true })
  await writeFile(`${manifestPath}.tmp`, `${JSON.stringify(manifest, null, 2)}\n`)
  await rename(`${manifestPath}.tmp`, manifestPath)
}

async function pruneStationFiles(stationDir, limit) {
  let entries = []
  try {
    entries = await readdir(stationDir)
  } catch {
    return
  }

  await Promise.all(
    entries.flatMap((entry) => {
      const match = /^(\d+)\.(?:webp|jpg|jpeg|png|gif)$/i.exec(entry)
      if (!match || Number(match[1]) <= limit) {
        return []
      }

      return [rm(path.join(stationDir, entry), { force: true })]
    }),
  )
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  outputDir = path.resolve(options.outputDir)
  manifestPath = path.join(outputDir, "manifest.json")

  const stationsPayload = JSON.parse(await readFile(STATIONS_PATH, "utf8"))
  const stations = toStationList(stationsPayload, options.station)
  const selectedStations = options.maxStations ? stations.slice(0, options.maxStations) : stations
  const estimatedPhotos = selectedStations.length * options.limit
  const estimatedMiB = (estimatedPhotos * 500) / 1024

  console.log(
    `Stations: ${selectedStations.length}; limit: ${options.limit}; max photos: ${estimatedPhotos}; estimated size: ${estimatedMiB.toFixed(1)} MiB`,
  )
  console.log(`Output: ${outputDir}`)

  if (options.dryRun) {
    return
  }

  const manifest = await readManifest()
  manifest.stations ??= {}

  await mkdir(outputDir, { recursive: true })

  for (const [stationIndex, station] of selectedStations.entries()) {
    const stationDir = path.join(outputDir, station.directory)
    const existingPhotos = manifest.stations[station.key]
    if (!options.refresh && Array.isArray(existingPhotos) && existingPhotos.length >= options.limit) {
      if (existingPhotos.length > options.limit) {
        manifest.stations[station.key] = existingPhotos.slice(0, options.limit)
        await pruneStationFiles(stationDir, options.limit)
        await writeManifest(manifest, options.limit)
      } else {
        await pruneStationFiles(stationDir, options.limit)
      }

      console.log(
        `[${stationIndex + 1}/${selectedStations.length}] skip ${station.title}: ${Math.min(existingPhotos.length, options.limit)} local photos`,
      )
      continue
    }

    console.log(`[${stationIndex + 1}/${selectedStations.length}] ${station.title}`)
    await mkdir(stationDir, { recursive: true })

    let sources = []
    try {
      sources = await fetchStationPhotoSources(station, options.limit)
    } catch (error) {
      console.warn(`  search failed: ${error instanceof Error ? error.message : String(error)}`)
      manifest.stations[station.key] = []
      await writeManifest(manifest, options.limit)
      await wait(options.delayMs)
      continue
    }

    const localPhotos = []
    for (const [photoIndex, source] of sources.entries()) {
      const destinationBase = path.join(stationDir, String(photoIndex + 1).padStart(2, "0"))
      try {
        localPhotos.push(await downloadPhoto(source, destinationBase))
      } catch (error) {
        console.warn(
          `  photo ${photoIndex + 1} failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      await wait(options.delayMs)
    }

    manifest.stations[station.key] = localPhotos
    await pruneStationFiles(stationDir, options.limit)
    console.log(`  saved ${localPhotos.length} photos`)
    await writeManifest(manifest, options.limit)
    await wait(options.delayMs)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
