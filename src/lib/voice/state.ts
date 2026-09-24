import type { ToolActivity } from './tool-calls'

/** The one-word status shown next to the voice controls. */
export function voiceState({
  isPlaying,
  isCapturing,
  thinking,
  activity,
}: {
  isPlaying: boolean
  isCapturing: boolean
  thinking: boolean
  activity: ToolActivity | null
}) {
  if (isPlaying) return 'Speaking'
  if (activity?.state === 'running') return 'Working'
  if (thinking) return 'Thinking'
  return isCapturing ? 'Listening' : 'Muted'
}
