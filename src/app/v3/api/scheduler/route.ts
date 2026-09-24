import { agentServer, scheduler } from '../../_server/agent'

/**
 * The Vercel Queues consumer for the agent's a2 scheduler. The trigger in
 * vercel.json makes this function private to the queue.
 */
export const POST = scheduler.handler(agentServer)

export const maxDuration = 300
