import { sandboxedDocument, serializeDocument } from '@/lib/preview-policy'

export function sitePreview(html: string, origin: string) {
  const document = sandboxedDocument(html, origin)
  const bridge = document.createElement('script')
  bridge.src = `${origin}/v2/preview-bridge.js`
  document.head.append(bridge)
  return serializeDocument(document)
}
