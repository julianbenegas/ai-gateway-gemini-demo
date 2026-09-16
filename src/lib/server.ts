export function checkOrigin(request: Request) {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (!origin || !host) return false
  try {
    const url = new URL(origin)
    return ['http:', 'https:'].includes(url.protocol) && url.host === host
  } catch {
    return false
  }
}

export function gatewayError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  if (
    message.includes('Client secrets can only be minted with a Gateway API key')
  ) {
    return 'Realtime voice requires AI_GATEWAY_API_KEY on the server. OIDC alone cannot mint realtime client tokens.'
  }
  if (/auth|oidc|credential|api.key|401|403/i.test(message)) {
    return 'AI Gateway authentication failed. Check the server’s Gateway credentials.'
  }
  return 'AI Gateway could not complete this request. Check the project’s Gateway access and try again.'
}
