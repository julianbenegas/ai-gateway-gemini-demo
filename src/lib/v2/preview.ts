export function sitePreview(html: string, origin: string) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  document
    .querySelectorAll('meta[http-equiv="Content-Security-Policy"]')
    .forEach((node) => node.remove())
  const policy = document.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = `default-src 'none'; script-src 'unsafe-inline' ${origin}; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; connect-src 'none'; form-action 'none'; base-uri 'none'`
  document.head.prepend(policy)
  const bridge = document.createElement('script')
  bridge.src = `${origin}/v2-preview.js`
  document.head.append(bridge)
  return `<!doctype html>\n${document.documentElement.outerHTML}`
}
