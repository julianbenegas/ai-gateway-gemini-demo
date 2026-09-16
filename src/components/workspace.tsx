'use client'

import { useCallback, useState } from 'react'
import { getAssetUrls } from '@tldraw/assets/selfHosted'
import { Globe, LayoutGrid, Plus } from 'lucide-react'
import {
  Box,
  PageRecordType,
  createShapeId,
  Tldraw,
  toRichText,
  type Editor,
  type TLComponents,
  useValue,
} from 'tldraw'
import { VoiceSession } from './voice-session'
import { WebsiteShapeUtil } from './website-shape'
import { CanvasContextMenu, CanvasMainMenu } from './canvas-menus'
import { STARTER_HTML } from '@/lib/content'
import { focusCanvas } from '@/lib/canvas-agent'
import { STORAGE_KEY, TLDRAW_LICENSE_KEY } from '@/lib/config'

const shapeUtils = [WebsiteShapeUtil]
const components: TLComponents = {
  PageMenu: null,
  SharePanel: null,
  ContextMenu: CanvasContextMenu,
  MainMenu: CanvasMainMenu,
}
const assetUrls = getAssetUrls({ baseUrl: '/tldraw' })

function EditorChrome({ editor }: { editor: Editor }) {
  const pages = useValue('boards', () => editor.getPages(), [editor])
  const page = useValue('board', () => editor.getCurrentPage(), [editor])
  const newBoard = () => {
    const id = PageRecordType.createId()
    editor.markHistoryStoppingPoint('new board')
    editor.createPage({ id, name: `Untitled board ${pages.length + 1}` })
    editor.setCurrentPage(id)
  }
  return (
    <>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Margin home">
          <span className="brand-symbol">
            <i />
            <i />
          </span>
          margin
        </a>
        <div className="sidebar-heading">
          <span>Boards</span>
          <button
            onClick={newBoard}
            aria-label="New board"
            className="icon-button"
          >
            <Plus size={15} />
          </button>
        </div>
        <nav className="board-list" aria-label="Boards">
          {pages.map((board) => (
            <button
              key={board.id}
              className={board.id === page.id ? 'active' : ''}
              onClick={() => editor.setCurrentPage(board.id)}
            >
              <LayoutGrid size={15} />
              <span>{board.name}</span>
              {board.id === page.id && <span className="active-dot" />}
            </button>
          ))}
        </nav>
      </aside>
      <header className="topbar">
        <input
          key={`${page.id}:${page.name}`}
          className="board-name"
          aria-label="Board name"
          defaultValue={page.name}
          onBlur={(event) => {
            const name = event.target.value.trim()
            if (name && name !== page.name)
              editor.updatePage({ id: page.id, name })
            else event.target.value = page.name
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
        <VoiceSession editor={editor} />
      </header>
    </>
  )
}

export default function Workspace() {
  const [editor, setEditor] = useState<Editor | null>(null)
  const mount = useCallback((editor: Editor) => {
    editor.user.updateUserPreferences({ colorScheme: 'dark' })
    if (
      editor.getPages().length === 1 &&
      editor.getCurrentPageShapes().length === 0 &&
      editor.getCurrentPage().name === 'Page 1'
    ) {
      editor.updatePage({ id: editor.getCurrentPageId(), name: 'First ideas' })
      const id = createShapeId('forma')
      editor.createShapes([
        {
          id,
          type: 'website',
          x: 0,
          y: 0,
          props: {
            w: 720,
            h: 760,
            title: 'Forma · Starting point',
            html: STARTER_HTML,
          },
        },
        {
          type: 'note',
          x: 810,
          y: 95,
          rotation: 0.05,
          props: {
            color: 'yellow',
            size: 'm',
            richText: toRichText('What if this felt a little more playful?'),
          },
        },
      ])
      editor.select(id)
      focusCanvas(
        editor,
        Box.Common(
          editor
            .getCurrentPageShapes()
            .map((shape) => editor.getShapePageBounds(shape)!),
        ),
      )
      editor.clearHistory()
    }
    setEditor(editor)
  }, [])
  return (
    <main className="app-shell">
      <div className="canvas-container">
        <Tldraw
          persistenceKey={STORAGE_KEY}
          shapeUtils={shapeUtils}
          assetUrls={assetUrls}
          components={components}
          onMount={mount}
          licenseKey={TLDRAW_LICENSE_KEY || undefined}
        />
      </div>
      {editor ? (
        <EditorChrome editor={editor} />
      ) : (
        <div className="app-loading">
          <Globe size={26} />
          <span>Opening your workspace…</span>
        </div>
      )}
    </main>
  )
}
