// Type-only tldraw imports keep this module loadable on the server, where the
// voice controls render before the canvas does.
import type {
  Box,
  Editor,
  TLParentId,
  TLShape,
  TLShapeId,
  TLShapePartial,
} from 'tldraw'
import type { z } from 'zod'
import { applyReplacements } from '@/lib/replacements'
import { unwrap } from '@/lib/rpc'
import { capturePreview } from './capture'
import { api } from './rpc'
import type { applySchema, editHtmlSchema } from './schemas'

export function focusCanvas({
  editor,
  bounds,
}: {
  editor: Editor
  bounds: Box
}) {
  editor.zoomToBounds(bounds, {
    animation: { duration: 220 },
    inset: Math.min(220, editor.getViewportScreenBounds().w / 3),
  })
}

export function describeShape({
  editor,
  shape,
  includeHtml,
}: {
  editor: Editor
  shape: TLShape
  includeHtml: boolean
}) {
  return {
    ...shape,
    props:
      shape.type === 'website' && !includeHtml
        ? { ...shape.props, html: undefined }
        : shape.props,
    pageId: editor.getAncestorPageId(shape),
    pageBounds: editor.getShapePageBounds(shape)?.toJson(),
  }
}

export function readBoard({ editor }: { editor: Editor }) {
  const shapes = editor.getCurrentPageShapes()
  const selectedIds = editor.getSelectedShapeIds()
  const viewport = editor.getViewportPageBounds()
  return {
    pageId: editor.getCurrentPageId(),
    name: editor.getCurrentPage().name,
    pages: editor.getPages().map(({ id, name }) => ({ id, name })),
    selectedIds,
    hoveredShapeId: editor.getHoveredShapeId(),
    editingShapeId: editor.getEditingShapeId(),
    selectedWebsiteIds: shapes
      .filter(
        (shape) =>
          shape.type === 'website' &&
          (selectedIds.includes(shape.id) ||
            editor
              .getShapeAncestors(shape)
              .some((parent) => selectedIds.includes(parent.id))),
      )
      .map((shape) => shape.id),
    visibleShapeIds: shapes
      .filter((shape) => {
        const bounds = editor.getShapePageBounds(shape)
        return bounds && viewport.collides(bounds)
      })
      .map((shape) => shape.id),
    viewport: viewport.toJson(),
    pointer: editor.inputs.getCurrentPagePoint(),
    shapes: shapes.map((shape) =>
      describeShape({ editor, shape, includeHtml: false }),
    ),
  }
}

