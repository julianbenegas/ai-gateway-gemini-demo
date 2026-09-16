type ResponseDetails = {
  response?: {
    status_details?: {
      reason?: string
      error?: { code?: string; type?: string }
    }
    usage?: {
      input_tokens?: number
      output_tokens?: number
      total_tokens?: number
      input_token_details?: { cached_tokens?: number }
    }
  }
}

export function recordVoiceResponse(
  responseId: string,
  status: string,
  raw: unknown,
) {
  const response = (raw as ResponseDetails | null)?.response
  const details = {
    time: new Date().toISOString(),
    responseId,
    status,
    reason: response?.status_details?.reason,
    errorCode:
      response?.status_details?.error?.code ??
      response?.status_details?.error?.type,
    inputTokens: response?.usage?.input_tokens,
    outputTokens: response?.usage?.output_tokens,
    cachedTokens: response?.usage?.input_token_details?.cached_tokens,
  }
  console.info('Voice response', details)
  try {
    const previous = JSON.parse(
      localStorage.getItem('margin-voice-diagnostics') || '[]',
    )
    localStorage.setItem(
      'margin-voice-diagnostics',
      JSON.stringify(
        [...(Array.isArray(previous) ? previous : []), details].slice(-100),
      ),
    )
  } catch {}
  return details
}

export function voiceResponseError(status: string, reason?: string) {
  if (reason === 'max_output_tokens')
    return 'The response reached its output limit before finishing. Voice is still connected.'
  if (reason?.includes('context'))
    return 'The voice session reached its context limit. Restart voice to continue with the current board.'
  if (reason?.includes('rate_limit'))
    return 'The voice service reached a usage limit. Please try again shortly.'
  if (reason === 'content_filter')
    return 'The voice service stopped this response. Try describing the change differently.'
  return status === 'failed'
    ? 'The voice service couldn’t finish that response. You can try again.'
    : 'The response stopped before finishing. Voice is still connected.'
}
