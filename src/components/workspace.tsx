'use client'

import { useCallback, useState } from 'react'
import { getAssetUrls } from '@tldraw/assets/selfHosted'
import {
  ArrowDownToLine,
  ArrowUpRight,
  AudioLines,
  Check,
  ChevronRight,
  Code2,
  Copy,
  FolderOpen,
  Frame,
  Globe,
  LayoutGrid,
  Maximize,
  Monitor,
  MousePointer2,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  Smartphone,
} from 'lucide-react'
import {
  Box,
  DefaultStylePanel,
  PageRecordType,
  createShapeId,
  serializeTldrawJson,
  Tldraw,
  toRichText,
  type Editor,
  type TLComponents,
  useEditor,
  useValue,
} from 'tldraw'
import { AgentPanel } from './agent-panel'
import { SourceEditor } from './source-editor'
import { WebsiteShapeUtil, type WebsiteShape } from './website-shape'
import { BLANK_HTML, STARTER_HTML } from '@/lib/content'
import { STORAGE_KEY, TLDRAW_LICENSE_KEY } from '@/lib/config'

const shapeUtils = [WebsiteShapeUtil]
function StylePanel() {
  const editor = useEditor()
  const websiteSelected = useValue(
    'website styles',
    () =>
      editor.getCurrentToolId() === 'select' &&
      editor.getSelectedShapes().every((shape) => shape.type === 'website'),
    [editor],
  )
  return websiteSelected ? null : <DefaultStylePanel />
}
const components: TLComponents = {
  PageMenu: null,
  SharePanel: null,
  QuickActions: null,
  StylePanel,
}
const assetUrls = getAssetUrls({ baseUrl: '/tldraw' })

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function EditorChrome({ editor }: { editor: Editor }) {
  const pages = useValue('boards', () => editor.getPages(), [editor])
  const page = useValue('board', () => editor.getCurrentPage(), [editor])
  const websites = useValue(
    'websites',
    () =>
      editor
        .getCurrentPageShapes()
        .filter((shape): shape is WebsiteShape => shape.type === 'website'),
    [editor],
  )
  const selected = useValue(
    'selected website',
    () =>
      editor
        .getSelectedShapes()
        .find((shape): shape is WebsiteShape => shape.type === 'website'),
    [editor],
  )
  const editing = useValue('interacting', () => editor.getEditingShapeId(), [
    editor,
  ])
  const [source, setSource] = useState<WebsiteShape | null>(null)
  const [agentOpen, setAgentOpen] = useState(true)

  const focus = (shape: WebsiteShape) => {
    editor.setCurrentTool('select')
    editor.select(shape.id)
    editor.zoomToBounds(editor.getShapePageBounds(shape)!, {
      animation: { duration: 250 },
      inset: 80,
    })
  }
  const addWebsite = () => {
    const bounds = websites.map((shape) => editor.getShapePageBounds(shape)!)
    const x = bounds.length
      ? Math.max(...bounds.map((box) => box.maxX)) + 90
      : 0
    const id = createShapeId()
    editor.markHistoryStoppingPoint('add website')
    editor.createShape<WebsiteShape>({
      id,
      type: 'website',
      x,
      y: 0,
      props: {
        title: `Untitled ${websites.length + 1}`,
        html: BLANK_HTML,
        w: 720,
        h: 760,
      },
    })
    focus(editor.getShape<WebsiteShape>(id)!)
  }
  const newBoard = () => {
    const id = PageRecordType.createId()
    editor.markHistoryStoppingPoint('new board')
    editor.createPage({ id, name: `Untitled board ${pages.length + 1}` })
    editor.setCurrentPage(id)
  }
  const duplicate = (mobile = false) => {
    if (!selected) return
    const box = editor.getShapePageBounds(selected)!
    const id = createShapeId()
    editor.markHistoryStoppingPoint('website variation')
    editor.createShape<WebsiteShape>({
      id,
      type: 'website',
      x: box.maxX + 80,
      y: box.y,
      props: {
        ...selected.props,
        w: mobile ? 390 : selected.props.w,
        title: `${selected.props.title} · ${mobile ? 'Mobile' : 'Variation'}`,
      },
      meta: { derivedFromShapeId: selected.id },
    })
    editor.select(id)
    editor.zoomToBounds(Box.Common([box, editor.getShapePageBounds(id)!]), {
      animation: { duration: 250 },
      inset: 65,
    })
  }

  return (
    <>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Margin home">
          <span className="brand-symbol">
            <i />
            <i />
          </span>
          margin<span className="brand-period">.</span>
        </a>
        <div className="workspace-name">
          <span className="workspace-avatar">M</span>
          <div>
            Personal workspace<small>A little room for ideas</small>
          </div>
        </div>
        <div className="sidebar-heading">
          <span>YOUR BOARDS</span>
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
        <div className="sidebar-heading designs-heading">
          <span>ON THIS BOARD</span>
          <span className="count">{websites.length}</span>
        </div>
        <div className="website-list">
          {websites.map((shape) => (
            <button
              key={shape.id}
              onClick={() => focus(shape)}
              className={selected?.id === shape.id ? 'selected' : ''}
            >
              {shape.props.w < 500 ? (
                <Smartphone size={15} />
              ) : (
                <Monitor size={15} />
              )}
              <span>
                {shape.props.title}
                <small>
                  {Math.round(shape.props.w)} × {Math.round(shape.props.h)}
                </small>
              </span>
            </button>
          ))}
          {!websites.length && (
            <p className="no-websites">
              A fresh board. Add a website or start with a sketch.
            </p>
          )}
        </div>
        <button className="add-website-sidebar" onClick={addWebsite}>
          <Plus size={14} /> Add website
        </button>
        <div className="sidebar-bottom">
          <div className="local-status">
            <Check size={12} /> Autosaves in this browser
          </div>
          <button
            onClick={async () => {
              try {
                download(
                  `${page.name}.tldr`,
                  await serializeTldrawJson(editor),
                  'application/json',
                )
              } catch {
                alert('Workspace export failed. Please try again.')
              }
            }}
          >
            <ArrowDownToLine size={14} /> Export workspace
            <ArrowUpRight size={12} />
          </button>
        </div>
      </aside>
      <header className="topbar">
        <div className="breadcrumbs">
          <FolderOpen size={15} />
          <span>Workspace</span>
          <ChevronRight size={14} />
          <input
            key={page.id}
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
        </div>
        <div className="topbar-actions">
          <button
            className="secondary-button add-website-top"
            onClick={addWebsite}
          >
            <Plus size={14} /> Website
          </button>
          <button
            className="icon-button"
            aria-label={
              agentOpen ? 'Hide design partner' : 'Show design partner'
            }
            onClick={() => setAgentOpen(!agentOpen)}
          >
            {agentOpen ? (
              <PanelRightClose size={18} />
            ) : (
              <PanelRightOpen size={18} />
            )}
          </button>
        </div>
      </header>
      <div className={`canvas-topbar ${!agentOpen ? 'expanded' : ''}`}>
        <div className="canvas-mode">
          <span className="canvas-mode-dot" />
          {editing ? 'INTERACTING' : 'DESIGN CANVAS'}
        </div>
        <span className="canvas-hint">
          {editing
            ? 'Click the canvas to return to drawing'
            : 'A place to think out loud'}
        </span>
        <button
          className="icon-button"
          aria-label="Fit all designs"
          onClick={() => editor.zoomToFit({ animation: { duration: 220 } })}
        >
          <Maximize size={14} />
        </button>
      </div>
      {selected && (
        <div className={`website-actions ${!agentOpen ? 'expanded' : ''}`}>
          <button onClick={() => setSource(selected)}>
            <Code2 size={14} />
            <span>Code</span>
          </button>
          <span className="divider" />
          <button onClick={() => duplicate()}>
            <Copy size={14} />
            <span>Variation</span>
          </button>
          <button onClick={() => duplicate(true)}>
            <Smartphone size={14} />
            <span>Mobile</span>
          </button>
          <span className="divider" />
          <button
            className={editing === selected.id ? 'active' : ''}
            onClick={() => {
              editor.setCurrentTool('select')
              editor.setEditingShape(
                editing === selected.id ? null : selected.id,
              )
            }}
          >
            {editing === selected.id ? (
              <Pencil size={14} />
            ) : (
              <MousePointer2 size={14} />
            )}
            <span>{editing === selected.id ? 'Annotate' : 'Interact'}</span>
          </button>
          <button
            aria-label="Download HTML"
            onClick={() =>
              download(
                `${selected.props.title.replace(/[^a-z0-9-_]/gi, '-').toLowerCase()}.html`,
                selected.props.html,
                'text/html',
              )
            }
          >
            <ArrowDownToLine size={14} />
          </button>
        </div>
      )}
      <div className={`canvas-footnote ${!agentOpen ? 'expanded' : ''}`}>
        <Frame size={12} />
        <span>Draw anywhere. Double-click a website to explore it.</span>
      </div>
      <div className={`agent-container ${!agentOpen ? 'is-hidden' : ''}`}>
        <AgentPanel editor={editor} />
      </div>
      {!agentOpen && (
        <button className="reopen-agent" onClick={() => setAgentOpen(true)}>
          <AudioLines size={18} /> Design partner
        </button>
      )}
      <style>{`.canvas-container { right: ${agentOpen ? 'var(--agent-width)' : '0px'}; }`}</style>
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

export default function Workspace() {
  const [editor, setEditor] = useState<Editor | null>(null)
  const mount = useCallback((editor: Editor) => {
    editor.user.updateUserPreferences({ colorScheme: 'light' })
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
      editor.zoomToBounds(
        Box.Common(
          editor
            .getCurrentPageShapes()
            .map((shape) => editor.getShapePageBounds(shape)!),
        ),
        { inset: 100 },
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