export function applyCanvasActions({
  editor,
  input: { pageId, actions },
}: {
  editor: Editor
  input: z.infer<typeof applySchema>
}) {
  const before = new Map(
    editor.store.query
      .records('shape')
      .get()
      .map((shape) => [shape.id, shape]),
  )
  const missingIds = new Set<string>()
  const existingIds = (ids: string[]) =>
    ids.filter((id) => {
      if (editor.getShape(id as TLShapeId)) return true
      missingIds.add(id)
      return false
    }) as TLShapeId[]
  const mark = editor.markHistoryStoppingPoint('agent edit')
  let failure: Error | undefined
  editor.run(() => {
    try {
      for (const action of actions) {
        switch (action.op) {
          case 'create': {
            const id =
              (action.shape.id as TLShapeId | undefined) ??
              (`shape:${crypto.randomUUID()}` as TLShapeId)
            if (editor.getShape(id))
              throw new Error(
                `Shape ${id} already exists. Use a new ID to create another shape.`,
              )
            editor.createShape({
              ...action.shape,
              id,
              parentId:
                action.shape.parentId ?? pageId ?? editor.getCurrentPageId(),
            } as TLShapePartial)
            break
          }
          case 'update': {
            const [id] = existingIds([action.shape.id])
            if (!id) break
            const shape = editor.getShape(id)!
            editor.updateShape({
              ...action.shape,
              type: shape.type,
            } as TLShapePartial)
            break
          }
          case 'delete':
            editor.deleteShapes(existingIds(action.ids))
            break
          case 'duplicate':
            editor.duplicateShapes(existingIds(action.ids), {
              x: action.dx,
              y: action.dy,
            })
            break
          case 'group':
            editor.groupShapes(existingIds(action.ids))
            break
          case 'ungroup':
            editor.ungroupShapes(existingIds(action.ids))
            break
          case 'reparent':
            editor.reparentShapes(
              existingIds(action.ids),
              action.parentId as TLParentId,
            )
            break
          case 'align':
            editor.alignShapes(existingIds(action.ids), action.direction)
            break
          case 'distribute':
            editor.distributeShapes(existingIds(action.ids), action.direction)
            break
          case 'stack':
            editor.stackShapes(
              existingIds(action.ids),
              action.direction,
              action.gap,
            )
            break
          case 'reorder': {
            const ids = existingIds(action.ids)
            if (action.direction === 'front') editor.bringToFront(ids)
            if (action.direction === 'back') editor.sendToBack(ids)
            if (action.direction === 'forward') editor.bringForward(ids)
            if (action.direction === 'backward') editor.sendBackward(ids)
            break
          }
          case 'select':
            editor.select(...existingIds(action.ids))
            break
          case 'focus': {
            const ids = existingIds(action.ids)
            const page = editor.getAncestorPageId(ids[0])
            if (page) editor.setCurrentPage(page)
            const bounds = editor.getShapesPageBounds(
              ids.filter((id) => editor.getAncestorPageId(id) === page),
            )
            if (bounds) focusCanvas({ editor, bounds })
            break
          }
        }
      }
    } catch (error) {
      editor.bailToMark(mark)
      failure = error instanceof Error ? error : new Error(String(error))
    }
  })
  if (failure) throw failure
  editor.markHistoryStoppingPoint('after agent edit')
  const after = editor.store.query.records('shape').get()
  const afterIds = new Set(after.map((shape) => shape.id))
  return {
    ok: true,
    createdIds: after
      .filter((shape) => !before.has(shape.id))
      .map((shape) => shape.id),
    updatedIds: after
      .filter((shape) => before.has(shape.id) && before.get(shape.id) !== shape)
      .map((shape) => shape.id),
    deletedIds: [...before.keys()].filter((id) => !afterIds.has(id)),
    missingIds: [...missingIds],
    pageId: editor.getCurrentPageId(),
    selectedIds: editor.getSelectedShapeIds(),
  }
}

async function captureCanvas({ editor }: { editor: Editor }) {
  const bounds = editor.getViewportPageBounds()
  const shapes = editor.getCurrentPageShapes().filter((shape) => {
    const box = editor.getShapePageBounds(shape)
    return box && bounds.collides(box)
  })
  if (!shapes.length) return null
  const websites = shapes.filter((shape) => shape.type === 'website')
  const results = await Promise.allSettled(
    websites.map((shape) => capturePreview({ id: shape.id })),
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

export function editHtml({
  editor,
  input: { id, replacements },
}: {
  editor: Editor
  input: z.infer<typeof editHtmlSchema>
}) {
  const shape = editor.getShape(id as TLShapeId)
  if (!shape) return { updatedIds: [], missingIds: [id] }
  if (shape.type !== 'website')
    return {
      updatedIds: [],
      error: `${id} is a ${shape.type} shape, not a website.`,
      context: readBoard({ editor }),
    }
  const { html, matches } = applyReplacements({
    html: shape.props.html,
    replacements,
  })
  const result = applyCanvasActions({
    editor,
    input: {
      actions:
        html === shape.props.html
          ? []
          : [{ op: 'update', shape: { id, props: { html } } }],
    },
  })
  return { ...result, matches, ...(matches.includes(0) ? { html } : {}) }
}

export async function inspectCanvas({
  editor,
  question,
  signal,
}: {
  editor: Editor
  question?: string
  signal: AbortSignal
}) {
  const context = readBoard({ editor })
  const captured = await captureCanvas({ editor })
  if (!captured)
    return { observation: 'The current viewport is empty.', context }
  const result = await unwrap(
    api.inspect.post(
      {
        image: captured.image,
        warnings: captured.warnings,
        question: question || 'Describe the websites and annotations.',
        context,
      },
      { fetch: { signal } },
    ),
  )
  return { ...result, warnings: captured.warnings, pageId: context.pageId }
}
