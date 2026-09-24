'use client'

import { useEffect, useRef } from 'react'
import type { Editor } from 'tldraw'
import { Notice } from '@/ui/notice'
import { baseSessionConfig } from '@/voice/session'
import { useVoiceAgent } from '@/voice/use-voice-agent'
import { VoiceControls } from '@/voice/voice-controls'
import { CANVAS_INSTRUCTIONS } from './tools'

const configuration = {
  ...baseSessionConfig,
  instructions: CANVAS_INSTRUCTIONS,
}
const labels: Record<string, string> = {
  read_board: 'Looking at your board',
  read_shapes: 'Reading the design',
  edit_html: 'Updating the website',
  apply_actions: 'Updating the canvas',
  inspect_canvas: 'Taking a closer look',
}

export function CanvasVoice({ editor }: { editor: Editor | null }) {
  const current = useRef(editor)
  current.current = editor
  const voice = useVoiceAgent({
    tokenEndpoint: '/api/realtime',
    configuration,
    labels,
    // The agent imports tldraw, which only loads in the browser with the canvas.
    executeTool: async (name, args, signal) => {
      if (!current.current) throw new Error('The canvas is still loading.')
      const { executeCanvasTool } = await import('./agent')
      return executeCanvasTool(current.current, name, args, signal)
    },
  })
  const { error, setError, activity, setActivity, end } = voice
  useEffect(() => {
    if (!editor) return
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
    <div className="relative">
      <VoiceControls voice={voice} label="Start voice" />
      {(activity || error) && (
        <Notice
          tone={error ? 'error' : activity!.state}
          onDismiss={() => {
            setError(null)
            setActivity(null)
          }}
          className="absolute top-11 right-0"
        >
          {error || activity?.label}
        </Notice>
      )}
    </div>
  )
}
