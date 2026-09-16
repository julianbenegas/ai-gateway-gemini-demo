import { test, expect, type Page, type WebSocketRoute } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

test('API origin checks accept the browser host and reject other origins', async ({
  request,
}) => {
  const rejected = await request.post('/api/realtime', {
    headers: { Origin: 'https://another.example' },
  })
  expect(rejected.status()).toBe(403)
  const accepted = await request.post('/api/inspect', {
    headers: { Origin: 'http://localhost:3000' },
    data: {},
  })
  expect(accepted.status()).toBe(400)
  expect(await accepted.json()).toEqual({ error: 'Invalid inspection request' })
})

async function openWorkspace(page: Page) {
  await page.goto('/')
  await expect(
    page.getByRole('button', { name: 'Start voice', exact: true }),
  ).toBeVisible()
  await expect(
    page
      .frameLocator('iframe[title="Forma · Starting point"]')
      .getByRole('heading'),
  ).toContainText('Good spaces.')
}

async function mockGateway(page: Page) {
  let socket: WebSocketRoute
  const outputs = new Map<string, unknown>()
  const sent: Record<string, unknown>[] = []
  await page.route('**/api/realtime', (route) =>
    route.fulfill({
      json: {
        token: 'test-token',
        url: 'wss://gateway.test/realtime',
        tools: [],
      },
    }),
  )
  await page.routeWebSocket('wss://gateway.test/realtime', (ws) => {
    socket = ws
    ws.onMessage((message) => {
      const event = JSON.parse(String(message))
      sent.push(event)
      if (event.type === 'session-update')
        ws.send(JSON.stringify({ type: 'session-updated', raw: {} }))
      if (
        event.type === 'conversation-item-create' &&
        event.item?.type === 'function-call-output'
      )
        outputs.set(event.item.callId, JSON.parse(event.item.output))
    })
  })
  let n = 0
  return {
    sent,
    outputs,
    send(event: Record<string, unknown>) {
      socket.send(JSON.stringify({ ...event, raw: event.raw ?? {} }))
    },
    async call(name: string, args: unknown, id = `call-${++n}`) {
      await expect.poll(() => Boolean(socket)).toBe(true)
      socket!.send(
        JSON.stringify({
          type: 'function-call-arguments-done',
          responseId: `response-${n}`,
          itemId: `item-${id}`,
          callId: id,
          name,
          arguments: JSON.stringify(args),
          raw: {},
        }),
      )
      await expect.poll(() => outputs.has(id), { timeout: 20000 }).toBe(true)
      return outputs.get(id) as Record<string, any>
    },
  }
}

async function connectVoice(page: Page) {
  await page.getByRole('button', { name: 'Start voice', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Mute microphone', exact: true }),
  ).toBeVisible()
}

test('incomplete tool arguments keep voice connected and recover with a short edit', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await openWorkspace(page)
  await connectVoice(page)
  gateway.send({
    type: 'function-call-arguments-done',
    responseId: 'response-cut-off',
    itemId: 'item-cut-off',
    callId: 'call-cut-off',
    name: 'apply_actions',
    arguments:
      '{"actions":[{"op":"update","shape":{"id":"shape:forma","props":{"html":"<!doctype html>',
  })
  gateway.send({
    type: 'response-done',
    responseId: 'response-cut-off',
    status: 'incomplete',
    raw: { response: { status_details: { reason: 'max_output_tokens' } } },
  })
  await expect.poll(() => gateway.outputs.has('call-cut-off')).toBe(true)
  expect(gateway.outputs.get('call-cut-off')).toMatchObject({
    error: expect.stringContaining('not executed'),
  })
  await expect(
    page.getByRole('button', { name: 'Mute microphone', exact: true }),
  ).toBeVisible()
  const heading = page
    .frameLocator('iframe[title="Forma · Starting point"]')
    .getByRole('heading')
  await expect(heading).toContainText('Good spaces.')
  await expect
    .poll(
      () =>
        gateway.sent.filter((event) => event.type === 'response-create').length,
    )
    .toBe(1)
  const result = await gateway.call('edit_html', {
    id: 'shape:forma',
    replacements: [{ search: 'Good spaces.', replace: 'Great.' }],
  })
  expect(result.updatedIds).toEqual(['shape:forma'])
  expect(result.matches).toEqual([1])
  await expect(heading).toContainText('Great.')
  await expect(page.locator('.voice-notice')).not.toContainText(
    'Failed to parse',
  )
})

