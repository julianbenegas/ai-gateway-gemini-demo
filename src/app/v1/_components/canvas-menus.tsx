'use client'

import { useState } from 'react'
import {
  createShapeId,
  DefaultContextMenu,
  DefaultContextMenuContent,
  serializeTldrawJson,
  TldrawUiMenuGroup,
  TldrawUiMenuItem,
  type TLUiContextMenuProps,
  useEditor,
  useValue,
} from 'tldraw'
import { download } from '@/lib/download'
import { SourceEditor } from './source-editor'
import type { WebsiteShape } from './website-shape'

export function CanvasContextMenu(props: TLUiContextMenuProps) {
  const editor = useEditor()
  const [source, setSource] = useState<WebsiteShape | null>(null)
  const website = useValue(
    'website menu',
    () => {
      const selected = editor.getOnlySelectedShape()
      return selected?.type === 'website' ? selected : null
    },
    [editor],
  )
  return (
    <>
      <DefaultContextMenu {...props}>
        {website && (
          <TldrawUiMenuGroup id="website">
            <TldrawUiMenuItem
              id="website-code"
              label="View code"
              icon="code"
              onSelect={() => setSource(website)}
            />
            <TldrawUiMenuItem
              id="website-export"
              label="Export as HTML"
              icon="download"
              readonlyOk
              onSelect={() =>
                download({
                  name: `${website.props.title.replace(/[^a-z0-9-_]/gi, '-').toLowerCase() || 'website'}.html`,
                  content: website.props.html,
                  type: 'text/html',
                })
              }
            />
          </TldrawUiMenuGroup>
        )}
        <TldrawUiMenuGroup id="canvas-file">
          <TldrawUiMenuItem
            id="add-website"
            label="Add website"
            icon="plus"
            onSelect={() => {
              const id = createShapeId()
              const point = editor.inputs.getCurrentPagePoint()
              editor.markHistoryStoppingPoint('add website')
              editor.createShape<WebsiteShape>({
                id,
                type: 'website',
                x: point.x - 360,
                y: point.y - 380,
              })
              editor.setCurrentTool('select').select(id)
            }}
          />
          <TldrawUiMenuItem
            id="save-file"
            label="Save .tldr file"
            icon="download"
            readonlyOk
            onSelect={async () => {
              download({
                name: `${editor.getCurrentPage().name}.tldr`,
                content: await serializeTldrawJson(editor),
                type: 'application/json',
              })
            }}
          />
        </TldrawUiMenuGroup>
        <DefaultContextMenuContent />
      </DefaultContextMenu>
      {source && (
        <SourceEditor
          editor={editor}
          shape={source}
          onClose={() => setSource(null)}
        />
      )}
    </>
  )
}
