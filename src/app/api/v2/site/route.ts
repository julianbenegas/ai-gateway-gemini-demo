import { checkOrigin } from '@/lib/server'
import { readSite, startWorkspace, workspaceFailure } from '@/lib/v2/workspace'

export const maxDuration = 60

export async function GET() {
  try {
    return Response.json(await readSite(), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return workspaceFailure(error)
  }
}

export async function POST(request: Request) {
  if (!checkOrigin(request))
    return Response.json({ error: 'Invalid request origin' }, { status: 403 })
  try {
    return Response.json(await readSite(await startWorkspace()), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return workspaceFailure(error)
  }
}