function sendIncompleteCall(
  gateway: Awaited<ReturnType<typeof mockGateway>>,
  id: string,
) {
  const args =
    '{"actions":[{"op":"update","shape":{"id":"shape:forma","props":{"html":"<!doctype html>'
  const event = {
    responseId: `response-${id}`,
    itemId: `item-${id}`,
    callId: `call-${id}`,
    name: 'apply_actions',
  }
  gateway.send({ type: 'function-call-arguments-delta', ...event, delta: args })
  gateway.send({
    type: 'function-call-arguments-done',
    ...event,
    arguments: args,
  })
}

test('cancelled or interrupted tool output does not restart the old request', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await openWorkspace(page)
  await connectVoice(page)
  sendIncompleteCall(gateway, 'cancelled')
  gateway.send({
    type: 'response-done',
    responseId: 'response-cancelled',
    status: 'cancelled',
  })
  gateway.send({ type: 'response-created', responseId: 'response-interrupted' })
  gateway.send({
    type: 'speech-started',
    audioStartMs: 0,
    itemId: 'user-interrupt',
  })
  sendIncompleteCall(gateway, 'interrupted')
  gateway.send({
    type: 'response-done',
    responseId: 'response-interrupted',
    status: 'incomplete',
  })
  await expect.poll(() => gateway.outputs.has('call-interrupted')).toBe(true)
  await gateway.call('read_board', {})
  expect(
    gateway.sent.filter((event) => event.type === 'response-create'),
  ).toHaveLength(0)
  await expect(
    page.getByRole('button', { name: 'Mute microphone', exact: true }),
  ).toBeVisible()
})

test('malformed tool recovery retries once and deduplicates calls', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await openWorkspace(page)
  await connectVoice(page)
  for (const id of ['first', 'retry']) {
    sendIncompleteCall(gateway, id)
    sendIncompleteCall(gateway, id)
    gateway.send({
      type: 'response-done',
      responseId: `response-${id}`,
      status: 'incomplete',
    })
    await expect.poll(() => gateway.outputs.has(`call-${id}`)).toBe(true)
  }
  await expect(page.locator('.voice-notice.is-error')).toHaveText(
    /That edit didn’t finish. Still listening./,
  )
  expect(
    gateway.sent.filter((event) => event.type === 'response-create'),
  ).toHaveLength(1)
  const outputs = gateway.sent.filter(
    (event: any) => event.item?.type === 'function-call-output',
  )
  expect(outputs).toHaveLength(2)
  await expect(
    page.getByRole('button', { name: 'Mute microphone', exact: true }),
  ).toBeVisible()
  gateway.send({
    type: 'speech-started',
    audioStartMs: 100,
    itemId: 'user-new',
  })
  sendIncompleteCall(gateway, 'new-turn')
  gateway.send({
    type: 'response-done',
    responseId: 'response-new-turn',
    status: 'incomplete',
  })
  await expect
    .poll(
      () =>
        gateway.sent.filter((event) => event.type === 'response-create').length,
    )
    .toBe(2)
})

test('mixed valid and incomplete tool calls produce only one continuation', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await openWorkspace(page)
  await connectVoice(page)
  sendIncompleteCall(gateway, 'mixed')
  gateway.send({
    type: 'function-call-arguments-done',
    responseId: 'response-mixed',
    itemId: 'item-valid',
    callId: 'call-valid',
    name: 'read_board',
    arguments: '{}',
  })
  gateway.send({
    type: 'response-done',
    responseId: 'response-mixed',
    status: 'completed',
  })
  await expect.poll(() => gateway.outputs.has('call-valid')).toBe(true)
  await expect
    .poll(
      () =>
        gateway.sent.filter((event) => event.type === 'response-create').length,
    )
    .toBe(1)
  expect(gateway.outputs.has('call-mixed')).toBe(true)
  await expect(
    page.getByRole('button', { name: 'Mute microphone', exact: true }),
  ).toBeVisible()
})

