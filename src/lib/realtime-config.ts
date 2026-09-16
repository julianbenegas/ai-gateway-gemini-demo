import type { Experimental_RealtimeSessionConfig } from 'ai'
import { SYSTEM_PROMPT } from './tools'

export const sessionConfig: Experimental_RealtimeSessionConfig = {
  instructions: SYSTEM_PROMPT,
  voice: 'marin',
  outputModalities: ['audio'],
  inputAudioFormat: { type: 'audio/pcm', rate: 24000 },
  outputAudioFormat: { type: 'audio/pcm', rate: 24000 },
  turnDetection: { type: 'server-vad' },
}
