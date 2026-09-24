'use client'

import { useEffect, useMemo, useRef } from 'react'
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type TLShape,
  useEditor,
  useValue,
} from 'tldraw'
import { BLANK_HTML } from '@/lib/starter-site'
import { cx } from '@/ui/cx'
import {
  buildPreviewDocument,
  getPreviewCapture,
  previewKey,
  registerPreview,
} from '../_lib/capture'

declare module 'tldraw' {
  interface TLGlobalShapePropsMap {
    website: { w: number; h: number; title: string; html: string }
  }
}

export type WebsiteShape = TLShape<'website'>

function Website({ shape }: { shape: WebsiteShape }) {
  const editor = useEditor()
  const frame = useRef<HTMLIFrameElement>(null)
  const editing = useValue(
    'website editing',
    () => editor.getEditingShapeId() === shape.id,
    [editor, shape.id],
  )
  const html = useMemo(
    () => buildPreviewDocument(shape.props.html, window.location.origin),
    [shape.props.html],
  )
  const key = previewKey(shape.props.html, shape.props.w, shape.props.h)
  useEffect(() => {
    if (frame.current) return registerPreview(shape.id, frame.current, key)
  }, [shape.id, key])

  return (
    <HTMLContainer
      data-website
      className={cx(
        'relative bg-white',
        editing && 'outline-2 outline-offset-2 outline-accent',
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 -top-7 flex justify-between gap-4 font-mono text-xs whitespace-nowrap">
        <span className="truncate text-dim">{shape.props.title}</span>
        <span className="text-faint">
          {Math.round(shape.props.w)}×{Math.round(shape.props.h)}
          {editing && <span className="text-accent"> · live</span>}
        </span>
      </div>
      <iframe
        ref={frame}
        title={shape.props.title}
        srcDoc={html}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        className="block size-full scheme-light"
        style={{ pointerEvents: editing ? 'auto' : 'none' }}
      />
    </HTMLContainer>
  )
}

export class WebsiteShapeUtil extends BaseBoxShapeUtil<WebsiteShape> {
  static override type = 'website' as const
  static override props = {
    w: T.nonZeroNumber,
    h: T.nonZeroNumber,
    title: T.string,
    html: T.string,
  }
  override getDefaultProps(): WebsiteShape['props'] {
    return { w: 720, h: 760, title: 'Untitled website', html: BLANK_HTML }
  }
  override canEdit() {
    return true
  }
  override component(shape: WebsiteShape) {
    return <Website shape={shape} />
  }
  override getIndicatorPath(shape: WebsiteShape) {
    const path = new Path2D()
    path.rect(0, 0, shape.props.w, shape.props.h)
    return path
  }
  override toSvg(shape: WebsiteShape) {
    const image = getPreviewCapture(
      shape.id,
      previewKey(shape.props.html, shape.props.w, shape.props.h),
    )
    return image ? (
      <image href={image} width={shape.props.w} height={shape.props.h} />
    ) : (
      <g>
        <rect width={shape.props.w} height={shape.props.h} fill="#f2f0e8" />
        <text x={24} y={40} fontSize={20} fill="#666">
          {shape.props.title} — capture unavailable
        </text>
      </g>
    )
  }
}
