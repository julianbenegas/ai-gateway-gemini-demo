'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { gateway } from '@ai-sdk/gateway'
import { experimental_useRealtime as useRealtime } from '@ai-sdk/react'
import type { Experimental_RealtimeSessionConfig } from 'ai'
import {
  ArrowUp,
  AudioLines,
  Check,
  Circle,
  Eye,
  LoaderCircle,
  Mic,
  MicOff,
  Square,
  X,
} from 'lucide-react'
import { type Editor, useValue } from 'tldraw'
import { LIVE_MODEL } from '@/lib/config'
import { SYSTEM_PROMPT } from '@/lib/tools'
import { executeCanvasTool, readBoard } from '@/lib/canvas-agent'

const model = gateway.experimental_realtime(LIVE_MODEL)
const sessionConfig: Experimental_RealtimeSessionConfig = {
  instructions: SYSTEM_PROMPT,
  outputModalities: ['audio'],
  inputAudioFormat: { type: 'pcm', rate: 16000 },
  outputAudioFormat: { type: 'pcm', rate: 24000 },
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  turnDetection: { type: 'server-vad' },
}
const labels: Record<string, string> = {
  read_board: 'Looking at the board',
  read_shapes: 'Reading the design',
  apply_actions: 'Updating the canvas',
  inspect_canvas: 'Inspecting the canvas',
}

