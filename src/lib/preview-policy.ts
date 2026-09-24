/**
 * Parses website HTML for a sandboxed iframe: replaces any page CSP with one
 * that blocks network access and only allows scripts from this origin.
 */
export function sandboxedDocument({
  html,
  origin,
}: {
  html: string
  origin: string
}) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  document
    .querySelectorAll('meta[http-equiv="Content-Security-Policy"]')
    .forEach((node) => node.remove())
  const policy = document.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = `default-src 'none'; script-src 'unsafe-inline' ${origin}; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; connect-src 'none'; form-action 'none'; base-uri 'none'`
  document.head.prepend(policy)
  return document
}

export const serializeDocument = (document: Document) =>
  `<!doctype html>\n${document.documentElement.outerHTML}`
