// The server behind each v2 design's preview, in its Vercel Sandbox on port
// 3000 (or on a free port locally, for tests). It serves the design's files
// as a static site with clean URLs, so /about is about.html or
// about/index.html, and adds the studio's bridge to every page. No
// dependencies: the Node in the sandbox image is enough.
//
//   PORT=3000 SITE=/vercel/sandbox/site node server.mjs
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'

const SITE = process.env.SITE ?? join(process.cwd(), 'site')
const BRIDGE = await readFile(new URL('./bridge.js', import.meta.url))
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
}
const MISSING = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not found</title><style>body{margin:0;min-height:100vh;display:grid;place-content:center;font:14px system-ui,sans-serif;color:#666}</style></head><body><p>This page doesn't exist yet.</p></body></html>`

/** The files a URL path can name, in order: exact, .html, then index.html. */
function candidates(pathname) {
  const path = pathname.slice(1)
  if (!path || path.endsWith('/')) return [`${path}index.html`]
  return extname(path) ? [path] : [`${path}.html`, `${path}/index.html`]
}

/** Adds the bridge to a page; `file` tells it which page it's on. */
function withBridge(html, file) {
  const tag = `<script src="/__margin/bridge.js" data-margin-file="${file}"></script>`
  return /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, `${tag}</head>`)
    : html.replace(/^(\s*<!doctype[^>]*>)?/i, (doctype) => doctype + tag)
}

async function read(file) {
  try {
    return await readFile(join(SITE, file))
  } catch {
    return null
  }
}

const server = createServer(async (request, response) => {
  const send = (status, type, body) => {
    response.writeHead(status, {
      'content-type': type,
      'cache-control': 'no-store',
    })
    response.end(request.method === 'HEAD' ? undefined : body)
  }
  if (!['GET', 'HEAD'].includes(request.method ?? ''))
    return send(405, TYPES['.txt'], 'Method not allowed')
  let pathname
  try {
    pathname = decodeURIComponent(
      new URL(request.url ?? '/', 'http://site').pathname,
    )
  } catch {
    return send(400, TYPES['.txt'], 'Bad request')
  }
  if (pathname === '/__margin/bridge.js') return send(200, TYPES['.js'], BRIDGE)
  if (!pathname.split('/').some((segment) => segment.startsWith('.')))
    for (const file of candidates(pathname)) {
      const content = await read(file)
      if (!content) continue
      const type = TYPES[extname(file)] ?? 'application/octet-stream'
      return file.endsWith('.html')
        ? send(200, type, withBridge(content.toString(), file))
        : send(200, type, content)
    }
  const custom = await read('404.html')
  send(
    404,
    TYPES['.html'],
    custom
      ? withBridge(custom.toString(), '404.html')
      : withBridge(MISSING, ''),
  )
})

server.listen(Number(process.env.PORT ?? 3000), () =>
  console.log(`ready ${server.address().port}`),
)
