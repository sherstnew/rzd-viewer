import L from "leaflet"

import type { TrainWithCoordinates } from "@/lib/trains"

const RZD_LOGO_SIZE_PX = 15
const LONG_DISTANCE_RZD_LOGO_SIZE_PX = 14
const REX_LOGO_SIZE_PX = 18

export function trainIconSrc(train: TrainWithCoordinates): string {
  const subtypeCode = train.thread.transport_subtype?.code?.toLowerCase() ?? ""
  const subtypeTitle = train.thread.transport_subtype?.title?.toLowerCase() ?? ""

  if (subtypeCode === "rex" || subtypeTitle.includes("рэкс") || subtypeTitle.includes("rex")) {
    return "/leaflet/rex.png"
  }

  if (subtypeTitle.includes("иволга") || subtypeTitle.includes("ivolga")) {
    return "/leaflet/ivolga.svg"
  }

  if (subtypeTitle.includes("стандарт плюс") || subtypeTitle.includes("standard plus")) {
    return "/leaflet/standart.svg"
  }

  if (subtypeTitle.includes("ласточка") || subtypeTitle.includes("lastochka")) {
    return "/leaflet/mostrans.svg"
  }

  return "/leaflet/rzd.svg"
}

function iconVars(vars: Record<string, string | number>): string {
  return Object.entries(vars)
    .map(([key, value]) => `${key}:${value}`)
    .join(";")
}

export function createTrainIconWithSelection(
  iconSrc: string,
  headingDeg: number,
  sizePx: number,
  isSelected: boolean,
  selectedColor: string,
): L.DivIcon {
  const correctedHeading = (headingDeg + 180) % 360
  const isRzdIcon = iconSrc.endsWith("/rzd.svg")
  const isMostransIcon = iconSrc.endsWith("/mostrans.svg")
  const isRexIcon = iconSrc.endsWith("/rex.png")

  const classes = ["train-marker", isSelected ? "is-selected" : ""].filter(Boolean).join(" ")

  const style = iconVars({
    "--train-size": `${sizePx}px`,
    "--train-rotation": `${correctedHeading}deg`,
    "--train-selected-color": selectedColor,
  })

  const innerHtml = isRzdIcon
    ? `<div class="train-marker__pin-shell"><img src="${iconSrc}" alt="Train" class="train-marker__logo train-marker__logo--rzd" style="width:${RZD_LOGO_SIZE_PX}px;height:${RZD_LOGO_SIZE_PX}px" /></div>`
    : isMostransIcon
      ? `<div class="train-marker__pin-shell"><div class="train-marker__mostrans-badge"><img src="${iconSrc}" alt="Train" class="train-marker__logo train-marker__logo--mostrans" /></div></div>`
      : isRexIcon
        ? `<div class="train-marker__pin-shell"><img src="${iconSrc}" alt="Train" class="train-marker__logo train-marker__logo--rex" style="width:${REX_LOGO_SIZE_PX}px;height:${REX_LOGO_SIZE_PX}px" /></div>`
      : `<img src="${iconSrc}" alt="Train" class="train-marker__icon" />`

  const variantClass = isRzdIcon || isMostransIcon || isRexIcon ? "train-marker--pin" : "train-marker--generic"

  return L.divIcon({
    className: "train-marker-wrapper",
    iconSize: [sizePx, sizePx],
    iconAnchor: [sizePx / 2, sizePx / 2],
    html: `<div class="${classes} ${variantClass}" style="${style}">${innerHtml}</div>`,
  })
}

export function createLongDistanceTrainIcon(sizePx: number, isSelected: boolean): L.DivIcon {
  const classes = ["train-marker", "train-marker--long-distance", isSelected ? "is-selected" : ""]
    .filter(Boolean)
    .join(" ")

  const style = iconVars({
    "--train-size": `${sizePx}px`,
  })

  return L.divIcon({
    className: "train-marker-wrapper",
    iconSize: [sizePx, sizePx],
    iconAnchor: [sizePx / 2, sizePx / 2],
    html: `<div class="${classes}" style="${style}"><div class="train-marker__ld-shell"><img src="/leaflet/rzd.svg" alt="RZD" class="train-marker__ld-logo" style="width:${LONG_DISTANCE_RZD_LOGO_SIZE_PX}px;height:${LONG_DISTANCE_RZD_LOGO_SIZE_PX}px" /></div></div>`,
  })
}