test('short HTML edits use literal replacements, return unmatched source, and undo together', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await openWorkspace(page)
  await page.getByRole('button', { name: 'Select — V', exact: true }).click()
  await page.keyboard.press('Escape')
  await connectVoice(page)
  const result = await gateway.call('edit_html', {
    id: 'shape:forma',
    replacements: [
      { search: 'Good spaces.', replace: 'Great $& $1 $$.' },
      { search: '#28372f', replace: '#112233', all: true },
      { search: 'no such source', replace: 'Unused' },
      { search: '', replace: 'Unused' },
    ],
  })
  expect(result.selectedIds).toEqual([])
  expect(result.updatedIds).toEqual(['shape:forma'])
  expect(result.matches[0]).toBe(1)
  expect(result.matches[1]).toBeGreaterThan(1)
  expect(result.matches.slice(2)).toEqual([0, 0])
  expect(result.html).toContain('Great $& $1 $$.')
  expect(result.html).not.toContain('#28372f')
  expect(result.html).not.toContain('Unused')
  const heading = page
    .frameLocator('iframe[title="Forma · Starting point"]')
    .getByRole('heading')
  await expect(heading).toContainText('Great $& $1 $$.')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(heading).toContainText('Good spaces.')
  const after = await gateway.call('read_shapes', { ids: ['shape:forma'] })
  expect(after[0].props.html).toContain('#28372f')
  const missing = await gateway.call('edit_html', {
    id: 'shape:gone',
    replacements: [{ search: 'x', replace: 'y' }],
  })
  expect(missing.updatedIds).toEqual([])
  expect(missing.missingIds).toEqual(['shape:gone'])
})

test('HTML editing, responsive copies, and separate boards survive reload', async ({
  page,
}) => {
  await openWorkspace(page)
  await page.getByRole('button', { name: 'Code', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'Website HTML' })
  await source.fill(
    (await source.inputValue()).replace('Good spaces.', 'Thoughtful spaces.'),
  )
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(
    page
      .frameLocator('iframe[title="Forma · Starting point"]')
      .getByRole('heading'),
  ).toContainText('Thoughtful spaces.')
  await page.getByRole('button', { name: 'Mobile', exact: true }).click()
  await expect(page.locator('.website-list button')).toHaveCount(2)
  await expect(page.locator('.website-list')).toContainText('390 × 760')
  await page.getByRole('button', { name: 'New board', exact: true }).click()
  await page.getByRole('textbox', { name: 'Board name' }).fill('Coffee ideas')
  await page.getByRole('textbox', { name: 'Board name' }).press('Enter')
  await expect(page.locator('.website-list button')).toHaveCount(0)
  await page.getByRole('button', { name: 'Add website', exact: true }).click()
  await expect(page.locator('.website-list button')).toHaveCount(1)
  await page.getByRole('button', { name: 'First ideas', exact: true }).click()
  await expect(page.locator('.website-list button')).toHaveCount(2)
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          new Promise<boolean>((resolve, reject) => {
            const request = indexedDB.open('TLDRAW_DOCUMENT_v2margin-board-v1')
            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
              const db = request.result
              const records = db
                .transaction('records')
                .objectStore('records')
                .getAll()
              records.onsuccess = () => {
                resolve(
                  records.result.some(
                    (record) =>
                      record.typeName === 'page' &&
                      record.name === 'Coffee ideas',
                  ),
                )
                db.close()
              }
              records.onerror = () => {
                reject(records.error)
                db.close()
              }
            }
          }),
      ),
    )
    .toBe(true)
  await page.reload()
  await expect(page.locator('.website-list button')).toHaveCount(2)
  await expect(
    page
      .frameLocator('iframe[title="Forma · Starting point"]')
      .getByRole('heading'),
  ).toContainText('Thoughtful spaces.')
  await expect(
    page.getByRole('button', { name: 'Coffee ideas', exact: true }),
  ).toBeVisible()
})

