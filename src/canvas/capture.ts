import { sandboxedDocument, serializeDocument } from '@/lib/preview-policy'

type Preview = { frame: HTMLIFrameElement; key: string }
type Capture = { key: string; dataUrl: string }
const previews = new Map<string, Preview>()
const captures = new Map<string, Capture>()

function contentHash(value: string) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function previewKey(html: string, w: number, h: number) {
  return `${contentHash(html)}:${w}:${h}`
}

export function registerPreview(
  id: string,
  frame: HTMLIFrameElement,
  key: string,
) {
  previews.set(id, { frame, key })
  return () => {
    if (previews.get(id)?.frame === frame) previews.delete(id)
  }
}

export function getPreviewCapture(id: string, key: string) {
  const capture = captures.get(id)
  return capture?.key === key ? capture.dataUrl : undefined
}

export async function capturePreview(id: string): Promise<string> {
  const preview = previews.get(id)
  if (!preview?.frame.contentWindow)
    throw new Error('Website is not currently rendered')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => {
      channel.port1.close()
      reject(new Error('Website capture timed out'))
    }, 10000)
    channel.port1.onmessage = ({ data }) => {
      clearTimeout(timer)
      channel.port1.close()
      if (
        typeof data?.image === 'string' &&
        data.image.startsWith('data:image/png;base64,')
      )
        resolve(data.image)
      else reject(new Error(data?.error || 'Website capture failed'))
    }
    preview.frame.contentWindow!.postMessage({ type: 'margin:capture' }, '*', [
      channel.port2,
    ])
  })
  if (previews.get(id)?.key !== preview.key)
    throw new Error('Website changed during capture; retry')
  captures.set(id, { key: preview.key, dataUrl })
  return dataUrl
}

export function buildPreviewDocument(html: string, origin: string) {
  const doc = sandboxedDocument(html, origin)
  const captureLibrary = doc.createElement('script')
  captureLibrary.src = `${origin}/vendor/html-to-image.js`
  doc.head.append(captureLibrary)
  const bridge = doc.createElement('script')
  bridge.textContent = `window.addEventListener('message', async (event) => {
    if (event.source !== parent || event.data?.type !== 'margin:capture' || !event.ports[0]) return;
    const port = event.ports[0];
    try {
      if (!window.htmlToImage) throw new Error('Capture library is still loading');
      await document.fonts.ready;
      const image = await window.htmlToImage.toPng(document.documentElement, {
        width: innerWidth, height: innerHeight,
        pixelRatio: Math.min(1.5, 1400 / innerWidth), backgroundColor: '#ffffff',
        skipFonts: true,
        style: { transform: 'translate(' + -scrollX + 'px,' + -scrollY + 'px)' },
        filter: (node) => node.tagName !== 'SCRIPT'
      });
      port.postMessage({ image });
    } catch (error) { port.postMessage({ error: String(error) }); }
    finally { port.close(); }
  });`
  doc.head.append(bridge)
  return serializeDocument(doc)
}
