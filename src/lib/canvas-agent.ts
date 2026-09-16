import {
  Box,
  createShapeId,
  type Editor,
  type TLParentId,
  type TLShapeId,
  type TLShapePartial,
} from 'tldraw'
import { applySchema, inspectSchema, readShapesSchema } from './tools'
import { contentHash } from './content'
import { capturePreview } from './preview'
import type { WebsiteShape } from '@/components/website-shape'

export function readBoard(editor: Editor) {
  return {
    pageId: editor.getCurrentPageId(),
    name: editor.getCurrentPage().name,
    selectedIds: editor.getSelectedShapeIds(),
    viewport: editor.getViewportPageBounds().toJson(),
    pointer: editor.inputs.getCurrentPagePoint(),
    shapes: editor.getCurrentPageShapes().map((shape) => ({
      ...shape,
      props:
        shape.type === 'website'
          ? {
              ...shape.props,
              html: undefined,
              contentHash: contentHash((shape as WebsiteShape).props.html),
            }
          : shape.props,
      pageBounds: editor.getShapePageBounds(shape)?.toJson(),
    })),
  }
}

export function applyCanvasActions(editor: Editor, input: unknown) {
  const { pageId, actions } = applySchema.parse(input)
  if (pageId !== editor.getCurrentPageId())
    throw new Error(
      'The user switched boards. Read the current board before acting.',
    )
  const mark = editor.markHistoryStoppingPoint('agent edit')
  const beforeIds = new Set(editor.getCurrentPageShapeIds())
  const requireIds = (ids: string[]) => {
    const currentIds = editor.getCurrentPageShapeIds()
    for (const id of ids)
      if (!currentIds.has(id as TLShapeId))
        throw new Error(`Shape ${id} is missing from this board`)
    return ids as TLShapeId[]
  }
  try {
    editor.run(() => {
      for (const action of actions) {
        if (action.op === 'create' || action.op === 'update') {
          if (action.shape.parentId && action.shape.parentId !== pageId)
            requireIds([action.shape.parentId])
          if (
            action.shape.props &&
            typeof action.shape.props.html === 'string' &&
            action.shape.props.html.length > 60000
          )
            throw new Error('Keep website HTML under 60000 characters')
        }
        switch (action.op) {
          case 'create': {
            const id = action.shape.id
              ? (action.shape.id as TLShapeId)
              : createShapeId()
            if (editor.getShape(id))
              throw new Error(`Shape ${id} already exists`)
            editor.createShape({
              ...action.shape,
              id,
              parentId: action.shape.parentId ?? pageId,
            } as TLShapePartial)
            break
          }
          case 'update': {
            requireIds([action.shape.id])
            const existing = editor.getShape(action.shape.id as TLShapeId)!
            if (existing.type !== action.shape.type)
              throw new Error('Cannot change a shape type')
            if (
              existing.type === 'website' &&
              action.shape.props?.html !== undefined &&
              action.expectedContentHash !==
                contentHash((existing as WebsiteShape).props.html)
            )
              throw new Error(
                'HTML changed or expectedContentHash is missing. Read the shape again before editing.',
              )
            editor.updateShape(action.shape as TLShapePartial)
            break
          }
          case 'delete':
            editor.deleteShapes(requireIds(action.ids))
            break
          case 'duplicate':
            editor.duplicateShapes(requireIds(action.ids), {
              x: action.dx,
              y: action.dy,
            })
            break
          case 'group':
            editor.groupShapes(requireIds(action.ids))
            break
          case 'ungroup':
            editor.ungroupShapes(requireIds(action.ids))
            break
          case 'reparent':
            if (action.parentId !== pageId) requireIds([action.parentId])
            editor.reparentShapes(
              requireIds(action.ids),
              action.parentId as TLParentId,
            )
            break
          case 'align':
            editor.alignShapes(requireIds(action.ids), action.direction)
            break
          case 'distribute':
            editor.distributeShapes(requireIds(action.ids), action.direction)
            break
          case 'stack':
            editor.stackShapes(
              requireIds(action.ids),
              action.direction,
              action.gap,
            )
            break
          case 'reorder': {
            const ids = requireIds(action.ids)
            if (action.direction === 'front') editor.bringToFront(ids)
            if (action.direction === 'back') editor.sendToBack(ids)
            if (action.direction === 'forward') editor.bringForward(ids)
            if (action.direction === 'backward') editor.sendBackward(ids)
            break
          }
          case 'select':
            editor.select(...requireIds(action.ids))
            break
          case 'focus': {
            const bounds = requireIds(action.ids).map((id) =>
              editor.getShapePageBounds(id)!,
            )
            editor.zoomToBounds(Box.Common(bounds), {
              animation: { duration: 220 },
              inset: 80,
            })
            break
          }
        }
      }
    })
    editor.markHistoryStoppingPoint('after agent edit')
    return {
      ok: true,
      createdIds: [...editor.getCurrentPageShapeIds()].filter(
        (id) => !beforeIds.has(id),
      ),
      board: readBoard(editor),
    }
  } catch (error) {
    editor.bailToMark(mark)
    throw error
  }
}

export async function captureCanvas(editor: Editor) {
  const bounds = editor.getViewportPageBounds()
  const shapes = editor.getCurrentPageShapes().filter((shape) => {
    const box = editor.getShapePageBounds(shape)
    return box && bounds.collides(box)
  })
  if (!shapes.length)
    throw new Error('No shapes are visible. Focus a website first.')
  const websites = shapes.filter((shape) => shape.type === 'website')
  const results = await Promise.allSettled(
    websites.map((shape) => capturePreview(shape.id)),
  )
  const warnings = results.flatMap((result, index) =>
    result.status === 'rejected'
      ? [`${websites[index].id}: ${result.reason}`]
      : [],
  )
  const { url } = await editor.toImageDataUrl(shapes, {
    format: 'png',
    bounds,
    padding: 0,
    background: true,
    scale: Math.min(1, 1500 / bounds.w),
    pixelRatio: 1,
  })
  return { image: url, warnings, bounds: bounds.toJson() }
}

export async function executeCanvasTool(
  editor: Editor,
  name: string,
  args: unknown,
  signal?: AbortSignal,
) {
  switch (name) {
    case 'read_board':
      return readBoard(editor)
    case 'read_shapes': {
      const { ids } = readShapesSchema.parse(args)
      return ids.map((id) => {
        const shape = editor.getShape(id as TLShapeId)
        if (!shape || !editor.getCurrentPageShapeIds().has(shape.id))
          return { id, error: 'Shape missing from current board' }
        return {
          ...shape,
          ...(shape.type === 'website'
            ? { contentHash: contentHash((shape as WebsiteShape).props.html) }
            : {}),
        }
      })
    }
    case 'apply_actions':
      return applyCanvasActions(editor, args)
    case 'inspect_canvas': {
      const { question } = inspectSchema.parse(args)
      const context = readBoard(editor)
      const captured = await captureCanvas(editor)
      const response = await fetch('/api/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...captured, question, context }),
        signal,
      })
      const result = await response.json()
      if (!response.ok)
        throw new Error(result.error || 'Visual inspection failed')
      return { ...result, warnings: captured.warnings, pageId: context.pageId }
    }
    default:
      throw new Error(`Unknown canvas tool: ${name}`)
  }
}
