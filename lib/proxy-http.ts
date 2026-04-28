import http, { type IncomingHttpHeaders, type OutgoingHttpHeaders } from "node:http"
import https from "node:https"
import { Buffer } from "node:buffer"
import { HttpsProxyAgent } from "https-proxy-agent"

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_REDIRECTS = 5
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

type ProxyRequestOptions = {
  method?: string
  headers?: OutgoingHttpHeaders
  body?: string
  timeoutMs?: number
  maxRedirects?: number
}

type ResolvedProxyRequestOptions = {
  method: string
  headers: OutgoingHttpHeaders
  body?: string
  timeoutMs: number
  maxRedirects: number
}

type ProxyTextResponse = {
  ok: boolean
  status: number
  headers: IncomingHttpHeaders
  text: string
  url: string
  redirected: boolean
}

let cachedProxyUrl: string | null | undefined
let cachedProxyAgent: HttpsProxyAgent<string> | null | undefined

function trimEnvValue(value: string | undefined): string | null {
  if (!value) {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function buildProxyUrlFromParts(): string | null {
  const host = trimEnvValue(process.env.UPSTREAM_PROXY_HOST)
  const port = trimEnvValue(process.env.UPSTREAM_PROXY_PORT)
  if (!host || !port) {
    return null
  }

  const protocol = trimEnvValue(process.env.UPSTREAM_PROXY_PROTOCOL) ?? "http"
  const username = trimEnvValue(process.env.UPSTREAM_PROXY_USERNAME)
  const password = trimEnvValue(process.env.UPSTREAM_PROXY_PASSWORD)
  const proxyUrl = new URL(`${protocol}://${host}:${port}`)

  if (username) {
    proxyUrl.username = username
  }

  if (password) {
    proxyUrl.password = password
  }

  return proxyUrl.toString()
}

function resolveProxyUrl(): string | null {
  if (cachedProxyUrl !== undefined) {
    return cachedProxyUrl
  }

  const directProxyUrl =
    trimEnvValue(process.env.UPSTREAM_HTTP_PROXY_URL) ??
    trimEnvValue(process.env.HTTP_PROXY_URL) ??
    trimEnvValue(process.env.HTTP_PROXY) ??
    trimEnvValue(process.env.HTTPS_PROXY)

  cachedProxyUrl = directProxyUrl ?? buildProxyUrlFromParts()
  return cachedProxyUrl
}

function getProxyAgent(): HttpsProxyAgent<string> | null {
  if (cachedProxyAgent !== undefined) {
    return cachedProxyAgent
  }

  const proxyUrl = resolveProxyUrl()
  if (!proxyUrl) {
    cachedProxyAgent = null
    return cachedProxyAgent
  }

  cachedProxyAgent = new HttpsProxyAgent(proxyUrl)
  return cachedProxyAgent
}

function shouldDropBodyOnRedirect(status: number, method: string): boolean {
  if (status === 303) {
    return true
  }

  return (status === 301 || status === 302) && method.toUpperCase() === "POST"
}

async function executeRequest(
  url: URL,
  options: ResolvedProxyRequestOptions,
  redirectCount: number,
): Promise<ProxyTextResponse> {
  const transport = url.protocol === "https:" ? https : http
  const proxyAgent = getProxyAgent()

  return new Promise<ProxyTextResponse>((resolve, reject) => {
    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: options.method,
        headers: options.headers,
        agent: proxyAgent ?? undefined,
      },
      (response) => {
        const chunks: Buffer[] = []

        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })

        response.on("end", async () => {
          const text = Buffer.concat(chunks).toString("utf8")
          const status = response.statusCode ?? 0
          const location = response.headers.location

          if (
            location &&
            REDIRECT_STATUSES.has(status) &&
            redirectCount < options.maxRedirects
          ) {
            try {
              const redirectedUrl = new URL(location, url)
              const nextMethod = shouldDropBodyOnRedirect(status, options.method)
                ? "GET"
                : options.method
              const nextHeaders = { ...options.headers }
              const nextBody = nextMethod === options.method ? options.body : undefined

              if (!nextBody) {
                delete nextHeaders["content-length"]
              }

              const redirectedResponse = await executeRequest(
                redirectedUrl,
                {
                  ...options,
                  method: nextMethod,
                  headers: nextHeaders,
                  body: nextBody,
                },
                redirectCount + 1,
              )

              resolve({
                ...redirectedResponse,
                redirected: true,
              })
              return
            } catch (error) {
              reject(error)
              return
            }
          }

          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers: response.headers,
            text,
            url: url.toString(),
            redirected: redirectCount > 0,
          })
        })
      },
    )

    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error(`Request timed out after ${options.timeoutMs}ms`))
    })

    request.on("error", reject)

    if (options.body) {
      request.write(options.body)
    }

    request.end()
  })
}

export async function fetchTextWithProxy(
  input: string | URL,
  options: ProxyRequestOptions = {},
): Promise<ProxyTextResponse> {
  const url = input instanceof URL ? input : new URL(input)

  return executeRequest(
    url,
    {
      method: options.method ?? "GET",
      headers: options.headers ?? {},
      body: options.body,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRedirects: options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
    },
    0,
  )
}

export async function fetchJsonWithProxy<T>(
  input: string | URL,
  options: ProxyRequestOptions = {},
): Promise<ProxyTextResponse & { json: T }> {
  const response = await fetchTextWithProxy(input, options)

  return {
    ...response,
    json: JSON.parse(response.text) as T,
  }
}
