import type {
  Feature,
  FeatureCollection,
  GeoJsonObject,
  LineString,
  MultiLineString,
} from "geojson"

export type LonLat = [number, number]
type LineId = number | string

type EdgeKind = "rail" | "bridge"

export type GraphEdge = {
  to: string
  weight: number
  kind: EdgeKind
  lineId: LineId
}

export type Graph = Map<string, GraphEdge[]>

type ProjectionInfo = {
  lineIdx: number
  segIdx: number
  a: LonLat
  b: LonLat
  proj: LonLat
  t: number
  dist: number
}

type RouteEngine = {
  findRoute: (start: LonLat, end: LonLat) => FeatureCollection<LineString, { name: string }>
}

const SNAP_TOLERANCE = 0.0005
const ROUND_DIGITS = 7
const BRIDGE_MULTIPLIER = 50.0
const BRIDGE_EXTRA_PENALTY = 1.0
const TURN_PENALTY = 0.003
const SHARP_TURN_FACTOR = 4.0
const LINE_CHANGE_PENALTY = 0.05

function dist(a: LonLat, b: LonLat): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function roundCoord(value: number): number {
  const factor = 10 ** ROUND_DIGITS
  return Math.round(value * factor) / factor
}

function roundPt(pt: LonLat): LonLat {
  return [roundCoord(pt[0]), roundCoord(pt[1])]
}

function pointKey(pt: LonLat): string {
  return `${pt[0]},${pt[1]}`
}

function keyToPoint(key: string): LonLat {
  const [lon, lat] = key.split(",").map(Number)
  return [lon, lat]
}

function extractLines(data: GeoJsonObject): LonLat[][] {
  if (!("features" in data) || !Array.isArray(data.features)) {
    return []
  }

  const lines: LonLat[][] = []

  for (const feature of data.features as Feature[]) {
    if (!feature.geometry) {
      continue
    }

    if (feature.geometry.type === "LineString") {
      const geometry = feature.geometry as LineString
      const coords = geometry.coordinates.map((coord) => [coord[0], coord[1]] as LonLat)
      if (coords.length >= 2) {
        lines.push(coords)
      }
    }

    if (feature.geometry.type === "MultiLineString") {
      const geometry = feature.geometry as MultiLineString
      for (const part of geometry.coordinates) {
        const coords = part.map((coord) => [coord[0], coord[1]] as LonLat)
        if (coords.length >= 2) {
          lines.push(coords)
        }
      }
    }
  }

  return lines
}

function projectPointToSegment(
  p: LonLat,
  a: LonLat,
  b: LonLat,
): { proj: LonLat; t: number; d: number } {
  const [ax, ay] = a
  const [bx, by] = b
  const [px, py] = p

  const abx = bx - ax
  const aby = by - ay
  const ab2 = abx * abx + aby * aby

  if (ab2 === 0) {
    return { proj: a, t: 0, d: dist(p, a) }
  }

  const apx = px - ax
  const apy = py - ay

  let t = (apx * abx + apy * aby) / ab2
  t = Math.max(0, Math.min(1, t))

  const proj: LonLat = [ax + t * abx, ay + t * aby]
  return { proj, t, d: dist(p, proj) }
}

function findBestProjection(lines: LonLat[][], point: LonLat): ProjectionInfo | null {
  let best: ProjectionInfo | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx += 1) {
    const line = lines[lineIdx]
    for (let segIdx = 0; segIdx < line.length - 1; segIdx += 1) {
      const a = line[segIdx]
      const b = line[segIdx + 1]
      const { proj, t, d } = projectPointToSegment(point, a, b)
      if (d < bestDistance) {
        bestDistance = d
        best = { lineIdx, segIdx, a, b, proj, t, dist: d }
      }
    }
  }

  return best
}

function addEdge(
  graph: Graph,
  a: LonLat,
  b: LonLat,
  kind: EdgeKind,
  lineId: LineId,
  pointLookup: Map<string, LonLat>,
  weight?: number,
): void {
  const roundedA = roundPt(a)
  const roundedB = roundPt(b)

  if (roundedA[0] === roundedB[0] && roundedA[1] === roundedB[1]) {
    return
  }

  const fromKey = pointKey(roundedA)
  const toKey = pointKey(roundedB)
  const edgeWeight = weight ?? dist(roundedA, roundedB)

  if (!graph.has(fromKey)) {
    graph.set(fromKey, [])
  }
  if (!graph.has(toKey)) {
    graph.set(toKey, [])
  }

  pointLookup.set(fromKey, roundedA)
  pointLookup.set(toKey, roundedB)

  graph.get(fromKey)?.push({ to: toKey, weight: edgeWeight, kind, lineId })
  graph.get(toKey)?.push({ to: fromKey, weight: edgeWeight, kind, lineId })
}