test('known shapes remain editable when the visible board and selection change', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await openWorkspace(page)
  await connectVoice(page)
  const original = await gateway.call('read_board', {})
  const website = original.shapes.find((shape: any) => shape.type === 'website')
  await page.getByRole('button', { name: 'New board', exact: true }).click()
  const current = await gateway.call('read_board', {})
  expect(current.selectedIds).toEqual([])
  const result = await gateway.call('apply_actions', {
    pageId: original.pageId,
    actions: [
      {
        op: 'update',
        shape: {
          id: website.id,
          props: { html: website.props.html.replace('Good spaces.', 'Great.') },
        },
      },
    ],
  })
  expect(result.updatedIds).toEqual([website.id])
  expect(result.pageId).toBe(current.pageId)
  const records = await gateway.call('read_shapes', { ids: [website.id] })
  expect(records[0].pageId).toBe(original.pageId)
  expect(records[0].props.html).toContain('Great.')
  await page.getByRole('button', { name: 'First ideas', exact: true }).click()
  await expect(
    page
      .frameLocator('iframe[title="Forma · Starting point"]')
      .getByRole('heading'),
  ).toContainText('Great.')
  const missing = await gateway.call('apply_actions', {
    actions: [
      { op: 'delete', ids: ['shape:gone'] },
      { op: 'select', ids: [] },
    ],
  })
  expect(missing.missingIds).toEqual(['shape:gone'])
  expect(missing.deletedIds).toEqual([])
  expect(missing.selectedIds).toEqual([])
  await expect(
    page.getByText('Something went wrong', { exact: true }),
  ).toHaveCount(0)
})

test('visual inspection includes iframe pixels and canvas annotations', async ({
  page,
}, testInfo) => {
  const gateway = await mockGateway(page)
  let capture: { image: string; warnings: string[]; context: any } | undefined
  await page.route('**/api/inspect', async (route) => {
    capture = route.request().postDataJSON()
    await route.fulfill({
      json: {
        observation:
          'The Forma website has a large green headline, with a yellow note to its right.',
      },
    })
  })
  await openWorkspace(page)
  await connectVoice(page)
  const websiteBounds = (await page
    .locator('iframe[title="Forma · Starting point"]')
    .boundingBox())!
  await page.getByRole('button', { name: 'Draw — D', exact: true }).click()
  const cx = websiteBounds.x + websiteBounds.width * 0.44
  const cy = websiteBounds.y + websiteBounds.height * 0.3
  await page.mouse.move(cx + 160, cy)
  await page.mouse.down()
  for (let i = 1; i <= 32; i++) {
    const angle = (i / 32) * Math.PI * 2
    await page.mouse.move(cx + Math.cos(angle) * 160, cy + Math.sin(angle) * 65)
  }
  await page.mouse.up()
  const result = await gateway.call('inspect_canvas', {
    question: 'Describe the design and its annotations.',
  })
  expect(result.observation).toContain('yellow note')
  expect(capture?.warnings).toEqual([])
  expect(capture?.image.length).toBeGreaterThan(20000)
  expect(
    capture?.context.shapes.some((shape: any) => shape.type === 'note'),
  ).toBe(true)
  expect(
    capture?.context.shapes.some((shape: any) => shape.type === 'draw'),
  ).toBe(true)
  await writeFile(
    testInfo.outputPath('captured-board.png'),
    Buffer.from(capture!.image.split(',')[1], 'base64'),
  )
})

test('HTML over 60k edits and persists without selection, hashes, or a page token', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await openWorkspace(page)
  await page.getByRole('button', { name: 'Select — V', exact: true }).click()
  await page.keyboard.press('Escape')
  await connectVoice(page)
  const board = await gateway.call('read_board', {})
  expect(board.selectedIds).toEqual([])
  const website = board.shapes.find((shape: any) => shape.type === 'website')
  expect(website.props.html).toContain('Good spaces.')
  expect(website.contentHash).toBeUndefined()
  const html = website.props.html
    .replace('Good spaces.', 'Great.')
    .replace('</head>', '<style>' + ' '.repeat(65000) + '</style></head>')
  expect(html.length).toBeGreaterThan(60000)
  const result = await gateway.call('apply_actions', {
    actions: [
      { op: 'update', shape: { id: website.id, props: { html } } },
      ...Array.from({ length: 35 }, () => ({ op: 'select', ids: [] })),
    ],
  })
  expect(result.updatedIds).toEqual([website.id])
  expect(result.selectedIds).toEqual([])
  await expect(
    page
      .frameLocator('iframe[title="Forma · Starting point"]')
      .getByRole('heading'),
  ).toContainText('Great.')
  await expect
    .poll(() =>
      page.evaluate(
        (expected) =>
          new Promise<boolean>((resolve, reject) => {
            const request = indexedDB.open('TLDRAW_DOCUMENT_v2margin-board-v1')
            request.onerror = () => reject(request.error)
            request.onsuccess = () => {
              const db = request.result
              const record = db
                .transaction('records')
                .objectStore('records')
                .get('shape:forma')
              record.onsuccess = () => {
                resolve(record.result?.props.html === expected)
                db.close()
              }
              record.onerror = () => {
                reject(record.error)
                db.close()
              }
            }
          }),
        html,
      ),
    )
    .toBe(true)
  await page.reload()
  await expect(
    page
      .frameLocator('iframe[title="Forma · Starting point"]')
      .getByRole('heading'),
  ).toContainText('Great.')
  await expect(
    page.getByText('Something went wrong', { exact: true }),
  ).toHaveCount(0)
})

