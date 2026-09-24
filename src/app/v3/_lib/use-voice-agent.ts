'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Experimental_RealtimeSessionConfig } from 'ai'
import {
  liveProviderOptions,
  nextThinkingLevel,
  type ThinkingLevel,
} from '@/lib/models'
import { writePreference } from '@/lib/preferences'
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
  thinking: thinkingPreference,
  tools,
  context,
  beforeConnect,
}: {
  tokenEndpoint: string
  /** Keep stable, like `tools`. */
  configuration: Experimental_RealtimeSessionConfig
  /** The thinking level it starts with, and the cookie that keeps it. */
  thinking: { initial: ThinkingLevel; cookie: string }
  tools: Tools<Context>
  context: Context | null
  beforeConnect?: () => Promise<unknown>
}) {
  const [thinking, setThinking] = useState(thinkingPreference.initial)
  // Tools run here, in the browser, so their definitions are declared here.
  const sessionConfig = useMemo(
    () => ({
      ...configuration,
      providerOptions: liveProviderOptions({ thinking }),
      tools: realtimeToolDefinitions({ tools }),
    }),
    [configuration, thinking, tools],
  )
  const session = useVoiceSession({
    // The server mints the token for the model the toggle picks.
    tokenEndpoint: `${tokenEndpoint}?thinking=${thinking}`,
    configuration: sessionConfig,
    beforeConnect,
  })
  const { activity, running, dismissActivity } = useToolCalls({
    session,
    tools,
    context,
  })
  const { thinking: reasoning } = useResponses({
    session,
    toolsRunning: running > 0,
  })

  // Where each session began in the transcript, since the model forgets.
  const messages = session.realtime.messages
  const [sessionStarts, setSessionStarts] = useState<number[]>([])
  const count = messages.length
  // `generation` changes as each session starts; mark the messages before it.
  useEffect(() => {
    if (count)
      setSessionStarts((starts) =>
        starts.at(-1) === count ? starts : [...starts, count],
      )
  }, [session.generation])
  useEffect(() => {
    // A new realtime store, as after switching models, starts empty.
    if (!count) setSessionStarts([])
  }, [count])

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
      thinking: reasoning,
      activity,
    }),
    /** The model is chosen when voice connects, so it's fixed during a session. */
    thinking: {
      level: thinking,
      locked: session.connected || session.busy,
      cycle: () => {
        const next = nextThinkingLevel(thinking)
        writePreference({ cookie: thinkingPreference.cookie, value: next })
        setThinking(next)
      },
    },
    start: session.start,
    end: session.end,
    mute: session.mute,
    /** The conversation so far: transcripts, typed messages, and tool calls. */
    messages,
    /** Types to the model in the live session; it answers by voice. */
    sendText: session.connected
      ? (text: string) => session.realtime.sendTextMessage(text)
      : null,
    sessionStarts,
    notice,
    showError: session.setError,
    dismissNotice: () => {
      session.setError(null)
      dismissActivity()
    },
  }
}
