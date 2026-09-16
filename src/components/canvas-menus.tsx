'use client'

import { useState } from 'react'
import {
  createShapeId,
  DefaultContextMenu,
  DefaultContextMenuContent,
  DefaultMainMenu,
  DefaultMainMenuContent,
  serializeTldrawJson,
  TldrawUiMenuGroup,
  TldrawUiMenuItem,
  type TLUiContextMenuProps,
  useEditor,
  useValue,
} from 'tldraw'
import { SourceEditor } from './source-editor'
import type { WebsiteShape } from './website-shape'

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

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
                download(
                  `${website.props.title.replace(/[^a-z0-9-_]/gi, '-').toLowerCase() || 'website'}.html`,
                  website.props.html,
                  'text/html',
                )
              }
            />
          </TldrawUiMenuGroup>
        )}
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

export function CanvasMainMenu() {
  const editor = useEditor()
  return (
    <DefaultMainMenu>
      <TldrawUiMenuGroup id="website-file">
        <TldrawUiMenuItem
          id="add-website"
          label="Add website"
          icon="plus"
          onSelect={() => {
            const id = createShapeId()
            const center = editor.getViewportPageBounds().center
            editor.markHistoryStoppingPoint('add website')
            editor.createShape<WebsiteShape>({
              id,
              type: 'website',
              x: center.x - 360,
              y: center.y - 380,
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
            download(
              `${editor.getCurrentPage().name}.tldr`,
              await serializeTldrawJson(editor),
              'application/json',
            )
          }}
        />
      </TldrawUiMenuGroup>
      <DefaultMainMenuContent />
    </DefaultMainMenu>
  )
}
