import { listDesigns, studioFailure } from '@/studio/server/store'

export async function GET() {
  try {
    return Response.json(await listDesigns(), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return studioFailure(error)
  }
}
