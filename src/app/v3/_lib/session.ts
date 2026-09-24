'use client'

import { createClient } from 'experimental-a2/client'
import { createReact } from 'experimental-a2/react'
import { appAgent } from './agent'

/** Follows an app's conversation log over the events route. */
export const agentClient = createClient({
  reducer: appAgent.reducer,
  api: '/v3/api/events',
})

export const { SessionProvider, useSession } = createReact({
  client: agentClient,
})
