import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createRouteEngine } from "../lib/route-engine.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, "..")

const legacySegments = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "jsons", "trains-with-threads.json"), "utf8"),
)
const stations = JSON.parse(fs.readFileSync(path.join(projectRoot, "jsons", "stations.json"), "utf8"))
const moscowBig = JSON.parse(fs.readFileSync(path.join(projectRoot, "jsons", "moscow-big.json"), "utf8"))

const ROUTE_STATION_DISTANCE_THRESHOLD = 0.00025
const OUTPUT_PATH = path.join(projectRoot, "jsons", "local-trains.json")
const MCK_STATION_CODES = [
  "s9855157",
  "s9855163",
  "s9855164",
  "s9855165",
  "s9855166",
  "s9855167",
  "s9855168",
  "s9855169",
  "s9855170",
  "s9855171",
  "s9855172",
  "s9855158",
  "s9855173",
  "s9855174",
  "s9855175",
  "s9855176",
  "s9855177",
  "s9855178",
  "s9855179",
  "s9855180",
  "s9855181",
  "s9855182",
  "s9855159",
  "s9855184",
  "s9855186",
  "s9601063",
  "s9855187",
  "s9601334",
  "s9855160",
  "s9855161",
  "s9855162",
]

const ROUTE_DEFINITIONS = {
  mcd1: {
    label: "МЦД-1",
    color: "#F6A500",
    start: [37.28264496693386, 55.672407632018555],
    end: [37.484721474868444, 56.01327444797851],
    baseTravelMinutes: 72,
    dwellMinutes: 1,
    terminalPlatform: {
      forward: "обычно 1 путь",
      backward: "обычно 2 путь",
    },
    services: [
      {
        id: "full_local",
        subtype: "ivolga",
        pattern: "all",
        firstForward: 4 * 60 + 26,
        firstBackward: 4 * 60 + 41,
        intervalMinutes: 44,
        count: 23,
      },
      {
        id: "central_local",
        subtype: "ivolga",
        pattern: { fromCode: "s9600721", toCode: "s2000009" },
        firstForward: 5 * 60 + 12,
        firstBackward: 5 * 60 + 36,
        intervalMinutes: 82,
        count: 13,
      },
      {
        id: "north_local",
        subtype: "ivolga",
        pattern: { fromCode: "s2000006", toCode: "s9600781" },
        firstForward: 5 * 60 + 3,
        firstBackward: 5 * 60 + 28,
        intervalMinutes: 79,
        count: 13,
      },
      {
        id: "diameter_fast",
        subtype: "standard",
        pattern: {
          stops: [
            "s9600721",
            "s9602218",
            "s9600941",
            "s9601728",
            "s9876336",
            "s9600821",
            "s9601666",
            "s2000006",
            "s2000009",
            "s9602463",
            "s9889369",
            "s9600851",
            "s9601261",
            "s9600766",
            "s9601281",
            "s9600781",
          ],
        },
        firstForward: 6 * 60 + 7,
        firstBackward: 6 * 60 + 24,
        intervalMinutes: 98,
        count: 11,
      },
    ],
  },
  mcd3: {
    label: "МЦД-3",
    color: "#E95B0C",
    start: [37.173888, 55.980039],
    end: [38.23932639021258, 55.560367089788535],
    baseTravelMinutes: 96,
    dwellMinutes: 1,
    terminalPlatform: {
      forward: "обычно 1 путь",
      backward: "обычно 2 путь",
    },
    services: [
      {
        id: "full_local",
        subtype: "ivolga",
        pattern: "all",
        firstForward: 4 * 60 + 23,
        firstBackward: 4 * 60 + 40,
        intervalMinutes: 42,
        count: 25,
      },
      {
        id: "north_to_lyubertsy",
        subtype: "ivolga",
        pattern: { fromCode: "s9600212", toCode: "s9601636" },
        firstForward: 5 * 60 + 2,
        firstBackward: 5 * 60 + 31,
        intervalMinutes: 88,
        count: 12,
      },
      {
        id: "city_east_local",
        subtype: "ivolga",
        pattern: { fromCode: "s9601312", toCode: "s9601197" },
        firstForward: 5 * 60 + 18,
        firstBackward: 5 * 60 + 54,
        intervalMinutes: 86,
        count: 12,
      },
      {
        id: "diameter_fast",
        subtype: "standard",
        pattern: {
          stops: [
            "s9600212",
            "s9603604",
            "s9603486",
            "s9603406",
            "s9603638",
            "s9603401",
            "s9878110",
            "s9603877",
            "s9603256",
            "s9603458",
            "s9603505",
            "s9601312",
            "s9601647",
            "s9601642",
            "s9601991",
            "s9600931",
            "s9601627",
            "s9601636",
            "s9601919",
            "s9602033",
            "s9601915",
            "s9600921",
            "s9602223",
            "s9600961",
            "s9601841",
            "s9601197",
          ],
        },
        firstForward: 6 * 60 + 11,
        firstBackward: 6 * 60 + 29,
        intervalMinutes: 94,
        count: 10,
      },
    ],
  },
  mcd4: {
    label: "MCD-4",
    color: "#41B384",
    start: [37.066874, 55.550152],
    end: [38.00832, 55.752306],
    baseTravelMinutes: 86,
    dwellMinutes: 1,
    terminalPlatform: {
      forward: "track 1",
      backward: "track 2",
    },
    services: [
      {
        id: "full_local",
        subtype: "ivolga",
        pattern: "all",
        firstForward: 4 * 60 + 22,
        firstBackward: 4 * 60 + 37,
        intervalMinutes: 36,
        count: 30,
      },
      {
        id: "diameter_fast",
        subtype: "standard",
        pattern: "all",
        firstForward: 5 * 60 + 8,
        firstBackward: 5 * 60 + 24,
        intervalMinutes: 72,
        count: 15,
      },
    ],
  },
  mcd5_south: {
    label: "MCD-5",
    color: "#77B729",
    start: [37.640771, 55.729498],
    end: [37.773381, 55.4399],
    baseTravelMinutes: 48,
    dwellMinutes: 1,
    terminalPlatform: {
      forward: "track 1",
      backward: "track 2",
    },
    services: [
      {
        id: "full_local",
        subtype: "suburban",
        pattern: "all",
        firstForward: 4 * 60 + 36,
        firstBackward: 4 * 60 + 49,
        intervalMinutes: 30,
        count: 24,
      },
      {
        id: "standard_plus",
        subtype: "standard",
        pattern: "all",
        firstForward: 5 * 60 + 6,
        firstBackward: 5 * 60 + 19,
        intervalMinutes: 60,
        count: 10,
      },
    ],
  },
  mcd5_north: {
    label: "MCD-5",
    color: "#77B729",
    start: [37.657484, 55.777685],
    end: [37.839165, 56.012485],
    baseTravelMinutes: 42,
    dwellMinutes: 1,
    terminalPlatform: {
      forward: "track 1",
      backward: "track 2",
    },
    services: [
      {
        id: "full_local",
        subtype: "suburban",
        pattern: "all",
        firstForward: 4 * 60 + 28,
        firstBackward: 4 * 60 + 43,
        intervalMinutes: 26,
        count: 28,
      },
      {
        id: "standard_plus",
        subtype: "standard",
        pattern: "all",
        firstForward: 5 * 60 + 2,
        firstBackward: 5 * 60 + 17,
        intervalMinutes: 56,
        count: 10,
      },
    ],
  },
  mcd5_korolev: {
    label: "MCD-5",
    color: "#77B729",
    start: [37.761228, 55.914823],
    end: [37.861022, 55.926201],
    baseTravelMinutes: 15,
    dwellMinutes: 1,
    terminalPlatform: {
      forward: "track 1",
      backward: "track 2",
    },
    services: [
      {
        id: "full_local",
        subtype: "suburban",
        pattern: "all",
        firstForward: 4 * 60 + 41,
        firstBackward: 4 * 60 + 56,
        intervalMinutes: 34,
        count: 22,
      },
      {
        id: "standard_plus",
        subtype: "standard",
        pattern: "all",
        firstForward: 5 * 60 + 12,
        firstBackward: 5 * 60 + 27,
        intervalMinutes: 68,
        count: 8,
      },
    ],
  },
  mck: {
    label: "МЦК",
    color: "#E42D24",
    stationCodes: MCK_STATION_CODES,
    isCircular: true,
    baseTravelMinutes: 88,
    dwellMinutes: 1,
    terminalPlatform: {
      forward: "track 1",
      backward: "track 2",
    },
    services: [
      {
        id: "clockwise_lastochka",
        subtype: "lastochka",
        pattern: "all",
        firstForward: 4 * 60 + 0,
        firstBackward: 4 * 60 + 0,
        intervalMinutes: 12,
        count: 80,
        directions: ["forward", "backward"],
      },
    ],
  },
}

