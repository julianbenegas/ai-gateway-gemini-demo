import { checkOrigin } from '@/lib/api'
import { agentServer } from '../../_server/agent'
import { ownsApp } from '../../_server/apps'
import { owner } from '../../_server/auth'

/**
 * The agent's a2 event stream: GET follows an app's log, POST appends the
 * user's messages and controls. Each app's session only opens for its owner.
 */
async function events(request: Request) {
  if (request.method !== 'GET' && !checkOrigin(request))
    return Response.json({ error: 'Cross-origin request.' }, { status: 403 })
  const current = await owner.read()
  if (!current) return Response.json({ error: 'No apps.' }, { status: 401 })
  return agentServer.fetch(request, {
    authorize: ({ sessionId }) => ownsApp({ owner: current, id: sessionId }),
  })
}

export const GET = events
export const POST = events
