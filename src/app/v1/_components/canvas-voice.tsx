'use client'

import { useEffect, useState } from 'react'
import type { Experimental_RealtimeSessionConfig } from 'ai'
import type { Editor } from 'tldraw'
import { preferenceCookie } from '@/lib/preferences'
import { Notice } from '@/ui/notice'
import { toolLabels, Transcript } from '@/ui/transcript'
import { VoiceControls } from '@/ui/voice-controls'
import { CANVAS_INSTRUCTIONS, canvasTools } from '../_lib/tools'
import { useVoiceAgent } from '../_lib/use-voice-agent'

const configuration = {
  instructions: CANVAS_INSTRUCTIONS,
  voice: 'Aoede',
  outputModalities: ['audio'],
  inputAudioFormat: { type: 'audio/pcm', rate: 16000 },
  outputAudioFormat: { type: 'audio/pcm', rate: 24000 },
  // Gemini transcribes both sides itself, for the transcript panel.
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  turnDetection: { type: 'server-vad' },
} satisfies Experimental_RealtimeSessionConfig
const labels = toolLabels(canvasTools)

export function CanvasVoice({
  editor,
  thinking,
}: {
  editor: Editor | null
  thinking: boolean
}) {
  const voice = useVoiceAgent({
    tokenEndpoint: '/v1/api/realtime',
    configuration,
    thinking: { initial: thinking, cookie: preferenceCookie.v1.thinking },
    tools: canvasTools,
    context: editor && { editor },
  })
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const { end, showError } = voice
  useEffect(() => {
    if (!editor) return
    const onCrash = () => {
      end()
      showError(
        'The canvas encountered an error. Refresh the page to reopen your board.',
      )
    }
    editor.on('crash', onCrash)
    return () => {
      editor.off('crash', onCrash)
    }
  }, [editor, end, showError])
  return (
    <div className="relative">
      <VoiceControls
        status={voice}
        label="Start voice"
        onStart={() => void voice.start()}
        onMute={voice.mute}
        onEnd={voice.end}
        thinking={voice.thinking}
        transcript={{
          open: transcriptOpen,
          onToggle: () => setTranscriptOpen(!transcriptOpen),
        }}
      />
      <div className="absolute top-11 right-0 z-10 flex flex-col items-end gap-2">
        {voice.notice && (
          <Notice tone={voice.notice.tone} onDismiss={voice.dismissNotice}>
            {voice.notice.message}
          </Notice>
        )}
        {transcriptOpen && (
          <Transcript
            messages={voice.messages}
            sessionStarts={voice.sessionStarts}
            onSend={voice.sendText}
            labels={labels}
            onClose={() => setTranscriptOpen(false)}
          />
        )}
      </div>
    </div>
  )
}