const JITTER_SEQUENCE = [0, 3, -2, 5, -4, 2, -1, 4]

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function toStationRecord(source) {
  const code = source.codes?.yandex_code ?? source.code

  if (!code) {
    throw new Error(`Station without yandex code: ${JSON.stringify(source)}`)
  }

  return {
    type: "station",
    title: source.title,
    short_title: null,
    popular_title: null,
    code,
    station_type: source.station_type ?? "station",
    station_type_name: source.station_type_name ?? "станция",
    transport_type: source.transport_type ?? "train",
  }
}

function parseCoordinate(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string") {
    const normalized = value.trim().replace(",", ".")
    const parsed = Number(normalized)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function formatStopDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  const seconds = String(date.getSeconds()).padStart(2, "0")
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

function formatIsoDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  const seconds = String(date.getSeconds()).padStart(2, "0")
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}+03:00`
}

function createMoscowDate(startDate, minutesFromMidnight) {
  const date = new Date(`${startDate}T00:00:00+03:00`)
  date.setMinutes(date.getMinutes() + minutesFromMidnight)
  return date
}

function addMinutes(date, minutes) {
  const next = new Date(date.getTime())
  next.setMinutes(next.getMinutes() + minutes)
  return next
}

function dedupeByCode(items) {
  const result = []
  const seen = new Set()

  for (const item of items) {
    if (seen.has(item.code)) {
      continue
    }
    seen.add(item.code)
    result.push(item)
  }

  return result
}

function findNearestProjection(point, routeCoordinates) {
  let best = null

  for (let index = 0; index < routeCoordinates.length - 1; index += 1) {
    const start = routeCoordinates[index]
    const end = routeCoordinates[index + 1]
    const dx = end[0] - start[0]
    const dy = end[1] - start[1]
    const lengthSq = dx * dx + dy * dy
    const rawT =
      lengthSq === 0
        ? 0
        : ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSq
    const t = Math.min(1, Math.max(0, rawT))
    const projection = [start[0] + dx * t, start[1] + dy * t]
    const projDx = point[0] - projection[0]
    const projDy = point[1] - projection[1]
    const distanceSq = projDx * projDx + projDy * projDy

    if (!best || distanceSq < best.distanceSq) {
      best = {
        distanceSq,
        segmentIndex: index,
        t,
      }
    }
  }

  return best
}

function buildCumulativeDistances(routeCoordinates) {
  const cumulative = [0]

  for (let index = 1; index < routeCoordinates.length; index += 1) {
    const previous = routeCoordinates[index - 1]
    const current = routeCoordinates[index]
    const segmentLength = Math.hypot(current[0] - previous[0], current[1] - previous[1])
    cumulative.push(cumulative[cumulative.length - 1] + segmentLength)
  }

  return cumulative
}

function stationProgress(nearest, routeCoordinates, cumulativeDistances) {
  const startDistance = cumulativeDistances[nearest.segmentIndex]
  const segmentStart = routeCoordinates[nearest.segmentIndex]
  const segmentEnd = routeCoordinates[nearest.segmentIndex + 1]
  const segmentLength = Math.hypot(
    segmentEnd[0] - segmentStart[0],
    segmentEnd[1] - segmentStart[1],
  )

  return startDistance + segmentLength * nearest.t
}

function buildRouteStations(routeId, engine, stationByCode) {
  const definition = ROUTE_DEFINITIONS[routeId]

  if (definition.stationCodes) {
    return definition.stationCodes.map((code, index) => {
      const station = stationByCode.get(code)
      if (!station) {
        throw new Error(`Failed to resolve station ${code} for ${routeId}`)
      }

      const longitude = parseCoordinate(station.longitude)
      const latitude = parseCoordinate(station.latitude)
      if (longitude === null || latitude === null) {
        throw new Error(`Station ${code} has no coordinates for ${routeId}`)
      }

      return {
        ...toStationRecord(station),
        longitude,
        latitude,
        progress: index,
        distanceSq: 0,
      }
    })
  }

  const route = engine.findRoute(definition.start, definition.end)
  const routeCoordinates = route.features[0]?.geometry.coordinates ?? []
  const cumulativeDistances = buildCumulativeDistances(routeCoordinates)

  const candidates = []

  for (const station of stationByCode.values()) {
    const longitude = parseCoordinate(station.longitude)
    const latitude = parseCoordinate(station.latitude)
    const code = station.codes?.yandex_code

    if (!code || longitude === null || latitude === null) {
      continue
    }

    const nearest = findNearestProjection([longitude, latitude], routeCoordinates)
    if (!nearest || nearest.distanceSq > ROUTE_STATION_DISTANCE_THRESHOLD ** 2) {
      continue
    }

    candidates.push({
      ...toStationRecord(station),
      longitude,
      latitude,
      progress: stationProgress(nearest, routeCoordinates, cumulativeDistances),
      distanceSq: nearest.distanceSq,
    })
  }

  return dedupeByCode(
    candidates.sort(
      (left, right) =>
        left.progress - right.progress ||
        left.distanceSq - right.distanceSq ||
        left.title.localeCompare(right.title, "ru"),
    ),
  )
}

function countStationCodeRouteSegments(routeId, engine, stationByCode) {
  const definition = ROUTE_DEFINITIONS[routeId]
  const stationCodes = definition.stationCodes ?? []
  const coordinates = stationCodes.map((code) => {
    const station = stationByCode.get(code)
    if (!station) {
      throw new Error(`Failed to resolve station ${code} for ${routeId}`)
    }

    const longitude = parseCoordinate(station.longitude)
    const latitude = parseCoordinate(station.latitude)
    if (longitude === null || latitude === null) {
      throw new Error(`Station ${code} has no coordinates for ${routeId}`)
    }

    return [longitude, latitude]
  })
  const pairs = definition.isCircular
    ? coordinates.map((coordinate, index) => [coordinate, coordinates[(index + 1) % coordinates.length]])
    : coordinates.slice(0, -1).map((coordinate, index) => [coordinate, coordinates[index + 1]])

  for (const [start, end] of pairs) {
    const segment = engine.findRoute(start, end)
    const segmentCoordinates = segment.features[0]?.geometry.coordinates ?? []
    if (segmentCoordinates.length < 2) {
      throw new Error(`Failed to build ${routeId} segment ${start.join(",")} -> ${end.join(",")}`)
    }
  }

  return pairs.length
}

function selectPatternStations(routeStations, pattern) {
  if (pattern === "all") {
    return routeStations
  }

  if ("stops" in pattern) {
    const stationsByCode = new Map(routeStations.map((station) => [station.code, station]))
    return pattern.stops.map((code) => stationsByCode.get(code)).filter(Boolean)
  }

  const startIndex = routeStations.findIndex((station) => station.code === pattern.fromCode)
  const endIndex = routeStations.findIndex((station) => station.code === pattern.toCode)

  if (startIndex === -1 || endIndex === -1) {
    throw new Error(`Failed to resolve pattern slice ${pattern.fromCode} -> ${pattern.toCode}`)
  }

  const from = Math.min(startIndex, endIndex)
  const to = Math.max(startIndex, endIndex)
  return routeStations.slice(from, to + 1)
}

function reverseIfNeeded(items, forward) {
  return forward ? items : [...items].reverse()
}

function buildStopList(routeId, stationsForTrain, subtype, departureDate) {
  const definition = ROUTE_DEFINITIONS[routeId]
  const circularLegMinutes = definition.isCircular
    ? Math.max(2, Math.round(definition.baseTravelMinutes / Math.max(1, stationsForTrain.length - 1)))
    : null
  const totalProgress = definition.isCircular
    ? Math.max(1, stationsForTrain.length - 1)
    : stationsForTrain[stationsForTrain.length - 1].progress - stationsForTrain[0].progress || 1
  const dwellMinutes = subtype === "ivolga" || subtype === "lastochka" ? definition.dwellMinutes : 0
  let cursor = new Date(departureDate.getTime())

  return stationsForTrain.map((station, index) => {
    const previous = stationsForTrain[index - 1]
    const progressDelta = previous ? (definition.isCircular ? 1 : station.progress - previous.progress) : 0

    if (index > 0) {
      const travelMinutes =
        circularLegMinutes ??
        Math.max(2, Math.round((progressDelta / totalProgress) * definition.baseTravelMinutes))
      cursor = addMinutes(cursor, travelMinutes)
    }

    const arrival = index === 0 ? null : formatStopDate(cursor)
    const isLast = index === stationsForTrain.length - 1
    const departure = isLast
      ? null
      : formatStopDate(index === 0 ? cursor : addMinutes(cursor, dwellMinutes))

    if (index > 0 && !isLast && dwellMinutes > 0) {
      cursor = addMinutes(cursor, dwellMinutes)
    }

    return {
      station: toStationRecord(station),
      arrival,
      departure,
      duration: previous
        ? Math.max(
            0,
            Math.round(
              (circularLegMinutes ?? (progressDelta / totalProgress) * definition.baseTravelMinutes) *
                60,
            ),
          )
        : 0,
      stop_time: isLast || index === 0 || dwellMinutes === 0 ? null : dwellMinutes * 60,
      platform: index % 2 === 0 ? "обычно 1 путь" : "обычно 2 путь",
      terminal: null,
    }
  })
}

function buildStopsLabel(fullStations, selectedStations) {
  if (fullStations.length === selectedStations.length) {
    return "везде"
  }

  const skipped = fullStations.length - selectedStations.length
  return `с пропуском ${skipped} станц.`
}

function buildSubtype(routeId, subtype) {
  const color = ROUTE_DEFINITIONS[routeId].color

  if (subtype === "ivolga") {
    return {
      title: "Иволга",
      code: routeId,
      color,
    }
  }

  if (subtype === "suburban") {
    return {
      title: "Пригородный поезд",
      code: `${routeId}_suburban`,
      color,
    }
  }

  if (subtype === "lastochka") {
    return {
      title: "Ласточка",
      code: "mck_lastochka",
      color,
    }
  }

  return {
    title: "Стандарт плюс",
    code: `${routeId}_standard`,
    color,
  }
}

function buildVehicle(subtype) {
  if (subtype === "lastochka") {
    return "Ласточка"
  }

  if (subtype === "ivolga") {
    return "Иволга"
  }

  if (subtype === "suburban") {
    return "Пригородный поезд"
  }

  return "Стандарт плюс"
}

function buildNumber(routeId, serviceIndex, tripIndex, forward) {
  const baseByRoute = {
    mcd1: forward ? 1110 : 1610,
    mcd3: forward ? 1310 : 1810,
    mcd4: forward ? 1410 : 1910,
    mcd5_south: forward ? 1510 : 1810,
    mcd5_north: forward ? 5510 : 5810,
    mcd5_korolev: forward ? 5710 : 5910,
    mck: forward ? 7100 : 7600,
  }

  return String(baseByRoute[routeId] + serviceIndex * 100 + tripIndex + 1)
}

function createRichSegment({
  routeId,
  service,
  serviceIndex,
  tripIndex,
  forward,
  routeStations,
  carrier,
  startDate,
}) {
  const definition = ROUTE_DEFINITIONS[routeId]
  const selectedPatternStations = selectPatternStations(routeStations, service.pattern)
  const directionStations = reverseIfNeeded(selectedPatternStations, forward)
  const stationsForTrain = definition.isCircular
    ? [...directionStations, directionStations[0]]
    : directionStations
  const jitter = JITTER_SEQUENCE[tripIndex % JITTER_SEQUENCE.length]
  const firstTripMinutes = forward ? service.firstForward : service.firstBackward
  const departureDate = createMoscowDate(
    startDate,
    firstTripMinutes + tripIndex * service.intervalMinutes + jitter,
  )

  const stops = buildStopList(routeId, stationsForTrain, service.subtype, departureDate)
  const firstStop = stops[0]
  const lastStop = stops[stops.length - 1]
  const departure = new Date(`${firstStop.departure ?? firstStop.arrival}+03:00`)
  const arrival = new Date(`${lastStop.arrival ?? lastStop.departure}+03:00`)
  const fromStation = stationsForTrain[0]
  const toStation = stationsForTrain[stationsForTrain.length - 1]
  const subtype = buildSubtype(routeId, service.subtype)
  const number = buildNumber(routeId, serviceIndex, tripIndex, forward)
  const title = `${fromStation.title} — ${toStation.title}`
  const uid = `local_${routeId}_${service.id}_${forward ? "f" : "b"}_${String(tripIndex + 1).padStart(2, "0")}`

  return {
    mcd_route_id: routeId,
    thread: {
      number,
      title,
      short_title: title,
      express_type: service.subtype === "standard" ? "экспресс" : null,
      transport_type: "suburban",
      carrier: clone(carrier),
      uid,
      vehicle: buildVehicle(service.subtype),
      transport_subtype: subtype,
      thread_method_link: `local://thread/${uid}`,
    },
    stops: buildStopsLabel(routeStations, selectedPatternStations),
    from: toStationRecord(fromStation),
    to: toStationRecord(toStation),
    departure_platform: definition.terminalPlatform.forward,
    arrival_platform: definition.terminalPlatform.backward,
    departure_terminal: null,
    arrival_terminal: null,
    duration: Math.max(0, Math.round((arrival.getTime() - departure.getTime()) / 1000)),
    has_transfers: false,
    tickets_info: null,
    departure: formatIsoDate(departure),
    arrival: formatIsoDate(arrival),
    start_date: startDate,
    thread_route: {
      number,
      title,
      short_title: title,
      express_type: service.subtype === "standard" ? "экспресс" : null,
      transport_type: "suburban",
      carrier: clone(carrier),
      uid,
      vehicle: buildVehicle(service.subtype),
      transport_subtype: subtype,
      thread_method_link: `local://thread/${uid}`,
      days: "ежедневно",
      stops,
    },
    thread_error: null,
  }
}

