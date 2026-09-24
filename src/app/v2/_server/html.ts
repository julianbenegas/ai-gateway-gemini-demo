import { randomUUID } from 'node:crypto'
import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5'

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

/** A new design is an empty page; the agent writes the first version. */
export const BLANK_DESIGN_HTML = prepareHtml({
  html: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Untitled</title></head><body></body></html>',
  seed: true,
})
