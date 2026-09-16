import {
  Box,
  createShapeId,
  type Editor,
  type TLParentId,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
} from 'tldraw'
import { applySchema, inspectSchema, readShapesSchema } from './tools'
import { capturePreview } from './preview'

export function focusCanvas(editor: Editor, bounds: Box) {
  editor.zoomToBounds(bounds, {
    animation: { duration: 220 },
    inset: Math.min(220, editor.getViewportScreenBounds().w / 3),
  })
}

function describeShape(editor: Editor, shape: TLShape, includeHtml: boolean) {
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

export function readBoard(editor: Editor, { includeHtml = true } = {}) {
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
    shapes: shapes.map((shape) => describeShape(editor, shape, includeHtml)),
  }
}

export function applyCanvasActions(editor: Editor, input: unknown) {
  const { pageId, actions } = applySchema.parse(input)
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
              (action.shape.id as TLShapeId | undefined) ?? createShapeId()
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
            const bounds = ids
              .filter((id) => editor.getAncestorPageId(id) === page)
              .map((id) => editor.getShapePageBounds(id))
              .filter((bounds): bounds is Box => !!bounds)
            if (bounds.length) focusCanvas(editor, Box.Common(bounds))
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

export async function captureCanvas(editor: Editor) {
  const bounds = editor.getViewportPageBounds()
  const shapes = editor.getCurrentPageShapes().filter((shape) => {
    const box = editor.getShapePageBounds(shape)
    return box && bounds.collides(box)
  })
  if (!shapes.length) return null
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
        return shape
          ? describeShape(editor, shape, true)
          : { id, missing: true }
      })
    }
    case 'apply_actions':
      return applyCanvasActions(editor, args)
    case 'inspect_canvas': {
      const { question } = inspectSchema.parse(args)
      const context = readBoard(editor, { includeHtml: false })
      const captured = await captureCanvas(editor)
      if (!captured)
        return { observation: 'The current viewport is empty.', context }
      const response = await fetch('/api/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...captured,
          question: question || 'Describe the websites and annotations.',
          context,
        }),
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
