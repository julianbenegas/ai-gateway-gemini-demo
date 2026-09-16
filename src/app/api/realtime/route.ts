import { gateway } from '@ai-sdk/gateway'
import { experimental_getRealtimeToolDefinitions } from 'ai'
import { LIVE_MODEL } from '@/lib/config'
import { canvasTools } from '@/lib/tools'
import { checkOrigin, gatewayError } from '@/lib/server'

export async function POST(request: Request) {
  if (!checkOrigin(request))
    return Response.json({ error: 'Invalid request origin' }, { status: 403 })
  try {
    const [credentials, tools] = await Promise.all([
      gateway.experimental_realtime.getToken({
        model: LIVE_MODEL,
        expiresAfterSeconds: 60,
      }),
      experimental_getRealtimeToolDefinitions({ tools: canvasTools }),
    ])
    return Response.json(
      { ...credentials, tools },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error(
      'Realtime setup failed:',
      error instanceof Error ? error.message : 'Unknown error',
    )
    return Response.json({ error: gatewayError(error) }, { status: 503 })
  }
}
