'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway } from '@ai-sdk/gateway'
import { experimental_useRealtime as useRealtime } from '@ai-sdk/react'
import {
  AudioLines,
  Check,
  LoaderCircle,
  Mic,
  MicOff,
  Square,
  X,
} from 'lucide-react'
import type { Editor } from 'tldraw'
import { LIVE_MODEL } from '@/lib/config'
import { sessionConfig } from '@/lib/realtime-config'
import { executeCanvasTool } from '@/lib/canvas-agent'
import {
  recordVoiceResponse,
  voiceResponseError,
} from '@/lib/voice-diagnostics'

const model = gateway.experimental_realtime(LIVE_MODEL)
const waitingMessage =
  'Still waiting for the voice service. You can keep talking or restart voice.'
const labels: Record<string, string> = {
  read_board: 'Looking at your board',
  read_shapes: 'Reading the design',
  edit_html: 'Updating the website',
  apply_actions: 'Updating the canvas',
  inspect_canvas: 'Taking a closer look',
}
type Activity = {
  id: string
  label: string
  state: 'running' | 'done' | 'error'
}

export function VoiceSession({ editor }: { editor: Editor }) {
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
    api: { token: '/api/realtime' },
    sessionConfig,
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
                  'Tool arguments were incomplete or invalid JSON. This call was not executed. Recover using the source already in context; prefer edit_html with short replacements for existing websites. Do not resend a whole page for a small edit. If a full rewrite was cut off, split it into smaller edits.',
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
          const result = await executeCanvasTool(
            editor,
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
    const onCrash = () => {
      epoch.current++
      ending.current = true
      abort.current.abort()
      releaseMicrophone()
      disconnect()
      setActivity(null)
      setRequestingMic(false)
      setError(
        'The canvas encountered an error. Refresh the page to reopen your board.',
      )
    }
    editor.on('crash', onCrash)
    return () => {
      editor.off('crash', onCrash)
    }
  }, [editor, releaseMicrophone, disconnect])

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
      setRequestingMic(false)
      if (status === 'connected') {
        startAudioCapture(media)
        await resumePlayback()
      } else {
        ending.current = false
        abort.current = new AbortController()
        calls.current.clear()
        toolResponses.current.clear()
        retriedTool.current = false
        setActivity(null)
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

  const end = () => {
    epoch.current++
    ending.current = true
    abort.current.abort()
    setRequestingMic(false)
    setActivity(null)
    setResponseState('idle')
    releaseMicrophone()
    disconnect()
  }

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

  return (
    <div className="voice-session">
      {connected ? (
        <div className="voice-controls">
          <div
            className={`voice-state ${realtime.isPlaying ? 'is-speaking' : ''}`}
            role="status"
          >
            <span
              className={`voice-indicator ${realtime.isCapturing ? 'is-live' : ''}`}
            />
            <span>{state}</span>
          </div>
          <button
            className="icon-button"
            aria-label={
              realtime.isCapturing ? 'Mute microphone' : 'Unmute microphone'
            }
            onClick={mute}
            disabled={requestingMic}
          >
            {realtime.isCapturing ? <Mic size={15} /> : <MicOff size={15} />}
          </button>
          <span className="divider" />
          <button
            className="icon-button end-voice"
            aria-label="End voice session"
            onClick={end}
          >
            <Square size={12} fill="currentColor" />
          </button>
        </div>
      ) : busy ? (
        <div className="voice-controls">
          <span className="voice-state" role="status">
            <LoaderCircle size={14} className="spin" />
            {requestingMic ? 'Allow microphone…' : 'Connecting…'}
          </span>
          <button
            className="icon-button"
            aria-label="Cancel voice connection"
            onClick={end}
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <button
          className="voice-start"
          onClick={() => void start()}
          title="Talk to Gemini Live. The agent can read your board and website source through its tools."
        >
          <AudioLines size={16} />
          Start voice
        </button>
      )}
      {(activity || error) && (
        <div
          className={`voice-notice ${error || activity?.state === 'error' ? 'is-error' : ''}`}
          role={error || activity?.state === 'error' ? 'alert' : 'status'}
        >
          {error || activity?.state === 'error' ? (
            <span className="notice-error-dot" />
          ) : activity?.state === 'running' ? (
            <LoaderCircle size={13} className="spin" />
          ) : (
            <Check size={13} />
          )}
          <span>{error || activity?.label}</span>
          <button
            className="icon-button"
            aria-label="Dismiss voice notification"
            onClick={() => {
              setError(null)
              setActivity(null)
            }}
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  )
}