test('live context supplies HTML and follows empty, note, and frame selections', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await openWorkspace(page)
  await connectVoice(page)
  const latestContext = () => {
    const messages = gateway.sent.filter(
      (event: any) =>
        event.type === 'conversation-item-create' &&
        event.item?.text?.startsWith('[Board context'),
    ) as any[]
    const text = messages.at(-1)?.item.text
    return text ? JSON.parse(text.slice(text.indexOf('\n') + 1)) : null
  }
  await expect
    .poll(() => latestContext()?.selectedWebsiteIds)
    .toEqual(['shape:forma'])
  expect(
    latestContext().shapes.find((shape: any) => shape.id === 'shape:forma')
      .props.html,
  ).toContain('Good spaces.')
  expect(latestContext().visibleShapeIds).toContain('shape:forma')
  const note = latestContext().shapes.find(
    (shape: any) => shape.type === 'note',
  )
  await page
    .getByTestId('canvas')
    .getByText('What if this felt a little more playful?', { exact: true })
    .click()
  await expect.poll(() => latestContext()?.selectedIds).toEqual([note.id])
  await page.keyboard.press('Escape')
  await expect.poll(() => latestContext()?.selectedIds).toEqual([])
  expect(
    latestContext().shapes.find((shape: any) => shape.id === 'shape:forma')
      .props.html,
  ).toContain('Good spaces.')
  await gateway.call('apply_actions', {
    actions: [
      {
        op: 'create',
        shape: {
          id: 'shape:frame-context',
          type: 'frame',
          x: -20,
          y: -20,
          props: { w: 760, h: 800, name: 'Design' },
        },
      },
      { op: 'reparent', ids: ['shape:forma'], parentId: 'shape:frame-context' },
      { op: 'select', ids: ['shape:frame-context'] },
    ],
  })
  await expect
    .poll(() => latestContext()?.selectedIds)
    .toEqual(['shape:frame-context'])
  expect(latestContext().selectedWebsiteIds).toEqual(['shape:forma'])
  expect(
    latestContext().shapes.find((shape: any) => shape.id === 'shape:forma')
      .props.html,
  ).toContain('Good spaces.')
})

test('native validation failures roll back a batch without losing earlier edits', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await openWorkspace(page)
  await page.getByRole('button', { name: 'Code', exact: true }).click()
  const source = page.getByRole('textbox', { name: 'Website HTML' })
  await source.fill(
    (await source.inputValue()).replace('Good spaces.', 'My own copy.'),
  )
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await connectVoice(page)
  const board = await gateway.call('read_board', {})
  const result = await gateway.call('apply_actions', {
    pageId: board.pageId,
    actions: [
      {
        op: 'update',
        shape: {
          id: 'shape:forma',
          type: 'website',
          props: { title: 'Wrong title' },
        },
      },
      {
        op: 'create',
        shape: { id: 'shape:temporary', type: 'website', x: 900, y: 900 },
      },
      {
        op: 'create',
        shape: { id: 'shape:invalid', type: 'website', props: { w: -1 } },
      },
    ],
  })
  expect(result.error).toEqual(expect.any(String))
  const after = await gateway.call('read_board', {})
  expect(after.shapes.map((shape: any) => shape.id).sort()).toEqual(
    board.shapes.map((shape: any) => shape.id).sort(),
  )
  const heading = page
    .frameLocator('iframe[title="Forma · Starting point"]')
    .getByRole('heading')
  await expect(heading).toContainText('My own copy.')
  await page.getByRole('button', { name: 'Select — V', exact: true }).click()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(heading).toContainText('Good spaces.')
  await expect(
    page.getByText('Something went wrong', { exact: true }),
  ).toHaveCount(0)
})

