'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway } from '@ai-sdk/gateway'
import {
  experimental_useRealtime as useRealtime,
  type Experimental_UseRealtimeOptions,
} from '@ai-sdk/react'
import type {
  Experimental_RealtimeServerEvent as RealtimeEvent,
  Experimental_RealtimeSessionConfig,
} from 'ai'
import { LIVE_MODEL } from '../models'

const model = gateway.experimental_realtime(LIVE_MODEL)

type ToolCallHandler = NonNullable<
  Experimental_UseRealtimeOptions['onToolCall']
>

export type VoiceSession = ReturnType<typeof useVoiceSession>

/**
 * One realtime voice session: the microphone, the connection, and the raw AI
 * SDK handle (`realtime.messages`, `realtime.events`, `realtime.sendEvent`).
 * Other hooks attach through `subscribe` and `handleToolCalls`.
 *
 * State is per instance, but the microphone, the speakers, and Gateway's
 * session limit are shared, so create one per page and pass it down.
 */
export function useVoiceSession({
  tokenEndpoint,
  configuration,
  beforeConnect,
}: {
  tokenEndpoint: string
  /** Read once: a new config identity would recreate the session. */
  configuration: Experimental_RealtimeSessionConfig
  beforeConnect?: () => Promise<unknown>
}) {
  const [sessionConfig] = useState(configuration)
  const [error, setError] = useState<string | null>(null)
  const [requestingMic, setRequestingMic] = useState(false)
  // Changes when a connection starts or ends, so attached hooks can reset.
  const [generation, setGeneration] = useState(0)
  const stream = useRef<MediaStream | null>(null)
  const epoch = useRef(0)
  const mounted = useRef(true)
  const ending = useRef(false)
  const abort = useRef(new AbortController())
  const listeners = useRef(new Set<(event: RealtimeEvent) => void>())
  const toolCalls = useRef<ToolCallHandler | null>(null)

  const releaseMicrophone = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
  }, [])

  const realtime = useRealtime({
    model,
    api: { token: tokenEndpoint },
    sessionConfig,
    onEvent: (event) => {
      if (ending.current || !mounted.current) return
      for (const listener of listeners.current) listener(event)
    },
    onError: (error) => {
      // Reported through the malformed-call recovery instead.
      if (error.message.startsWith('Failed to parse tool arguments:')) return
      epoch.current++
      ending.current = true
      abort.current.abort()
      releaseMicrophone()
      setRequestingMic(false)
      realtime.disconnect()
      setError(
        error.message.includes('setup: 503')
          ? 'Voice setup failed. Check this deployment’s AI Gateway configuration and try again.'
          : error.message,
      )
    },
    onToolCall: (call) => toolCalls.current?.(call),
  })
  const {
    status,
    startAudioCapture,
    stopAudioCapture,
    disconnect,
    connect,
    resumePlayback,
  } = realtime

  useEffect(() => {
    if (status !== 'connected') return
    try {
      if (!ending.current && stream.current) startAudioCapture(stream.current)
    } catch (error) {
      releaseMicrophone()
      setError(String(error))
      disconnect()
    }
  }, [status, startAudioCapture, releaseMicrophone, disconnect])

  useEffect(() => {
    if (status !== 'disconnected' && status !== 'error') return
    releaseMicrophone()
    abort.current.abort()
  }, [status, releaseMicrophone])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      epoch.current++
      ending.current = true
      abort.current.abort()
      releaseMicrophone()
    }
  }, [releaseMicrophone])

  const start = async () => {
    if (requestingMic || status === 'connecting') return
    const currentEpoch = ++epoch.current
    setError(null)
    setRequestingMic(true)
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      if (currentEpoch !== epoch.current || !mounted.current) {
        media.getTracks().forEach((track) => track.stop())
        return
      }
      stream.current = media
      if (status === 'connected') {
        setRequestingMic(false)
        startAudioCapture(media)
        await resumePlayback()
        return
      }
      ending.current = false
      abort.current = new AbortController()
      setGeneration((value) => value + 1)
      await beforeConnect?.()
      if (currentEpoch !== epoch.current || !mounted.current || ending.current)
        return
      setRequestingMic(false)
      await connect({ capture: false })
    } catch (error) {
      if (currentEpoch !== epoch.current || !mounted.current) return
      releaseMicrophone()
      setRequestingMic(false)
      setError(
        error instanceof Error ? error.message : 'Microphone access failed',
      )
    }
  }

  const end = useCallback(() => {
    epoch.current++
    ending.current = true
    abort.current.abort()
    setRequestingMic(false)
    setGeneration((value) => value + 1)
    releaseMicrophone()
    disconnect()
  }, [releaseMicrophone, disconnect])

  const mute = () => {
    if (realtime.isCapturing) {
      stopAudioCapture()
      releaseMicrophone()
    } else void start()
  }

  const subscribe = useCallback((listener: (event: RealtimeEvent) => void) => {
    listeners.current.add(listener)
    return () => void listeners.current.delete(listener)
  }, [])
  const handleToolCalls = useCallback((handler: ToolCallHandler) => {
    toolCalls.current = handler
    return () => {
      if (toolCalls.current === handler) toolCalls.current = null
    }
  }, [])
  /** Whether work started in session `at` still belongs to the live session. */
  const isCurrent = useCallback(
    (at: number) => at === epoch.current && mounted.current && !ending.current,
    [],
  )

  return {
    realtime,
    status,
    connected: status === 'connected',
    busy: requestingMic || status === 'connecting',
    requestingMic,
    isCapturing: realtime.isCapturing,
    isPlaying: realtime.isPlaying,
    error,
    setError,
    generation,
    start,
    end,
    mute,
    subscribe,
    handleToolCalls,
    /** The current session's number; pass it to `isCurrent` later. */
    epoch: useCallback(() => epoch.current, []),
    isCurrent,
    /** Aborted when the current session ends. */
    signal: useCallback(() => abort.current.signal, []),
  }
}

/** Runs `listener` for every server event while the session is live. */
export function useVoiceEvents({
  session,
  listener,
}: {
  session: VoiceSession
  listener: (event: RealtimeEvent) => void
}) {
  const latest = useRef(listener)
  latest.current = listener
  const { subscribe } = session
  useEffect(() => subscribe((event) => latest.current(event)), [subscribe])
}
