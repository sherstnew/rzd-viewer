import { NextRequest, NextResponse } from "next/server"

const YANDEX_API_BASE = "https://api.rasp.yandex.net/v3.0"

type Nullable<T> = T | null

type ThreadError = {
  status_code: Nullable<number>
  message: string
}

type ThreadResponsePayload = {
  thread_route: Record<string, unknown> | null
  thread_error: ThreadError | null
}

type ThreadCacheItem = {
  date: string
  payload: ThreadResponsePayload
}

const threadCacheByUid = new Map<string, ThreadCacheItem>()

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return "Unknown error"
}

function getTodayMoscowDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

async function fetchWithRetry(url: URL, retries = 2): Promise<Response> {
  let attempt = 0
  let lastError: unknown = null

  while (attempt <= retries) {
    try {
      const response = await fetch(url, { method: "GET", cache: "no-store" })
      if (response.ok) {
        return response
      }

      const shouldRetry =
        response.status === 429 ||
        response.status === 500 ||
        response.status === 502 ||
        response.status === 503 ||
        response.status === 504

      if (!shouldRetry || attempt === retries) {
        return response
      }
    } catch (error) {
      lastError = error
      if (attempt === retries) {
        throw error
      }
    }

    attempt += 1
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt))
  }

  if (lastError) {
    throw lastError
  }

  throw new Error("Request failed")
}

async function fetchThreadRoute(
  apiKey: string,
  uid: string,
  date: string,
): Promise<ThreadResponsePayload> {
  const url = new URL(`${YANDEX_API_BASE}/thread/`)
  url.searchParams.set("apikey", apiKey)
  url.searchParams.set("uid", uid)
  url.searchParams.set("date", date)

  try {
    const response = await fetchWithRetry(url)
    if (!response.ok) {
      const text = await response.text()
      return {
        thread_route: null,
        thread_error: {
          status_code: response.status,
          message: text.slice(0, 300),
        },
      }
    }

    const threadRoute = (await response.json()) as Record<string, unknown>
    return {
      thread_route: threadRoute,
      thread_error: null,
    }
  } catch (error) {
    return {
      thread_route: null,
      thread_error: {
        status_code: null,
        message: toErrorMessage(error),
      },
    }
  }
}

function uniqueUids(rawUids: string): string[] {
  const result: string[] = []
  const seen = new Set<string>()

  for (const uid of rawUids.split(",").map((part) => part.trim()).filter(Boolean)) {
    if (seen.has(uid)) {
      continue
    }

    seen.add(uid)
    result.push(uid)
  }

  return result
}

export async function GET(request: NextRequest) {
  const rawUids = request.nextUrl.searchParams.get("uids") ?? ""
  const requestedDate = request.nextUrl.searchParams.get("date") ?? getTodayMoscowDate()
  const uids = uniqueUids(rawUids)

  if (uids.length === 0) {
    return NextResponse.json(
      { error: "Missing uids query parameter" },
      { status: 400 },
    )
  }

  const apiKey = process.env.YANDEX_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: "YANDEX_API_KEY is not configured" },
      { status: 500 },
    )
  }

  const responseByUid: Record<string, ThreadResponsePayload> = {}

  await Promise.all(
    uids.map(async (uid) => {
      const cached = threadCacheByUid.get(uid)
      if (cached && cached.date === requestedDate) {
        responseByUid[uid] = cached.payload
        return
      }

      const payload = await fetchThreadRoute(apiKey, uid, requestedDate)
      threadCacheByUid.set(uid, {
        date: requestedDate,
        payload,
      })
      responseByUid[uid] = payload
    }),
  )

  return NextResponse.json(responseByUid)
}
