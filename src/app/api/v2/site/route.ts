import { checkOrigin } from '@/lib/server'
import {
  createDesign,
  editSite,
  readSite,
  studioFailure,
} from '@/studio/server/store'

const noStore = { headers: { 'Cache-Control': 'no-store' } }
const forbidden = () =>
  Response.json({ error: 'Invalid request origin' }, { status: 403 })

export async function GET(request: Request) {
  try {
    return Response.json(await readSite(request), noStore)
  } catch (error) {
    return studioFailure(error)
  }
}

export async function POST(request: Request) {
  if (!checkOrigin(request)) return forbidden()
  try {
    return Response.json(await createDesign(), noStore)
  } catch (error) {
    return studioFailure(error)
  }
}

export async function PATCH(request: Request) {
  if (!checkOrigin(request)) return forbidden()
  try {
    return Response.json(await editSite(request), noStore)
  } catch (error) {
    return studioFailure(error)
  }
}
