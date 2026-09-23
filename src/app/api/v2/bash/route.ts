import { checkOrigin } from '@/lib/server'
import { cancelBash, runBash, workspaceFailure } from '@/lib/v2/workspace'

export const maxDuration = 180

export async function POST(request: Request) {
  if (!checkOrigin(request))
    return Response.json({ error: 'Invalid request origin' }, { status: 403 })
  try {
    return Response.json(await runBash(request), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return workspaceFailure(error)
  }
}

export async function DELETE(request: Request) {
  if (!checkOrigin(request))
    return Response.json({ error: 'Invalid request origin' }, { status: 403 })
  try {
    return Response.json(await cancelBash(request), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return workspaceFailure(error)
  }
}
