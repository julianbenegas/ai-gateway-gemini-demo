import type { Experimental_RealtimeSessionConfig } from 'ai'

/** Gemini Live audio settings shared by every voice surface. */
export const baseSessionConfig: Experimental_RealtimeSessionConfig = {
  voice: 'Aoede',
  outputModalities: ['audio'],
  inputAudioFormat: { type: 'audio/pcm', rate: 16000 },
  outputAudioFormat: { type: 'audio/pcm', rate: 24000 },
  turnDetection: { type: 'server-vad' },
}
