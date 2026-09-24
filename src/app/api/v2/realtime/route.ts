import { checkOrigin } from '@/lib/server'
import { listDesigns, StudioError, studioFailure } from '@/studio/server/store'
import { siteTools } from '@/studio/tools'
import { realtimeToken } from '@/voice/token'

export async function POST(request: Request) {
  if (!checkOrigin(request))
    return Response.json({ error: 'Invalid request origin' }, { status: 403 })
  try {
    if (!(await listDesigns()).length)
      throw new StudioError('Create a design to start voice.', 401)
  } catch (error) {
    return studioFailure(error)
  }
  return realtimeToken(siteTools)
}
