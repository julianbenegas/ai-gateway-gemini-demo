import {
  AudioLines,
  Brain,
  LoaderCircle,
  MessageSquareText,
  Mic,
  MicOff,
  Square,
  X,
} from 'lucide-react'
import { Button, IconButton } from './button'
import { cx } from './cx'

export type VoiceStatus = {
  connected: boolean
  busy: boolean
  requestingMic: boolean
  isCapturing: boolean
  isPlaying: boolean
  /** Listening, Thinking, Building, Speaking, and so on. */
  state: string
}

export function VoiceControls({
  thinking,
  transcript,
  ...props
}: Parameters<typeof SessionControls>[0] & {
  /** A toggle for the model's extended thinking, fixed while connected. */
  thinking?: { enabled: boolean; locked: boolean; toggle: () => void }
  /** Shows a transcript toggle; pass it once there is something to show. */
  transcript?: { open: boolean; onToggle: () => void }
}) {
  return (
    <div className="flex items-center gap-0.5">
      {thinking && (
        <IconButton
          label="Extended thinking"
          aria-pressed={thinking.enabled}
          disabled={thinking.locked}
          onClick={thinking.toggle}
          variant="toggle"
        >
          <Brain size={15} />
        </IconButton>
      )}
      <SessionControls {...props} />
      {transcript && (
        <IconButton
          label="Show transcript"
          aria-pressed={transcript.open}
          onClick={transcript.onToggle}
        >
          <MessageSquareText size={15} />
        </IconButton>
      )}
    </div>
  )
}

function SessionControls({
  status,
  label,
  ariaLabel,
  disabled,
  onStart,
  onMute,
  onEnd,
}: {
  status: VoiceStatus
  label: string
  ariaLabel?: string
  disabled?: boolean
  onStart: () => void
  onMute: () => void
  onEnd: () => void
}) {
  if (status.connected)
    return (
      <div className="flex items-center gap-0.5">
        <VoiceState>
          <span
            className={cx(
              'size-1.5',
              status.isPlaying
                ? 'animate-pulse bg-bright'
                : status.isCapturing
                  ? 'bg-accent'
                  : 'bg-faint',
            )}
          />
          {status.state}
        </VoiceState>
        <IconButton
          label={status.isCapturing ? 'Mute microphone' : 'Unmute microphone'}
          onClick={onMute}
          disabled={status.requestingMic}
        >
          {status.isCapturing ? <Mic size={15} /> : <MicOff size={15} />}
        </IconButton>
        <IconButton label="End voice session" variant="danger" onClick={onEnd}>
          <Square size={11} fill="currentColor" />
        </IconButton>
      </div>
    )
  if (status.busy)
    return (
      <div className="flex items-center gap-0.5">
        <VoiceState>
          <LoaderCircle size={13} className="animate-spin" />
          {status.requestingMic ? 'Microphone…' : 'Connecting…'}
        </VoiceState>
        <IconButton label="Cancel voice connection" onClick={onEnd}>
          <X size={14} />
        </IconButton>
      </div>
    )
  return (
    <Button
      variant="accent"
      aria-label={ariaLabel}
      onClick={onStart}
      disabled={disabled}
    >
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
