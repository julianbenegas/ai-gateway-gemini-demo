import 'server-only'
import { gateway } from '@ai-sdk/gateway'
import { experimental_getRealtimeToolDefinitions, type ToolSet } from 'ai'
import { LIVE_MODEL } from '@/lib/config'
import { gatewayError } from '@/lib/server'

/** Mints a short-lived browser token for a voice session with these tools. */
export async function realtimeToken(tools: ToolSet) {
  try {
    const [credentials, definitions] = await Promise.all([
      gateway.experimental_realtime.getToken({
        model: LIVE_MODEL,
        expiresAfterSeconds: 60,
      }),
      experimental_getRealtimeToolDefinitions({ tools }),
    ])
    return Response.json(
      { ...credentials, tools: definitions },
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
