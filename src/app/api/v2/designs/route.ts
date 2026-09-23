import { listDesigns, workspaceFailure } from '@/lib/v2/workspace'

export async function GET() {
  try {
    return Response.json(await listDesigns(), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return workspaceFailure(error)
  }
}
