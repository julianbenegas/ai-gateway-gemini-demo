'use client'

import { useEffect, useRef, useState } from 'react'
import { useVoiceEvents, type VoiceSession } from './session'

const WAITING =
  'Still waiting for the voice service. You can keep talking or restart voice.'

/**
 * Whether Gemini is reasoning in the background. Extended thinking ends a
 * turn with `interactionStatus: IN_PROGRESS`, goes quiet, then answers and
 * reports `IDLE`; a notice appears if that silence lasts too long.
 */
export function useResponses({ session }: { session: VoiceSession }) {
  const [thinking, setThinking] = useState(false)
  const lastProgress = useRef(0)
  const { setError } = session

  useEffect(() => setThinking(false), [session.generation])

  useEffect(() => {
    if (session.status !== 'connected' || !thinking) return
    const timer = setInterval(() => {
      if (Date.now() - lastProgress.current >= 45000) setError(WAITING)
    }, 5000)
    return () => clearInterval(timer)
  }, [session.status, thinking, setError])

  useVoiceEvents({
    session,
    listener: (event) => {
      const progress = () => {
        lastProgress.current = Date.now()
        setError((previous) => (previous === WAITING ? null : previous))
      }
      if (
        event.type === 'audio-delta' ||
        event.type === 'function-call-arguments-done'
      )
        progress()
      // The user talked over the model.
      if (event.type === 'speech-started') setThinking(false)
      if (event.type === 'custom' && event.rawType === 'interactionStatus') {
        const status = (
          event.raw as { serverContent?: { interactionStatus?: string } }
        )?.serverContent?.interactionStatus
        progress()
        setThinking(status === 'IN_PROGRESS')
      }
    },
  })

  return { thinking }
}
