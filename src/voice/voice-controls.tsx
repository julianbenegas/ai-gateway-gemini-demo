'use client'

import { AudioLines, LoaderCircle, Mic, MicOff, Square, X } from 'lucide-react'
import { Button, IconButton } from '@/ui/button'
import { cx } from '@/ui/cx'
import type { VoiceAgent } from './use-voice-agent'

export function VoiceControls({
  voice,
  label,
  ariaLabel,
  onStart = () => void voice.start(),
  disabled,
}: {
  voice: VoiceAgent
  label: string
  ariaLabel?: string
  onStart?: () => void
  disabled?: boolean
}) {
  if (voice.connected)
    return (
      <div className="flex items-center gap-0.5">
        <VoiceState>
          <span
            className={cx(
              'size-1.5',
              voice.isPlaying
                ? 'animate-pulse bg-bright'
                : voice.isCapturing
                  ? 'bg-accent'
                  : 'bg-faint',
            )}
          />
          {voice.state}
        </VoiceState>
        <IconButton
          label={voice.isCapturing ? 'Mute microphone' : 'Unmute microphone'}
          onClick={voice.mute}
          disabled={voice.requestingMic}
        >
          {voice.isCapturing ? <Mic size={15} /> : <MicOff size={15} />}
        </IconButton>
        <IconButton
          label="End voice session"
          variant="danger"
          onClick={voice.end}
        >
          <Square size={11} fill="currentColor" />
        </IconButton>
      </div>
    )
  if (voice.busy)
    return (
      <div className="flex items-center gap-0.5">
        <VoiceState>
          <LoaderCircle size={13} className="animate-spin" />
          {voice.requestingMic ? 'Microphone…' : 'Connecting…'}
        </VoiceState>
        <IconButton label="Cancel voice connection" onClick={voice.end}>
          <X size={14} />
        </IconButton>
      </div>
    )
  return (
    <VoiceStartButton
      label={label}
      aria-label={ariaLabel}
      onClick={onStart}
      disabled={disabled}
    />
  )
}

/** The idle voice button; also a static placeholder before a session loads. */
export function VoiceStartButton({
  label,
  ...props
}: React.ComponentProps<'button'> & { label: string }) {
  return (
    <Button variant="accent" {...props}>
      <AudioLines size={15} />
      {label}
    </Button>
  )
}

function VoiceState({ children }: { children: React.ReactNode }) {
  return (
    <span
      data-voice-state
      role="status"
      className="flex min-w-28 items-center gap-2 px-2 text-xs font-medium text-dim uppercase"
    >
      {children}
    </span>
  )
}
