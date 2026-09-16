import { cp, mkdir } from 'node:fs/promises'
await mkdir('public/vendor', { recursive: true })
await cp(
  'node_modules/html-to-image/dist/html-to-image.js',
  'public/vendor/html-to-image.js',
)
for (const directory of ['fonts', 'icons', 'translations', 'embed-icons']) {
  await cp(
    `node_modules/@tldraw/assets/${directory}`,
    `public/tldraw/${directory}`,
    { recursive: true },
  )
}