function buildGraphWithLineIds(lines: LonLat[][]): {
  graph: Graph
  pointLookup: Map<string, LonLat>
} {
  const graph: Graph = new Map()
  const pointLookup = new Map<string, LonLat>()

  for (let lineId = 0; lineId < lines.length; lineId += 1) {
    const line = lines[lineId]
    for (let i = 0; i < line.length - 1; i += 1) {
      addEdge(graph, line[i], line[i + 1], "rail", lineId, pointLookup)
    }
  }

  const endpoints: Array<{ lineId: number; point: LonLat }> = []
  for (let lineId = 0; lineId < lines.length; lineId += 1) {
    const line = lines[lineId]
    endpoints.push({ lineId, point: line[0] })
    endpoints.push({ lineId, point: line[line.length - 1] })
  }

  for (let i = 0; i < endpoints.length; i += 1) {
    const endpointA = endpoints[i]
    const a = roundPt(endpointA.point)
    for (let j = i + 1; j < endpoints.length; j += 1) {
      const endpointB = endpoints[j]
      if (endpointA.lineId === endpointB.lineId) {
        continue
      }
      const b = roundPt(endpointB.point)
      const d = dist(a, b)
      if (d <= SNAP_TOLERANCE) {
        addEdge(
          graph,
          a,
          b,
          "bridge",
          `bridge:${endpointA.lineId}:${endpointB.lineId}`,
          pointLookup,
          d * BRIDGE_MULTIPLIER,
        )
      }
    }
  }

  return { graph, pointLookup }
}

function cloneGraph(graph: Graph): Graph {
  const cloned: Graph = new Map()
  for (const [key, edges] of graph) {
    cloned.set(
      key,
      edges.map((edge) => ({ ...edge })),
    )
  }
  return cloned
}

function removeEdge(graph: Graph, fromKey: string, toKey: string): void {
  const edges = graph.get(fromKey)
  if (!edges) {
    return
  }
  graph.set(
    fromKey,
    edges.filter((edge) => edge.to !== toKey),
  )
}

function insertProjectionIntoGraph(
  graph: Graph,
  pointLookup: Map<string, LonLat>,
  projection: ProjectionInfo,
): string {
  const a = roundPt(projection.a)
  const b = roundPt(projection.b)
  const p = roundPt(projection.proj)
  const lineId = projection.lineIdx

  const aKey = pointKey(a)
  const bKey = pointKey(b)
  const pKey = pointKey(p)

  if (!graph.has(pKey)) {
    graph.set(pKey, [])
  }
  pointLookup.set(pKey, p)
  pointLookup.set(aKey, a)
  pointLookup.set(bKey, b)

  removeEdge(graph, aKey, bKey)
  removeEdge(graph, bKey, aKey)

  if (aKey !== pKey) {
    const wa = dist(a, p)
    graph.get(aKey)?.push({ to: pKey, weight: wa, kind: "rail", lineId })
    graph.get(pKey)?.push({ to: aKey, weight: wa, kind: "rail", lineId })
  }

  if (bKey !== pKey) {
    const wb = dist(p, b)
    graph.get(bKey)?.push({ to: pKey, weight: wb, kind: "rail", lineId })
    graph.get(pKey)?.push({ to: bKey, weight: wb, kind: "rail", lineId })
  }

  return pKey
}

function anglePenalty(prevNode: LonLat | null, curNode: LonLat, nextNode: LonLat): number {
  if (!prevNode) {
    return 0
  }

  const [ax, ay] = prevNode
  const [bx, by] = curNode
  const [cx, cy] = nextNode

  const v1: LonLat = [bx - ax, by - ay]
  const v2: LonLat = [cx - bx, cy - by]

  const len1 = Math.hypot(v1[0], v1[1])
  const len2 = Math.hypot(v2[0], v2[1])

  if (len1 === 0 || len2 === 0) {
    return 0
  }

  let cosang = (v1[0] * v2[0] + v1[1] * v2[1]) / (len1 * len2)
  cosang = Math.max(-1, Math.min(1, cosang))
  const angle = Math.acos(cosang)

  return TURN_PENALTY * (1 - cosang) * (1 + SHARP_TURN_FACTOR * (angle / Math.PI))
}

type QueueItem = {
  cost: number
  cur: string
  prev: string | null
  prevLineId: LineId | null
}

class MinHeap {
  private data: QueueItem[] = []

  push(item: QueueItem): void {
    this.data.push(item)
    this.bubbleUp(this.data.length - 1)
  }

  pop(): QueueItem | undefined {
    if (this.data.length === 0) {
      return undefined
    }

    const first = this.data[0]
    const last = this.data.pop()
    if (this.data.length > 0 && last) {
      this.data[0] = last
      this.bubbleDown(0)
    }
    return first
  }

  get size(): number {
    return this.data.length
  }

  private bubbleUp(index: number): void {
    let current = index
    while (current > 0) {
      const parent = Math.floor((current - 1) / 2)
      if (this.data[parent].cost <= this.data[current].cost) {
        break
      }
      ;[this.data[parent], this.data[current]] = [this.data[current], this.data[parent]]
      current = parent
    }
  }

