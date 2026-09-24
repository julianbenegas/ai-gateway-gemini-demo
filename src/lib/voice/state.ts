import type { ResponseState } from './responses'
import type { ToolActivity } from './tool-calls'

/** The one-word status shown next to the voice controls. */
export function voiceState({
  isPlaying,
  isCapturing,
  response,
  activity,
}: {
  isPlaying: boolean
  isCapturing: boolean
  response: ResponseState
  activity: ToolActivity | null
}) {
  if (isPlaying) return 'Speaking'
  if (response === 'writing') return 'Building'
  if (response === 'thinking') return 'Thinking'
  if (activity?.state === 'running') return 'Working'
  return isCapturing ? 'Listening' : 'Muted'
}
