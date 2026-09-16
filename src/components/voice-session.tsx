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
import { executeCanvasTool, readBoard } from '@/lib/canvas-agent'

const model = gateway.experimental_realtime(LIVE_MODEL)
const labels: Record<string, string> = {
  read_board: 'Looking at your board',
  read_shapes: 'Reading the design',
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
  const stream = useRef<MediaStream | null>(null)
  const epoch = useRef(0)
  const mounted = useRef(true)
  const ending = useRef(false)
  const abort = useRef(new AbortController())
  const calls = useRef(new Map<string, Promise<unknown>>())

  const releaseMicrophone = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
  }, [])

  const realtime = useRealtime({
    model,
    api: { token: '/api/realtime' },
    sessionConfig,
    onError: (error) => {
      epoch.current++
      ending.current = true
      abort.current.abort()
      releaseMicrophone()
      setRequestingMic(false)
      disconnect()
      setError(
        error.message.includes('setup: 503')
          ? 'Voice could not connect to AI Gateway. Refresh the Vercel development credentials and try again.'
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
    sendEvent,
    startAudioCapture,
    stopAudioCapture,
    disconnect,
    connect,
    resumePlayback,
  } = realtime

  const sendContext = useCallback(
    () =>
      sendEvent({
        type: 'conversation-item-create',
        item: {
          type: 'text-message',
          role: 'user',
          text: `[Board context update; do not respond to this alone]\n${JSON.stringify(readBoard(editor))}`,
        },
      }),
    [editor, sendEvent],
  )

  useEffect(() => {
    if (status !== 'connected') return
    let current = true
    void sendContext()
      .then(() => {
        if (current && !ending.current && stream.current)
          startAudioCapture(stream.current)
      })
      .catch((error) => {
        releaseMicrophone()
        setError(String(error))
        disconnect()
      })
    return () => {
      current = false
    }
  }, [status, sendContext, startAudioCapture, releaseMicrophone, disconnect])

  useEffect(() => {
    if (status !== 'connected') return
    let timer: ReturnType<typeof setTimeout>
    const changed = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void sendContext().catch((error) => setError(String(error)))
      }, 900)
    }
    const stopDocument = editor.store.listen(changed, { scope: 'document' })
    const stopSession = editor.store.listen(changed, { scope: 'session' })
    return () => {
      clearTimeout(timer)
      stopDocument()
      stopSession()
    }
  }, [editor, status, sendContext])

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
          title="Talk to GPT Realtime 2. Your microphone and board context are shared during the session."
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
