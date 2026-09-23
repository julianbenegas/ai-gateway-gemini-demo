'use client'

import { useEffect } from 'react'
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
import { sessionConfig } from '@/lib/realtime-config'
import { executeCanvasTool } from '@/lib/canvas-agent'
import { useVoiceAgent } from './use-voice-agent'

const labels: Record<string, string> = {
  read_board: 'Looking at your board',
  read_shapes: 'Reading the design',
  edit_html: 'Updating the website',
  apply_actions: 'Updating the canvas',
  inspect_canvas: 'Taking a closer look',
}

export function VoiceSession({ editor }: { editor: Editor }) {
  const voice = useVoiceAgent({
    tokenEndpoint: '/api/realtime',
    configuration: sessionConfig,
    labels,
    executeTool: (name, args, signal) =>
      executeCanvasTool(editor, name, args, signal),
  })
  const {
    error,
    setError,
    activity,
    setActivity,
    requestingMic,
    connected,
    busy,
    state,
    start,
    end,
    mute,
  } = voice
  useEffect(() => {
    const onCrash = () => {
      end()
      setError(
        'The canvas encountered an error. Refresh the page to reopen your board.',
      )
    }
    editor.on('crash', onCrash)
    return () => {
      editor.off('crash', onCrash)
    }
  }, [editor, end, setError])
  return (
    <div className="voice-session">
      {connected ? (
        <div className="voice-controls">
          <div
            className={`voice-state ${voice.isPlaying ? 'is-speaking' : ''}`}
            role="status"
          >
            <span
              className={`voice-indicator ${voice.isCapturing ? 'is-live' : ''}`}
            />
            <span>{state}</span>
          </div>
          <button
            className="icon-button"
            aria-label={
              voice.isCapturing ? 'Mute microphone' : 'Unmute microphone'
            }
            onClick={mute}
            disabled={requestingMic}
          >
            {voice.isCapturing ? <Mic size={15} /> : <MicOff size={15} />}
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
