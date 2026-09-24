'use client'

import { useState } from 'react'
import type { Experimental_RealtimeSessionConfig } from 'ai'
import { realtimeToolDefinitions, type Tools } from '@/lib/tools'
import { useResponses } from '@/lib/voice/responses'
import { useVoiceSession } from '@/lib/voice/session'
import { voiceState } from '@/lib/voice/state'
import { useToolCalls } from '@/lib/voice/tool-calls'
import type { NoticeTone } from '@/ui/notice'

/** This example's voice loop, assembled from the pieces in `lib/voice`. */
export function useVoiceAgent<Context>({
  tokenEndpoint,
  configuration,
  tools,
  context,
  beforeConnect,
}: {
  tokenEndpoint: string
  configuration: Experimental_RealtimeSessionConfig
  tools: Tools<Context>
  context: Context | null
  beforeConnect?: () => Promise<unknown>
}) {
  // Tools run here, in the browser, so their definitions are declared here.
  const [sessionConfig] = useState(() => ({
    ...configuration,
    tools: realtimeToolDefinitions({ tools }),
  }))
  const session = useVoiceSession({
    tokenEndpoint,
    configuration: sessionConfig,
    beforeConnect,
  })
  const { activity, dismissActivity } = useToolCalls({
    session,
    tools,
    context,
  })
  const response = useResponses({ session })

  const notice: { tone: NoticeTone; message: string } | null = session.error
    ? { tone: 'error', message: session.error }
    : activity && { tone: activity.state, message: activity.label }

  return {
    connected: session.connected,
    busy: session.busy,
    requestingMic: session.requestingMic,
    isCapturing: session.isCapturing,
    isPlaying: session.isPlaying,
    state: voiceState({
      isPlaying: session.isPlaying,
      isCapturing: session.isCapturing,
      response: response.state,
      activity,
    }),
    start: session.start,
    end: session.end,
    mute: session.mute,
    /** The conversation so far: transcripts and tool calls. */
    messages: session.realtime.messages,
    notice,
    showError: session.setError,
    dismissNotice: () => {
      session.setError(null)
      dismissActivity()
    },
  }
}