function generateRichSegments(routeId, routeStations, carrier, startDate) {
  const definition = ROUTE_DEFINITIONS[routeId]
  const segments = []

  definition.services.forEach((service, serviceIndex) => {
    for (let tripIndex = 0; tripIndex < service.count; tripIndex += 1) {
      const directions = service.directions ?? ["forward", "backward"]

      for (const direction of directions) {
        segments.push(
          createRichSegment({
            routeId,
            service,
            serviceIndex,
            tripIndex,
            forward: direction === "forward",
            routeStations,
            carrier,
            startDate,
          }),
        )
      }
    }
  })

  return segments
}

const mcd2Segments = legacySegments
  .filter((segment) => !segment.mcd_route_id)
  .map((segment) => ({
    ...clone(segment),
    mcd_route_id: "mcd2",
  }))

const sampleCarrier = clone(mcd2Segments[0]?.thread?.carrier ?? {})
const sampleDate = mcd2Segments[0]?.start_date ?? "2026-04-18"
const stationByCode = new Map(
  stations
    .filter((station) => typeof station.codes?.yandex_code === "string")
    .map((station) => [station.codes.yandex_code, station]),
)

const engine = createRouteEngine(moscowBig)
const mcd1RouteStations = buildRouteStations("mcd1", engine, stationByCode)
const mcd3RouteStations = buildRouteStations("mcd3", engine, stationByCode)
const mcd4RouteStations = buildRouteStations("mcd4", engine, stationByCode)
const mcd5SouthRouteStations = buildRouteStations("mcd5_south", engine, stationByCode)
const mcd5NorthRouteStations = buildRouteStations("mcd5_north", engine, stationByCode)
const mcd5KorolevRouteStations = buildRouteStations("mcd5_korolev", engine, stationByCode)
const mckRouteStations = buildRouteStations("mck", engine, stationByCode)
const mckBuiltSegments = countStationCodeRouteSegments("mck", engine, stationByCode)

