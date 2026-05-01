import { NextRequest } from "next/server"
import { handleStationPhotoImageRequest } from "../_handler"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  return handleStationPhotoImageRequest(request)
}
