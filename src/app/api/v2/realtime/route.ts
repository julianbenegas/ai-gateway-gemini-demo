import { gateway } from '@ai-sdk/gateway'
import { experimental_getRealtimeToolDefinitions } from 'ai'
import { LIVE_MODEL } from '@/lib/config'
import { checkOrigin, gatewayError } from '@/lib/server'
import { siteTools } from '@/lib/v2/tools'
import {
  getWorkspace,
  WorkspaceError,
  workspaceFailure,
} from '@/lib/v2/workspace'

export const maxDuration = 60

export async function POST(request: Request) {
  if (!checkOrigin(request))
    return Response.json({ error: 'Invalid request origin' }, { status: 403 })
  try {
    await getWorkspace()
    const [credentials, tools] = await Promise.all([
      gateway.experimental_realtime.getToken({
        model: LIVE_MODEL,
        expiresAfterSeconds: 60,
      }),
      experimental_getRealtimeToolDefinitions({ tools: siteTools }),
    ])
    return Response.json(
      { ...credentials, tools },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    if (error instanceof WorkspaceError) return workspaceFailure(error)
    console.error(
      'V2 voice setup failed:',
      error instanceof Error ? error.message : 'Unknown error',
    )
    return Response.json({ error: gatewayError(error) }, { status: 503 })
  }
}
