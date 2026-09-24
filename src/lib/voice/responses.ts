'use client'

import { useEffect, useRef, useState } from 'react'
import { recordVoiceResponse, voiceResponseError } from './diagnostics'
import { useVoiceEvents, type VoiceSession } from './session'

const WAITING =
  'Still waiting for the voice service. You can keep talking or restart voice.'
const INCOMPLETE_TOOL_CALL =
  'Tool arguments were incomplete or invalid JSON. This call was not executed. Recover using the source already in context; prefer short targeted replacements for existing content. Do not resend a whole page for a small edit. If a full rewrite was cut off, split it into smaller edits.'

export type ResponseState = 'idle' | 'thinking' | 'writing'

type ResponseRecord = { valid: boolean; invalid: boolean; interrupted: boolean }

/**
 * Follows each model response: whether it is thinking or writing a tool call,
 * a notice when it stalls, errors when it fails, and one automatic retry when
 * a tool call's JSON arrives cut off.
 */
export function useResponses({ session }: { session: VoiceSession }) {
  const [state, setState] = useState<ResponseState>('idle')
  const lastProgress = useRef(0)
  const responses = useRef(new Map<string, ResponseRecord>())
  const answered = useRef(new Set<string>())
  const retried = useRef(false)
  const { realtime, setError } = session

  useEffect(() => {
    setState('idle')
    responses.current.clear()
    answered.current.clear()
    retried.current = false
  }, [session.generation])

  useEffect(() => {
    if (session.status !== 'connected' || state === 'idle') return
    const timer = setInterval(() => {
      if (Date.now() - lastProgress.current >= 45000) setError(WAITING)
    }, 5000)
    return () => clearInterval(timer)
  }, [session.status, state, setError])

  useVoiceEvents({
    session,
    listener: (event) => {
      const progress = () => (lastProgress.current = Date.now())
      if (
        [
          'response-created',
          'response-done',
          'function-call-arguments-delta',
          'audio-delta',
          'text-delta',
        ].includes(event.type)
      )
        setError((previous) => (previous === WAITING ? null : previous))
      if (event.type === 'speech-started') {
        setError(null)
        setState('idle')
        retried.current = false
        for (const response of responses.current.values())
          response.interrupted = true
      }
      if (
        event.type === 'speech-stopped' ||
        event.type === 'response-created'
      ) {
        progress()
        setState('thinking')
      }
      if (event.type === 'function-call-arguments-delta') {
        progress()
        setState('writing')
      }
      if (event.type === 'audio-delta' || event.type === 'text-delta')
        progress()
      if (
        event.type === 'response-created' ||
        event.type === 'function-call-arguments-done'
      ) {
        const response = responses.current.get(event.responseId) ?? {
          valid: false,
          invalid: false,
          interrupted: false,
        }
        responses.current.set(event.responseId, response)
        if (event.type === 'function-call-arguments-done') {
          try {
            JSON.parse(event.arguments)
            response.valid = true
          } catch {
            response.invalid = true
            if (!answered.current.has(event.callId)) {
              answered.current.add(event.callId)
              realtime.addToolOutput(event.callId, {
                error: INCOMPLETE_TOOL_CALL,
              })
            }
          }
        }
      }
      if (event.type !== 'response-done') return
      progress()
      setState('idle')
      const response = responses.current.get(event.responseId)
      responses.current.delete(event.responseId)
      const details = recordVoiceResponse({
        responseId: event.responseId,
        status: event.status,
        raw: event.raw,
      })
      // A valid tool call means the model continues once it has the result.
      if (
        response?.valid &&
        !response.interrupted &&
        event.status !== 'cancelled'
      )
        setState('thinking')
      if (
        event.status === 'failed' ||
        (event.status === 'incomplete' && !response?.invalid)
      ) {
        setState('idle')
        setError(
          voiceResponseError({
            status: event.status,
            reason: details.errorCode ?? details.reason,
          }),
        )
      }
      if (
        !response?.invalid ||
        response.valid ||
        response.interrupted ||
        event.status === 'cancelled'
      )
        return
      if (
        !retried.current &&
        (event.status === 'completed' || event.status === 'incomplete')
      ) {
        retried.current = true
        setState('thinking')
        realtime.requestResponse()
      } else setError('That edit didn’t finish. Still listening.')
    },
  })

  return { state }
}
