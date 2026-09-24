import 'server-only'
import { gateway } from '@ai-sdk/gateway'
import { experimental_getRealtimeToolDefinitions, type ToolSet } from 'ai'
import { HttpError } from './api'
import { LIVE_MODEL } from './models'

/** Mints a short-lived browser token for a Gemini Live session with tools. */
export async function realtimeToken(tools: ToolSet) {
  try {
    const [credentials, definitions] = await Promise.all([
      gateway.experimental_realtime.getToken({
        model: LIVE_MODEL,
        expiresAfterSeconds: 60,
      }),
      experimental_getRealtimeToolDefinitions({ tools }),
    ])
    return { ...credentials, tools: definitions }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('Realtime setup failed:', message)
    throw new HttpError(gatewayError(message), 503)
  }
}

export function gatewayError(message: string) {
  if (
    message.includes('Client secrets can only be minted with a Gateway API key')
  )
    return 'Realtime voice requires AI_GATEWAY_API_KEY on the server. OIDC alone cannot mint realtime client tokens.'
  if (/auth|oidc|credential|api.key|401|403/i.test(message))
    return 'AI Gateway authentication failed. Check the server’s Gateway credentials.'
  return 'AI Gateway could not complete this request. Check the project’s Gateway access and try again.'
}
