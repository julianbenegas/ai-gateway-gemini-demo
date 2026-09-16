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
  if (/auth|oidc|credential|api.key|401|403/i.test(message)) {
    return 'AI Gateway authentication is unavailable. Deploy to a Vercel project with AI Gateway enabled, or run locally with vercel dev in a linked project. No API key is needed on Vercel.'
  }
  return 'AI Gateway could not complete this request. Check the project’s Gateway access and try again.'
}
