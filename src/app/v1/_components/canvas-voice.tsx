'use client'

import { useEffect } from 'react'
import type { Experimental_RealtimeSessionConfig } from 'ai'
import type { Editor } from 'tldraw'
import { Notice } from '@/ui/notice'
import { VoiceControls } from '@/ui/voice-controls'
import { CANVAS_INSTRUCTIONS, canvasTools } from '../_lib/tools'
import { useVoiceAgent } from '../_lib/use-voice-agent'

const configuration = {
  instructions: CANVAS_INSTRUCTIONS,
  voice: 'Aoede',
  outputModalities: ['audio'],
  inputAudioFormat: { type: 'audio/pcm', rate: 16000 },
  outputAudioFormat: { type: 'audio/pcm', rate: 24000 },
  turnDetection: { type: 'server-vad' },
} satisfies Experimental_RealtimeSessionConfig

export function CanvasVoice({ editor }: { editor: Editor | null }) {
  const voice = useVoiceAgent({
    tokenEndpoint: '/v1/api/realtime',
    configuration,
    tools: canvasTools,
    context: editor && { editor },
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
      <VoiceControls
        status={voice}
        label="Start voice"
        onStart={() => void voice.start()}
        onMute={voice.mute}
        onEnd={voice.end}
      />
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
