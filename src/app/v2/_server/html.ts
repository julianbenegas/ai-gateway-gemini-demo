import { randomUUID } from 'node:crypto'
import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5'
import { STARTER_HTML } from '@/lib/starter-site'

export function prepareHtml({
  html,
  seed = false,
}: {
  html: string
  seed?: boolean
}) {
  const document = parse(html)
  const ids = new Set<string>()
  let n = 0
  function visit({
    node,
    insideBody = false,
  }: {
    node: DefaultTreeAdapterMap['node']
    insideBody?: boolean
  }) {
    if ('tagName' in node) {
      insideBody ||= node.tagName === 'body'
      if (
        insideBody &&
        !['script', 'style', 'link', 'meta', 'noscript', 'template'].includes(
          node.tagName,
        )
      ) {
        const attribute = node.attrs.find(
          (attr) => attr.name === 'data-margin-id',
        )
        let id = attribute?.value
        if (!id || ids.has(id)) id = seed ? `el-${++n}` : `el-${randomUUID()}`
        if (attribute) attribute.value = id
        else node.attrs.push({ name: 'data-margin-id', value: id })
        ids.add(id)
      }
    }
    if ('childNodes' in node)
      for (const child of node.childNodes) visit({ node: child, insideBody })
  }
  visit({ node: document })
  return serialize(document)
}

const starter = STARTER_HTML.replace(
  '</style>',
  `
body{max-width:1440px;margin:auto}nav{padding:32px 6%}.hero{padding:70px 6% 48px}h1{font-size:clamp(54px,7vw,112px);max-width:900px}.eyebrow{font-size:11px}.intro p{font-size:15px;max-width:430px}.button{font-size:13px}.scene{height:380px;margin:0 3%}.caption,.footer{padding-left:6%;padding-right:6%}
@media(max-width:600px){.hero{padding-top:40px}.scene{height:270px}.intro p{font-size:12px}}
</style>`,
)

export const STUDIO_STARTER_HTML = prepareHtml({ html: starter, seed: true })