export function AgentPanel({ editor }: { editor: Editor }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [activity, setActivity] = useState<
    { id: string; label: string; done: boolean }[]
  >([])
  const pendingText = useRef<string | null>(null)
  const pendingStream = useRef<MediaStream | null>(null)
  const captureStream = useRef<MediaStream | null>(null)
  const abort = useRef(new AbortController())
  const calls = useRef(new Map<string, Promise<unknown>>())
  const ending = useRef(false)
  const bottom = useRef<HTMLDivElement>(null)
  const selection = useValue(
    'agent selection',
    () =>
      editor
        .getSelectedShapes()
        .map((shape) =>
          shape.type === 'website' ? String(shape.props.title) : shape.type,
        ),
    [editor],
  )

  const releaseMicrophone = useCallback(() => {
    pendingStream.current?.getTracks().forEach((track) => track.stop())
    captureStream.current?.getTracks().forEach((track) => track.stop())
    pendingStream.current = null
    captureStream.current = null
  }, [])

  const realtime = useRealtime({
    model,
    api: { token: '/api/realtime' },
    sessionConfig,
    onError: (error) => {
      if (pendingText.current) {
        setDraft(pendingText.current)
        pendingText.current = null
      }
      setError(
        error.message.includes('setup: 503')
          ? 'Connect this app to a Vercel project to use AI Gateway. On Vercel, authentication is automatic; locally, use vercel dev.'
          : error.message,
      )
      releaseMicrophone()
    },
    onToolCall: ({ toolCall }) => {
      const existing = calls.current.get(toolCall.toolCallId)
      if (existing) return existing
      const task = (async () => {
        if (ending.current)
          return { error: 'Session ended. No action was taken.' }
        const entry = {
          id: toolCall.toolCallId,
          label: labels[toolCall.toolName] || toolCall.toolName,
          done: false,
        }
        setActivity((previous) => [...previous.slice(-5), entry])
        try {
          return await executeCanvasTool(
            editor,
            toolCall.toolName,
            toolCall.args,
            abort.current.signal,
          )
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : String(error),
          }
        } finally {
          setActivity((previous) =>
            previous.map((item) =>
              item.id === entry.id ? { ...item, done: true } : item,
            ),
          )
        }
      })()
      calls.current.set(toolCall.toolCallId, task)
      return task
    },
  })

  const {
    status,
    sendEvent,
    sendTextMessage,
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
        if (!current) return
        if (pendingStream.current) {
          captureStream.current = pendingStream.current
          pendingStream.current = null
          startAudioCapture(captureStream.current)
        }
        if (pendingText.current) {
          sendTextMessage(pendingText.current)
          pendingText.current = null
        }
      })
      .catch((error) => setError(String(error)))
    return () => {
      current = false
    }
  }, [status, sendContext, sendTextMessage, startAudioCapture])

  useEffect(() => {
    if (status !== 'connected') return
    let timer: ReturnType<typeof setTimeout>
    const changed = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void sendContext().catch((error) => setError(String(error)))
      }, 900)
    }
    const unsubscribe = editor.store.listen(changed, { scope: 'document' })
    const unsubscribeSession = editor.store.listen(changed, {
      scope: 'session',
    })
    return () => {
      clearTimeout(timer)
      unsubscribe()
      unsubscribeSession()
    }
  }, [editor, status, sendContext])

  useEffect(
    () => () => {
      abort.current.abort()
      releaseMicrophone()
    },
    [releaseMicrophone],
  )
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [realtime.messages, activity])

  const prepare = () => {
    ending.current = false
    abort.current = new AbortController()
    calls.current.clear()
    setError(null)
    setActivity([])
  }

  const startVoice = async () => {
    if (status === 'connecting') return
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      if (status === 'connected') {
        captureStream.current = stream
        startAudioCapture(stream)
        await resumePlayback()
      } else {
        prepare()
        pendingStream.current = stream
        await connect({ capture: false })
      }
    } catch (error) {
      releaseMicrophone()
      setError(
        error instanceof Error ? error.message : 'Microphone access failed',
      )
    }
  }

  const end = () => {
    ending.current = true
    abort.current.abort()
    pendingText.current = null
    releaseMicrophone()
    disconnect()
  }

  const submit = async (text = draft) => {
    if (!text.trim() || status === 'connecting') return
    setDraft('')
    setError(null)
    try {
      if (status === 'connected') {
        await sendContext()
        sendTextMessage(text)
      } else {
        prepare()
        pendingText.current = text
        await connect({ capture: false })
      }
    } catch (error) {
      setDraft(text)
      setError(String(error))
    }
  }

  const messages = realtime.messages
    .map((message) => ({
      id: message.id,
      role: message.role,
      text: message.parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join(''),
    }))
    .filter(
      (message) => message.text && !message.text.startsWith('[Board context'),
    )

  return (
    <aside className="agent-panel">
      <div className="panel-heading">
        <div>
          <AudioLines size={17} />
          <span>Design partner</span>
        </div>
        <span className="model-badge">GEMINI LIVE</span>
      </div>
      <div className="agent-scroll">
        <div
          className={`voice-card ${status === 'connected' ? 'connected' : ''}`}
        >
          <div className="voice-orb">
            <AudioLines size={27} strokeWidth={1.3} />
          </div>
          <h2>
            {status === 'connected'
              ? realtime.isPlaying
                ? 'Thinking out loud.'
                : realtime.isCapturing
                  ? 'I’m listening.'
                  : 'Connected.'
              : 'Let’s make something.'}
          </h2>
          <p>
            {status === 'connected'
              ? 'Point, sketch, and tell me what you see.'
              : 'Talk through an idea. Sketch a change. Build it together, right here.'}
          </p>
          <button
            className="voice-button"
            onClick={() => {
              if (realtime.isCapturing) {
                stopAudioCapture()
                releaseMicrophone()
              } else void startVoice()
            }}
            disabled={status === 'connecting'}
          >
            {status === 'connecting' ? (
              <LoaderCircle className="spin" size={15} />
            ) : realtime.isCapturing ? (
              <MicOff size={15} />
            ) : (
              <Mic size={15} />
            )}
            {status === 'connecting'
              ? 'Connecting…'
              : realtime.isCapturing
                ? 'Mute microphone'
                : status === 'connected'
                  ? 'Turn on microphone'
                  : 'Start live session'}
          </button>
          {status === 'connected' && (
            <button className="end-session" onClick={end}>
              <Square size={10} fill="currentColor" /> End session
            </button>
          )}
          {status === 'connecting' && (
            <button className="end-session" onClick={end}>
              Cancel
            </button>
          )}
        </div>
        {!messages.length && (
          <div className="suggestions">
            <div className="section-label">A FEW PLACES TO START</div>
            {[
              'Make a mobile version of this',
              'Try a bolder direction',
              'Build a landing page for a coffee shop',
            ].map((text) => (
              <button
                key={text}
                onClick={() => void submit(text)}
                disabled={status === 'connecting'}
              >
                {text}
                <ArrowUp size={13} />
              </button>
            ))}
          </div>
        )}
        <div className="conversation" aria-live="polite">
          {messages.map((message) => (
            <div key={message.id} className={`message ${message.role}`}>
              <span>{message.role === 'user' ? 'YOU' : 'MARGIN'}</span>
              <p>{message.text}</p>
            </div>
          ))}
        </div>
        {activity.length > 0 && (
          <div className="activity-log">
            {activity.map((item) => (
              <div key={item.id}>
                {item.done ? (
                  <Check size={12} />
                ) : (
                  <LoaderCircle size={12} className="spin" />
                )}
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        )}
        {error && (
          <div className="error-message" role="alert">
            <button aria-label="Dismiss error" onClick={() => setError(null)}>
              <X size={13} />
            </button>
            {error}
          </div>
        )}
        <div ref={bottom} />
      </div>
      <div className="composer-area">
        <div className="context-line">
          <Eye size={13} />
          <span>
            {selection.length
              ? `${selection.length} selected · ${selection[0]}`
              : 'Current board is in context'}
          </span>
          <Circle
            size={6}
            fill={status === 'connected' ? '#76a57c' : '#aaa89f'}
            stroke="none"
          />
        </div>
        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <textarea
            aria-label="Message your design partner"
            placeholder="Or describe what’s on your mind…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
            rows={3}
          />
          <div>
            <span>↵ to send</span>
            <button
              type="submit"
              aria-label="Send message"
              disabled={!draft.trim() || status === 'connecting'}
            >
              <ArrowUp size={17} />
            </button>
          </div>
        </form>
        <p className="privacy-note">
          Your voice and board context are shared during a session.
        </p>
      </div>
    </aside>
  )
}