const richSegments = [
  ...generateRichSegments("mcd1", mcd1RouteStations, sampleCarrier, sampleDate),
  ...generateRichSegments("mcd3", mcd3RouteStations, sampleCarrier, sampleDate),
  ...generateRichSegments("mcd4", mcd4RouteStations, sampleCarrier, sampleDate),
  ...generateRichSegments("mcd5_south", mcd5SouthRouteStations, sampleCarrier, sampleDate),
  ...generateRichSegments("mcd5_north", mcd5NorthRouteStations, sampleCarrier, sampleDate),
  ...generateRichSegments("mcd5_korolev", mcd5KorolevRouteStations, sampleCarrier, sampleDate),
  ...generateRichSegments("mck", mckRouteStations, sampleCarrier, sampleDate),
]

const payload = {
  generated_at: new Date().toISOString(),
  segments: [...mcd2Segments, ...richSegments],
}

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2), "utf8")

console.log(
  JSON.stringify(
    {
      output: path.relative(projectRoot, OUTPUT_PATH),
      counts: {
        mcd2: mcd2Segments.length,
        rich: richSegments.length,
        total: payload.segments.length,
      },
      routeStations: {
        mcd1: mcd1RouteStations.length,
        mcd3: mcd3RouteStations.length,
        mcd4: mcd4RouteStations.length,
        mcd5_south: mcd5SouthRouteStations.length,
        mcd5_north: mcd5NorthRouteStations.length,
        mcd5_korolev: mcd5KorolevRouteStations.length,
        mck: mckRouteStations.length,
      },
      builtRouteSegments: {
        mck: `${mckBuiltSegments}/${MCK_STATION_CODES.length}`,
      },
    },
    null,
    2,
  ),
)