  private bubbleDown(index: number): void {
    let current = index
    while (true) {
      const left = current * 2 + 1
      const right = current * 2 + 2
      let smallest = current

      if (left < this.data.length && this.data[left].cost < this.data[smallest].cost) {
        smallest = left
      }

      if (right < this.data.length && this.data[right].cost < this.data[smallest].cost) {
        smallest = right
      }

      if (smallest === current) {
        break
      }

      ;[this.data[current], this.data[smallest]] = [this.data[smallest], this.data[current]]
      current = smallest
    }
  }
}

function makeStateKey(cur: string, prev: string | null, prevLineId: LineId | null): string {
  const normalizedPrev = prev ?? "null"
  const normalizedLine = prevLineId ?? "null"
  return `${cur}|${normalizedPrev}|${String(normalizedLine)}`
}

function dijkstraPreferSameLine(
  graph: Graph,
  pointLookup: Map<string, LonLat>,
  startKey: string,
  endKey: string,
): LonLat[] | null {
  const queue = new MinHeap()
  queue.push({ cost: 0, cur: startKey, prev: null, prevLineId: null })

  const startStateKey = makeStateKey(startKey, null, null)
  const best = new Map<string, number>([[startStateKey, 0]])
  const parent = new Map<string, string | null>([[startStateKey, null]])
  const stateMap = new Map<string, QueueItem>([
    [startStateKey, { cost: 0, cur: startKey, prev: null, prevLineId: null }],
  ])

  let finalStateKey: string | null = null

  while (queue.size > 0) {
    const current = queue.pop()
    if (!current) {
      break
    }

    const currentStateKey = makeStateKey(current.cur, current.prev, current.prevLineId)
    const knownBest = best.get(currentStateKey)

    if (knownBest === undefined || current.cost !== knownBest) {
      continue
    }

    if (current.cur === endKey) {
      finalStateKey = currentStateKey
      break
    }

    const currentPoint = pointLookup.get(current.cur) ?? keyToPoint(current.cur)
    const prevPoint = current.prev ? (pointLookup.get(current.prev) ?? keyToPoint(current.prev)) : null
    const neighbors = graph.get(current.cur) ?? []

    for (const edge of neighbors) {
      const nextPoint = pointLookup.get(edge.to) ?? keyToPoint(edge.to)

      let stepCost = edge.weight
      stepCost += anglePenalty(prevPoint, currentPoint, nextPoint)

      if (edge.kind === "bridge") {
        stepCost += BRIDGE_EXTRA_PENALTY
      }

      if (current.prevLineId !== null && edge.lineId !== current.prevLineId) {
        stepCost += LINE_CHANGE_PENALTY
      }

      const newCost = current.cost + stepCost
      const nextState: QueueItem = {
        cost: newCost,
        cur: edge.to,
        prev: current.cur,
        prevLineId: edge.lineId,
      }
      const nextStateKey = makeStateKey(nextState.cur, nextState.prev, nextState.prevLineId)

      if (newCost < (best.get(nextStateKey) ?? Number.POSITIVE_INFINITY)) {
        best.set(nextStateKey, newCost)
        parent.set(nextStateKey, currentStateKey)
        stateMap.set(nextStateKey, nextState)
        queue.push(nextState)
      }
    }
  }

  if (!finalStateKey) {
    return null
  }

  const pathKeys: string[] = []
  let cursor: string | null = finalStateKey

  while (cursor !== null) {
    const state = stateMap.get(cursor)
    if (!state) {
      break
    }
    pathKeys.push(state.cur)
    cursor = parent.get(cursor) ?? null
  }

  pathKeys.reverse()

  const result: LonLat[] = []
  for (const key of pathKeys) {
    const point = pointLookup.get(key) ?? keyToPoint(key)
    const prev = result[result.length - 1]
    if (!prev || prev[0] !== point[0] || prev[1] !== point[1]) {
      result.push(point)
    }
  }

  return result
}

function toRouteGeoJson(coords: LonLat[]): FeatureCollection<LineString, { name: string }> {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          name: "rail_route",
        },
        geometry: {
          type: "LineString",
          coordinates: coords.map(([lon, lat]) => [lon, lat]),
        },
      },
    ],
  }
}

export function createRouteEngine(networkGeoJson: GeoJsonObject): RouteEngine {
  const lines = extractLines(networkGeoJson)
  if (lines.length === 0) {
    throw new Error("В файле не найдено ни одного LineString/MultiLineString")
  }

  const { graph: baseGraph, pointLookup: basePointLookup } = buildGraphWithLineIds(lines)

  return {
    findRoute(start: LonLat, end: LonLat) {
      const startProjection = findBestProjection(lines, start)
      const endProjection = findBestProjection(lines, end)

      if (!startProjection || !endProjection) {
        throw new Error("Не удалось спроецировать станции на сеть")
      }

      const graph = cloneGraph(baseGraph)
      const pointLookup = new Map(basePointLookup)

      const startKey = insertProjectionIntoGraph(graph, pointLookup, startProjection)
      const endKey = insertProjectionIntoGraph(graph, pointLookup, endProjection)
      const route = dijkstraPreferSameLine(graph, pointLookup, startKey, endKey)

      if (!route || route.length === 0) {
        throw new Error("Путь не найден")
      }

      return toRouteGeoJson(route)
    },
  }
}
