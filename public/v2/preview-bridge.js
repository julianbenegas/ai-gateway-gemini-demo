;(() => {
  let port
  let mode = 'browse'
  let selectedId = null
  let hovered = null
  let notes = []
  let root
  let hoverBox
  let selectionBox
  let drawingLayer
  let stroke = null
  const pendingDrawings = new Map()
  const svgNamespace = 'http://www.w3.org/2000/svg'

  const find = (id) =>
    id ? document.querySelector(`[data-margin-id="${CSS.escape(id)}"]`) : null
  const describe = (element) => {
    if (!element) return null
    const rect = element.getBoundingClientRect()
    return {
      id: element.getAttribute('data-margin-id'),
      tag: element.tagName.toLowerCase(),
      text: element.innerText || element.textContent || '',
      html: element.outerHTML,
      selector: `[data-margin-id="${element.getAttribute('data-margin-id')}"]`,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    }
  }
  const reference = (element) => {
    const { id, tag, text, selector } = describe(element)
    return { id, tag, text, selector }
  }
  const drawPath = (points, id) => {
    const path = document.createElementNS(svgNamespace, 'polyline')
    if (points.length === 1)
      points = [...points, { x: points[0].x + 0.01, y: points[0].y }]
    path.setAttribute('points', points.map(({ x, y }) => `${x},${y}`).join(' '))
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', '#e5484d')
    path.setAttribute('stroke-width', '3')
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('stroke-linejoin', 'round')
    if (id) path.setAttribute('data-margin-drawing', id)
    drawingLayer.append(path)
  }
  const renderDrawings = () => {
    drawingLayer.replaceChildren()
    for (const note of notes) {
      if (!note.drawing) continue
      const rect = find(note.target.id)?.getBoundingClientRect()
      if (!rect) continue
      drawPath(
        note.drawing.points.map(({ x, y }) => ({
          x: rect.x + x * rect.width,
          y: rect.y + y * rect.height,
        })),
        note.id,
      )
    }
    if (stroke)
      drawPath(
        stroke.points.map(({ x, y }) => ({ x: x - scrollX, y: y - scrollY })),
      )
  }
  const place = (box, element) => {
    box.hidden = !element
    if (!element) return
    const rect = element.getBoundingClientRect()
    Object.assign(box.style, {
      left: `${rect.x}px`,
      top: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    })
  }
  const render = () => {
    if (!root) return
    place(hoverBox, mode === 'select' && hovered?.isConnected ? hovered : null)
    place(selectionBox, mode === 'select' ? find(selectedId) : null)
    renderDrawings()
    root.querySelectorAll('button').forEach((button) => button.remove())
    const positions = notes.map((note, index) => {
      const element = find(note.target.id)
      const rect = element?.getBoundingClientRect()
      const visible =
        !!rect &&
        rect.bottom > 0 &&
        rect.top < innerHeight &&
        rect.right > 0 &&
        rect.left < innerWidth
      if (visible) {
        const pin = document.createElement('button')
        pin.textContent = String(index + 1)
        pin.title = note.comment || 'Freehand drawing'
        pin.setAttribute('aria-label', `Annotation ${index + 1}`)
        pin.style.cssText = `position:fixed;left:${Math.max(4, Math.min(innerWidth - 28, rect.right - 12))}px;top:${Math.max(4, rect.top - 12)}px;width:24px;height:24px;border:2px solid white;border-radius:0;background:#040404;color:#fafafa;font:600 11px ui-monospace,monospace;pointer-events:auto;cursor:pointer;box-shadow:0 2px 8px #0004`
        pin.onclick = () =>
          port?.postMessage({ type: 'open-note', id: note.id })
        root.append(pin)
      }
      return {
        id: note.id,
        x: rect?.x || 0,
        y: rect?.y || 0,
        visible,
        attached: !!element,
      }
    })
    port?.postMessage({ type: 'positions', positions })
  }

  window.addEventListener('message', (event) => {
    if (
      event.source !== parent ||
      event.data?.type !== 'margin:v2:init' ||
      !event.ports[0]
    )
      return
    port?.close()
    port = event.ports[0]
    if (!root) {
      root = document.createElement('div')
      root.setAttribute('data-margin-ui', '')
      root.style.cssText =
        'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
      hoverBox = document.createElement('div')
      selectionBox = document.createElement('div')
      hoverBox.style.cssText =
        'position:fixed;border:1px solid #ff6c02;border-radius:2px;pointer-events:none;box-sizing:border-box'
      selectionBox.style.cssText =
        'position:fixed;border:2px solid #ff6c02;background:#ff6c0210;border-radius:2px;pointer-events:none;box-sizing:border-box'
      drawingLayer = document.createElementNS(svgNamespace, 'svg')
      drawingLayer.setAttribute('aria-hidden', 'true')
      drawingLayer.style.cssText =
        'position:fixed;inset:0;width:100%;height:100%;overflow:hidden;pointer-events:none'
      const styles = document.createElement('style')
      styles.textContent =
        '[data-margin-mode="draw"], [data-margin-mode="draw"] * { cursor:crosshair!important; touch-action:none!important; user-select:none!important } [data-margin-mode="draw"] [data-margin-ui] button { pointer-events:none!important }'
      root.append(styles, hoverBox, selectionBox, drawingLayer)
      document.documentElement.append(root)
    }
    port.onmessage = ({ data }) => {
      if (data.type === 'state') {
        mode = data.mode
        document.documentElement.setAttribute('data-margin-mode', mode)
        if (mode !== 'draw') stroke = null
        selectedId = data.selectedId
        for (const note of data.annotations) pendingDrawings.delete(note.id)
        notes = [...data.annotations, ...pendingDrawings.values()]
        render()
        port.postMessage({
          type: 'refresh-selection',
          selection: describe(find(selectedId)),
        })
      }
      if (data.type === 'read_selection') {
        port.postMessage({
          type: 'context',
          requestId: data.requestId,
          selection: describe(find(selectedId)),
          annotations: notes.map((note) => ({
            id: note.id,
            comment: note.comment,
            attached: !!find(note.target.id),
            target: {
              id: note.target.id,
              tag: note.target.tag,
              text: note.target.text,
              selector: note.target.selector,
              rect: describe(find(note.target.id))?.rect ?? note.target.rect,
            },
            ...(note.drawing
              ? {
                  drawing: {
                    coordinateSpace:
                      'normalized to target bounds; (0,0) top left, (1,1) bottom right',
                    points: note.drawing.points,
                    targets: note.drawing.targets.map((target) => ({
                      ...(find(target.id)
                        ? reference(find(target.id))
                        : target),
                      attached: !!find(target.id),
                    })),
                  },
                }
              : {}),
          })),
          viewport: {
            width: innerWidth,
            height: innerHeight,
            scrollX,
            scrollY,
          },
        })
      }
    }
    port.postMessage({ type: 'ready' })
  })

  document.addEventListener(
    'pointermove',
    (event) => {
      if (stroke?.pointerId === event.pointerId) {
        event.preventDefault()
        event.stopImmediatePropagation()
        const samples = event.getCoalescedEvents?.()
        for (const sample of samples?.length ? samples : [event])
          addPoint(sample)
        renderDrawings()
        return
      }
      if (
        mode !== 'select' ||
        !(event.target instanceof Element) ||
        event.target.closest('[data-margin-ui]')
      )
        return
      hovered = event.target.closest('[data-margin-id]')
      place(hoverBox, hovered)
    },
    true,
  )
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (
        mode !== 'browse' &&
        event.target instanceof Element &&
        !event.target.closest('[data-margin-ui]')
      ) {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (mode === 'draw' && event.button === 0 && !stroke) {
          stroke = {
            pointerId: event.pointerId,
            points: [],
            elements: new Set(),
          }
          document.documentElement.setPointerCapture(event.pointerId)
          addPoint(event)
          renderDrawings()
        }
      }
    },
    true,
  )
  document.addEventListener(
    'click',
    (event) => {
      if (
        mode === 'browse' ||
        !(event.target instanceof Element) ||
        event.target.closest('[data-margin-ui]')
      )
        return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (mode === 'draw') return
      const element = event.target.closest('[data-margin-id]')
      selectedId = element?.getAttribute('data-margin-id') || null
      render()
      port?.postMessage({ type: 'selection', selection: describe(element) })
    },
    true,
  )
  const addPoint = (event) => {
    const element = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest('[data-margin-id]')
    if (element && !element.closest('[data-margin-ui]'))
      stroke.elements.add(element)
    const point = { x: event.clientX + scrollX, y: event.clientY + scrollY }
    const last = stroke.points.at(-1)
    if (!last || Math.hypot(last.x - point.x, last.y - point.y) >= 2)
      stroke.points.push(point)
  }
  document.addEventListener(
    'pointerup',
    (event) => {
      if (stroke?.pointerId !== event.pointerId) return
      event.preventDefault()
      event.stopImmediatePropagation()
      addPoint(event)
      const { points, elements } = stroke
      stroke = null
      document.documentElement.releasePointerCapture(event.pointerId)
      let anchor = elements.values().next().value ?? document.body
      for (const element of elements) {
        while (!anchor.contains(element) && anchor.parentElement)
          anchor = anchor.parentElement
      }
      anchor = anchor.closest('[data-margin-id]') ?? document.body
      const target = describe(anchor)
      const rect = anchor.getBoundingClientRect()
      const bounds = points.reduce(
        (bounds, point) => ({
          left: Math.min(bounds.left, point.x),
          right: Math.max(bounds.right, point.x),
          top: Math.min(bounds.top, point.y),
          bottom: Math.max(bounds.bottom, point.y),
        }),
        { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity },
      )
      for (const element of anchor.querySelectorAll('[data-margin-id]')) {
        const box = element.getBoundingClientRect()
        if (
          box.width &&
          box.height &&
          box.left + scrollX >= bounds.left &&
          box.right + scrollX <= bounds.right &&
          box.top + scrollY >= bounds.top &&
          box.bottom + scrollY <= bounds.bottom
        )
          elements.add(element)
      }
      const targets = [...elements].filter(
        (element) =>
          ![...elements].some(
            (other) => other !== element && element.contains(other),
          ),
      )
      const annotation = {
        id: crypto.randomUUID(),
        target,
        comment: '',
        drawing: {
          points: points.map(({ x, y }) => ({
            x: (x - rect.x - scrollX) / (rect.width || 1),
            y: (y - rect.y - scrollY) / (rect.height || 1),
          })),
          targets: targets.map(reference),
        },
      }
      pendingDrawings.set(annotation.id, annotation)
      notes = [...notes, annotation]
      render()
      port?.postMessage({ type: 'drawing', annotation })
    },
    true,
  )
  document.addEventListener(
    'pointercancel',
    (event) => {
      if (stroke?.pointerId !== event.pointerId) return
      stroke = null
      renderDrawings()
    },
    true,
  )
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape' || mode === 'browse') return
      stroke = null
      port?.postMessage({ type: 'browse' })
      render()
    },
    true,
  )
  document.addEventListener('submit', (event) => event.preventDefault(), true)
  document.documentElement.addEventListener('pointerleave', () => {
    hovered = null
    if (hoverBox) place(hoverBox, null)
  })
  document.addEventListener('scroll', render, true)
  window.addEventListener('resize', render)
  new ResizeObserver(render).observe(document.documentElement)
})()
