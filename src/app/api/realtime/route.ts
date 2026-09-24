import { canvasTools } from '@/canvas/tools'
import { checkOrigin } from '@/lib/server'
import { realtimeToken } from '@/voice/token'

export async function POST(request: Request) {
  if (!checkOrigin(request))
    return Response.json({ error: 'Invalid request origin' }, { status: 403 })
  return realtimeToken(canvasTools)
}