test('microphone uses GPT audio settings, mutes, resumes, and stops on end', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await page.addInitScript(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    )
    navigator.mediaDevices.getUserMedia = async (options) => {
      const stream = await getUserMedia(options)
      ;(window as any).testStream = stream
      return stream
    }
  })
  await openWorkspace(page)
  await page.getByRole('button', { name: 'Start voice', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Mute microphone', exact: true }),
  ).toBeVisible()
  await expect
    .poll(() =>
      gateway.sent.some((event) => event.type === 'input-audio-append'),
    )
    .toBe(true)
  const configuration = gateway.sent.find(
    (event) => event.type === 'session-update',
  )!.config as any
  expect(configuration.inputAudioFormat).toEqual({
    type: 'audio/pcm',
    rate: 24000,
  })
  expect(configuration.outputAudioFormat).toEqual({
    type: 'audio/pcm',
    rate: 24000,
  })
  expect(configuration.voice).toBe('marin')
  expect(configuration.inputAudioTranscription).toBeUndefined()
  await page
    .getByRole('button', { name: 'Mute microphone', exact: true })
    .click()
  expect(
    await page.evaluate(() =>
      (window as any).testStream
        .getTracks()
        .every((track: MediaStreamTrack) => track.readyState === 'ended'),
    ),
  ).toBe(true)
  await page
    .getByRole('button', { name: 'Unmute microphone', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Mute microphone', exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'End voice session', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Start voice', exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(() =>
      (window as any).testStream
        .getTracks()
        .every((track: MediaStreamTrack) => track.readyState === 'ended'),
    ),
  ).toBe(true)
})

test('agent interaction is voice only and has no conversation panel', async ({
  page,
}) => {
  await mockGateway(page)
  await openWorkspace(page)
  await expect(
    page.getByRole('textbox', { name: 'Message your design partner' }),
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Send message' })).toHaveCount(
    0,
  )
  await expect(
    page.locator('.agent-panel, .conversation, .composer'),
  ).toHaveCount(0)
  await connectVoice(page)
  await expect(page.locator('.voice-state')).toContainText('Listening')
  await expect(page.locator('.canvas-container')).toHaveCSS('right', '0px')
})

test('cancelling a pending microphone request stops late audio without connecting', async ({
  page,
}) => {
  const gateway = await mockGateway(page)
  await page.addInitScript(() => {
    const acquire = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    )
    navigator.mediaDevices.getUserMedia = (options) =>
      new Promise((resolve) => {
        ;(window as any).allowTestMicrophone = async () => {
          const stream = await acquire(options)
          ;(window as any).testStream = stream
          resolve(stream)
        }
      })
  })
  await openWorkspace(page)
  await page.getByRole('button', { name: 'Start voice', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Cancel voice connection' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Cancel voice connection' }).click()
  await page.evaluate(() => (window as any).allowTestMicrophone())
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).testStream
          .getTracks()
          .every((track: MediaStreamTrack) => track.readyState === 'ended'),
      ),
    )
    .toBe(true)
  await expect(
    page.getByRole('button', { name: 'Start voice', exact: true }),
  ).toBeVisible()
  expect(gateway.sent).toHaveLength(0)
})

test('websites run scripts but cannot read the editor document', async ({
  page,
}) => {
  await openWorkspace(page)
  await page.getByRole('button', { name: 'Code', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Website HTML' })
    .fill(
      '<html><body><p id="result">Waiting</p><script>try { parent.document.body.innerHTML; result.textContent="Unsafe" } catch { result.textContent="Isolated" }</script></body></html>',
    )
  await page.getByRole('button', { name: 'Apply changes', exact: true }).click()
  await expect(
    page
      .frameLocator('iframe[title="Forma · Starting point"]')
      .locator('#result'),
  ).toHaveText('Isolated')
})

test('a failed Gateway connection leaves an actionable error and allows retry', async ({
  page,
}) => {
  await page.route('**/api/realtime', (route) =>
    route.fulfill({
      status: 503,
      json: { error: 'No Vercel project is linked' },
    }),
  )
  await openWorkspace(page)
  await page.getByRole('button', { name: 'Start voice', exact: true }).click()
  await expect(page.locator('.voice-notice.is-error')).toContainText(
    'AI Gateway',
  )
  await expect(page.locator('.voice-notice.is-error')).not.toContainText(
    'development credentials',
  )
  await expect(
    page.getByRole('button', { name: 'Start voice', exact: true }),
  ).toBeEnabled()
})
