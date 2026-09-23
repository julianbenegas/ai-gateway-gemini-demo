'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway } from '@ai-sdk/gateway'
import { experimental_useRealtime as useRealtime } from '@ai-sdk/react'
import type { Experimental_RealtimeSessionConfig } from 'ai'
import { LIVE_MODEL } from '@/lib/config'
import {
  recordVoiceResponse,
  voiceResponseError,
} from '@/lib/voice-diagnostics'

const model = gateway.experimental_realtime(LIVE_MODEL)
const waitingMessage =
  'Still waiting for the voice service. You can keep talking or restart voice.'
type Activity = {
  id: string
  label: string
  state: 'running' | 'done' | 'error'
}

export function useVoiceAgent({
  tokenEndpoint,
  configuration,
  executeTool,
  labels,
  beforeConnect,
}: {
  tokenEndpoint: string
  configuration: Experimental_RealtimeSessionConfig
  executeTool: (
    name: string,
    args: unknown,
    signal: AbortSignal,
  ) => Promise<unknown>
  labels: Record<string, string>
  beforeConnect?: () => Promise<unknown>
}) {
  const [error, setError] = useState<string | null>(null)
  const [requestingMic, setRequestingMic] = useState(false)
  const [activity, setActivity] = useState<Activity | null>(null)
  const [responseState, setResponseState] = useState<
    'idle' | 'thinking' | 'writing'
  >('idle')
  const lastProgress = useRef(0)
  const stream = useRef<MediaStream | null>(null)
  const epoch = useRef(0)
  const mounted = useRef(true)
  const ending = useRef(false)
  const abort = useRef(new AbortController())
  const calls = useRef(new Map<string, Promise<unknown>>())
  const toolResponses = useRef(
    new Map<
      string,
      { valid: boolean; invalid: boolean; interrupted: boolean }
    >(),
  )
  const retriedTool = useRef(false)

  const releaseMicrophone = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
  }, [])

  const realtime = useRealtime({
    model,
    api: { token: tokenEndpoint },
    sessionConfig: configuration,
    onEvent: (event) => {
      if (ending.current || !mounted.current) return
      if (
        [
          'response-created',
          'response-done',
          'function-call-arguments-delta',
          'audio-delta',
          'text-delta',
        ].includes(event.type)
      ) {
        setError((previous) => (previous === waitingMessage ? null : previous))
      }
      if (event.type === 'speech-started') {
        setError(null)
        setResponseState('idle')
        retriedTool.current = false
        for (const response of toolResponses.current.values())
          response.interrupted = true
      }
      if (
        event.type === 'speech-stopped' ||
        event.type === 'response-created'
      ) {
        lastProgress.current = Date.now()
        setResponseState('thinking')
      }
      if (event.type === 'function-call-arguments-delta') {
        lastProgress.current = Date.now()
        setResponseState('writing')
      }
      if (event.type === 'audio-delta' || event.type === 'text-delta')
        lastProgress.current = Date.now()
      if (
        event.type === 'response-created' ||
        event.type === 'function-call-arguments-done'
      ) {
        const response = toolResponses.current.get(event.responseId) ?? {
          valid: false,
          invalid: false,
          interrupted: false,
        }
        toolResponses.current.set(event.responseId, response)
        if (event.type === 'function-call-arguments-done') {
          try {
            JSON.parse(event.arguments)
            response.valid = true
          } catch {
            response.invalid = true
            if (!calls.current.has(event.callId)) {
              const result = {
                error:
                  'Tool arguments were incomplete or invalid JSON. This call was not executed. Recover using the source already in context; prefer short targeted replacements for existing content. Do not resend a whole page for a small edit. If a full rewrite was cut off, split it into smaller edits.',
              }
              calls.current.set(event.callId, Promise.resolve(result))
              realtime.addToolOutput(event.callId, result)
            }
          }
        }
      }
      if (event.type === 'response-done') {
        lastProgress.current = Date.now()
        setResponseState('idle')
        const response = toolResponses.current.get(event.responseId)
        toolResponses.current.delete(event.responseId)
        const details = recordVoiceResponse(
          event.responseId,
          event.status,
          event.raw,
        )
        if (
          response?.valid &&
          !response.interrupted &&
          event.status !== 'cancelled'
        )
          setResponseState('thinking')
        if (
          event.status === 'failed' ||
          (event.status === 'incomplete' && !response?.invalid)
        ) {
          setResponseState('idle')
          setError(
            voiceResponseError(
              event.status,
              details.errorCode ?? details.reason,
            ),
          )
        }
        if (!response?.invalid) return
        if (
          response.valid ||
          response.interrupted ||
          event.status === 'cancelled'
        )
          return
        if (
          !retriedTool.current &&
          (event.status === 'completed' || event.status === 'incomplete')
        ) {
          retriedTool.current = true
          setResponseState('thinking')
          realtime.requestResponse()
        } else {
          setActivity({
            id: event.responseId,
            label: 'That edit didn’t finish. Still listening.',
            state: 'error',
          })
        }
      }
    },
    onError: (error) => {
      if (error.message.startsWith('Failed to parse tool arguments:')) return
      epoch.current++
      ending.current = true
      abort.current.abort()
      releaseMicrophone()
      setRequestingMic(false)
      disconnect()
      setError(
        error.message.includes('setup: 503')
          ? 'Voice setup failed. Check this deployment’s AI Gateway configuration and try again.'
          : error.message,
      )
    },
    onToolCall: ({ toolCall }) => {
      const existing = calls.current.get(toolCall.toolCallId)
      if (existing) return existing
      const currentEpoch = epoch.current
      const task = (async () => {
        if (ending.current || !mounted.current)
          return { error: 'The voice session has ended.' }
        const entry: Activity = {
          id: toolCall.toolCallId,
          label: labels[toolCall.toolName] || 'Working on the canvas',
          state: 'running',
        }
        setActivity(entry)
        try {
          const result = await executeTool(
            toolCall.toolName,
            toolCall.args,
            abort.current.signal,
          )
          if (currentEpoch === epoch.current && mounted.current) {
            setActivity((previous) =>
              previous?.id === entry.id
                ? { ...entry, state: 'done' }
                : previous,
            )
          }
          return result
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (currentEpoch === epoch.current && mounted.current) {
            setActivity({ ...entry, label: message, state: 'error' })
          }
          return { error: message }
        }
      })()
      calls.current.set(toolCall.toolCallId, task)
      return task
    },
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
    if (status !== 'connected' || responseState === 'idle') return
    const timer = setInterval(() => {
      if (Date.now() - lastProgress.current < 45000) return
      setError(waitingMessage)
    }, 5000)
    return () => clearInterval(timer)
  }, [status, responseState])

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
    if (activity?.state !== 'done') return
    const timer = setTimeout(() => setActivity(null), 2600)
    return () => clearTimeout(timer)
  }, [activity])

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
    setResponseState('idle')
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
      } else {
        ending.current = false
        abort.current = new AbortController()
        calls.current.clear()
        toolResponses.current.clear()
        retriedTool.current = false
        setActivity(null)
        await beforeConnect?.()
        if (
          currentEpoch !== epoch.current ||
          !mounted.current ||
          ending.current
        )
          return
        setRequestingMic(false)
        await connect({ capture: false })
      }
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
    setActivity(null)
    setResponseState('idle')
    releaseMicrophone()
    disconnect()
  }, [releaseMicrophone, disconnect])

  const mute = () => {
    if (realtime.isCapturing) {
      stopAudioCapture()
      releaseMicrophone()
    } else void start()
  }

  const connected = status === 'connected'
  const busy = requestingMic || status === 'connecting'
  const state = realtime.isPlaying
    ? 'Speaking'
    : responseState === 'writing'
      ? 'Building'
      : responseState === 'thinking'
        ? 'Thinking'
        : activity?.state === 'running'
          ? 'Working'
          : realtime.isCapturing
            ? 'Listening'
            : 'Muted'

  return {
    error,
    setError,
    activity,
    setActivity,
    requestingMic,
    status,
    connected,
    busy,
    state,
    start,
    end,
    mute,
    isCapturing: realtime.isCapturing,
    isPlaying: realtime.isPlaying,
  }
}
