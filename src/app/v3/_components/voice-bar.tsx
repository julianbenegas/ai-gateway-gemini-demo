'use client'

import { useState } from 'react'
import type { ThinkingLevel } from '@/lib/models'
import { preferenceCookie } from '@/lib/preferences'
import { Notice } from '@/ui/notice'
import { toolLabels, Transcript } from '@/ui/transcript'
import { VoiceControls } from '@/ui/voice-controls'
import { useVoiceAgent } from '../_lib/use-voice-agent'
import { voiceConfiguration, voiceTools } from '../_lib/voice'

const labels = toolLabels(voiceTools)

/** Voice mode: talk with Gemini Live, which delegates to the coding agent. */
export function VoiceBar({
  appId,
  thinking,
}: {
  appId: string
  thinking: ThinkingLevel
}) {
  const voice = useVoiceAgent({
    tokenEndpoint: '/v3/api/realtime',
    configuration: voiceConfiguration,
    thinking: { initial: thinking, cookie: preferenceCookie.v3.thinking },
    tools: voiceTools,
    context: { appId },
  })
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  return (
    <div className="relative">
      <VoiceControls
        status={voice}
        label="Voice mode"
        onStart={() => void voice.start()}
        onMute={voice.mute}
        onEnd={voice.end}
        thinking={voice.thinking}
        transcript={{
          open: transcriptOpen,
          onToggle: () => setTranscriptOpen(!transcriptOpen),
        }}
      />
      <div className="absolute top-9 right-0 flex flex-col items-end gap-2">
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
